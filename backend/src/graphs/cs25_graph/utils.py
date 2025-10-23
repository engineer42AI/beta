# backend/src/graphs/cs25_graph/utils.py

import json, hashlib
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import networkx as nx
from datetime import datetime


# utils.py
import json, hashlib
from pathlib import Path
from typing import Dict, List, Any, Optional, Union
import networkx as nx
from datetime import datetime
import textwrap
from typing import Deque, Iterable
from collections import defaultdict, deque
from typing import Dict, Any, List, Optional, Tuple


class ManifestGraph:
    """
    One class to:
      - load manifest + resolve bundle files
      - compute + report checksum status
      - build a MultiDiGraph
      - return consistent, API-friendly JSON for every public call
    """

    def __init__(self, corpus_dir: str = None):
        self.corpus_dir = Path(corpus_dir) if corpus_dir else Path(__file__).parent
        self.manifest_path = self.corpus_dir / "manifest.json"
        if not self.manifest_path.exists():
            raise FileNotFoundError(f"manifest.json not found at {self.manifest_path}")

        self.manifest: Dict[str, Any] = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.nodes_files: List[Path] = []
        self.edges_files: List[Path] = []
        self.index_path: Optional[Path] = None
        self.G: Optional[nx.MultiDiGraph] = None

        self._resolve_bundle_paths()

    # ------------------ Public API ------------------

    def load(self) -> Dict[str, Any]:
        """
        Always returns a consistent JSON payload:
        {
          "graph_loaded": bool,
          "checksum_passed": bool,
          "integrity": {...},
          "manifest_meta": {...},
          "nodes": int | 0,
          "edges": int | 0,
          "errors": [ ... ]
        }
        """
        result = self._base_payload()
        result["integrity"] = self.checksum_status()  # always compute
        result["checksum_passed"] = result["integrity"]["checksum_passed"]

        errors: List[str] = []

        try:
            nodes = self._load_jsonl_files(self.nodes_files)
            edges = self._load_jsonl_files(self.edges_files)
        except Exception as e:
            errors.append(f"load_jsonl_failed: {e}")
            result.update({"graph_loaded": False, "nodes": 0, "edges": 0, "errors": errors})
            return result

        try:
            self.G = self._build_graph(nodes, edges)
            result["graph_loaded"] = True
            result["nodes"] = self.G.number_of_nodes()
            result["edges"] = self.G.number_of_edges()
        except Exception as e:
            errors.append(f"build_graph_failed: {e}")
            result.update({"graph_loaded": False, "nodes": 0, "edges": 0})

        if errors:
            result["errors"] = errors
        return result

    def update_manifest(self, bump_rev: bool = True) -> Dict[str, Any]:
        """
        Recompute checksum, write it back, and return full integrity state:
        {
          "manifest_updated": bool,
          "integrity": {...},    # same shape as checksum_status()
          "manifest_meta": {...}
        }
        """
        checksum = self.compute_checksum()
        integrity = self.manifest.get("integrity") or {}
        integrity["checksum"] = checksum
        if bump_rev:
            integrity["content_rev"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        self.manifest["integrity"] = integrity

        self.manifest_path.write_text(
            json.dumps(self.manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        # Return integrity based on what’s now in the manifest (round-trip)
        return {
            "manifest_updated": True,
            "integrity": self.checksum_status(),
            "manifest_meta": self.meta(),
        }

    def compute_checksum(self) -> str:
        files = self._bundle_files()
        return "sha256:" + self._hash_files(files)

    def checksum_status(self) -> Dict[str, Any]:
        """
        Always returns:
        {
          "status": "valid"|"invalid"|"missing"|"unsupported",
          "checksum_passed": bool,
          ...extras...
        }
        """
        integrity = self.manifest.get("integrity") or {}
        declared = integrity.get("checksum")

        if not declared:
            return {"status": "missing", "checksum_passed": False}

        algo, _, hexval = declared.partition(":")
        if algo.lower() != "sha256" or not hexval:
            return {"status": "unsupported", "declared": declared, "checksum_passed": False}

        computed = self._hash_files(self._bundle_files())
        if computed != hexval:
            return {
                "status": "invalid",
                "checksum_passed": False,
                "declared": hexval,
                "computed": computed,
            }

        return {
            "status": "valid",
            "checksum_passed": True,
            "checksum": declared,
            "content_rev": integrity.get("content_rev"),
        }

    def meta(self) -> Dict[str, Any]:
        keep = ("uuid", "name", "version", "scope", "created_at", "created_by")
        return {k: self.manifest[k] for k in keep if k in self.manifest}

    # ------------------ Internals ------------------

    def _base_payload(self) -> Dict[str, Any]:
        return {
            "graph_loaded": False,
            "checksum_passed": False,
            "integrity": {"status": "unchecked", "checksum_passed": False},
            "manifest_meta": self.meta(),
            "nodes": 0,
            "edges": 0,
            "errors": [],
        }

    def _resolve_bundle_paths(self) -> None:
        bundle = self.manifest.get("bundle", {})
        self.nodes_files = [self.corpus_dir / p for p in bundle.get("nodes", [])]
        self.edges_files = [self.corpus_dir / p for p in bundle.get("edges", [])]
        idx = bundle.get("index")
        if idx:
            ipath = self.corpus_dir / idx
            if ipath.exists():
                self.index_path = ipath

    def _bundle_files(self) -> List[Path]:
        files = self.nodes_files + self.edges_files
        if self.index_path:
            files.append(self.index_path)
        return sorted(files, key=lambda p: str(p))

    @staticmethod
    def _load_jsonl_files(paths: List[Path]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for p in paths:
            with p.open("r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        out.append(json.loads(line))
        return out

    @staticmethod
    def _build_graph(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> nx.MultiDiGraph:
        G = nx.MultiDiGraph()
        for n in nodes:
            nid = n.get("uuid")
            if nid:
                G.add_node(nid, **n)
        valid = set(G.nodes)
        for e in edges:
            s, t = e.get("source"), e.get("target")
            if s in valid and t in valid:
                G.add_edge(s, t, relation=e.get("relation"), ref=e.get("ref"))
        return G

    @staticmethod
    def _hash_files(files: List[Path]) -> str:
        h = hashlib.sha256()
        for p in files:
            with p.open("rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    h.update(chunk)
        return h.hexdigest()


# ------------------------------
# Small query helpers
# ------------------------------
class GraphOps:
    def __init__(self, G: nx.MultiDiGraph):
        self.G = G

    def find_section_by_number(self, number: str) -> Optional[str]:
        for nid, data in self.G.nodes(data=True):
            if data.get("ntype") == "Section" and data.get("number") == number:
                return nid
        return None

    def get_section_label(self, uuid_section: str) -> Optional[str]:
        d = self.G.nodes.get(uuid_section, {})
        return d.get("label") if d.get("ntype") == "Section" else None

    # ------------------------------
    # Core public API you asked for
    # ------------------------------

    def build_records_for_bottom(self, bottom_uuid: str) -> Dict[str, Any]:
        """
        Returns the 3 JSON records for a bottom paragraph:
          {
            "bottom_uuid": <str>,
            "trace": <List[NodeRecord]>,
            "cites": <List[CiteRecordPerNode]>,
            "intents": <List[IntentRecordPerNode]>
          }
        """
        trace = self._build_trace(bottom_uuid)
        cites = self._collect_cites(trace)
        intents = self._collect_intents(trace, bottom_uuid)
        return {"bottom_uuid": bottom_uuid, "trace": trace, "cites": cites, "intents": intents}

    # --- LLM-friendly formatters -------------------------------------------------

    def format_trace_block(self, trace, *, include_uuids: bool = True, include_text: bool = False) -> str:
        """Markdown output for the trace hierarchy."""

        def roots_from_trace():
            section_root = next((n.get("number", "").replace("CS ", "").strip()
                                 for n in trace if n.get("ntype") == "Section"), None)
            subpart_label = next((n.get("label", "") for n in trace if n.get("ntype") == "Subpart"), "")
            subpart_root = subpart_label.split("–")[0].strip().lower() if subpart_label else None
            return section_root, subpart_root

        bottom = trace[-1] if trace else {}
        pid = bottom.get("paragraph_id", "N/A")
        title = f"Trace for bottom paragraph `{self._md_escape(pid)}`"
        header = f"## 🟢 {title}"
        if include_uuids and bottom.get("uuid"):
            header += f"  \n`uuid: {bottom['uuid']}`"

        if not trace:
            return header + "\n\n> *(no trace)*\n"

        section_root, subpart_root = roots_from_trace()
        lines: List[str] = [header, ""]

        for n in trace:
            t = n.get("ntype")
            uid = n.get("uuid")
            if t == "Document":
                lines.append(f"### 📄 Document")
                lines.append(f"- **Label:** {self._md_escape(n.get('label'))}")
                lines.append(f"- **Title:** {self._md_escape(n.get('title'))}")
                lines.append(
                    f"- **Issuer / Amd / Eff:** {self._md_escape(n.get('issuer'))} / {self._md_escape(n.get('amendment'))} / {self._md_escape(n.get('effective_date'))}")
                if include_uuids: lines.append(f"- **UUID:** `{uid}`")
            elif t == "Subpart":
                lines.append(f"### 🧩 Subpart")
                lines.append(f"- **Label:** {self._md_escape(n.get('label'))}")
                #lines.append(f"- **Code / Title:** {self._md_escape(n.get('code'))} / {self._md_escape(n.get('title'))}")
                if include_uuids: lines.append(f"- **UUID:** `{uid}`")
            elif t == "Heading":
                lines.append(f"### 🔖 Heading")
                lines.append(f"- **Label:** {self._md_escape(n.get('label'))}")
                if include_uuids: lines.append(f"- **UUID:** `{uid}`")
            elif t == "Section":
                lines.append(f"### § Section")
                lines.append(f"- **Label:** {self._md_escape(n.get('label'))}")
                #lines.append(f"- **Number / Title:** `{self._md_escape(n.get('number'))}` / {self._md_escape(n.get('title'))}")
                #lines.append(f"- **Type:** {self._md_escape(n.get('section_type'))}")
                if include_uuids: lines.append(f"- **UUID:** `{uid}`")
            elif t == "Guidance":
                lines.append(f"### 📘 Guidance")
                lines.append(f"- **Label:** {self._md_escape(n.get('label'))}")
                lines.append(f"- **Number / Title:** `{self._md_escape(n.get('number'))}` / {self._md_escape(n.get('title'))}")
                lines.append(f"- **Kind:** {self._md_escape(n.get('guidance_type'))}")
                if include_uuids: lines.append(f"- **UUID:** `{uid}`")
            elif t == "Paragraph":
                lines.append(f"### ¶ Paragraph `{self._md_escape(n.get('paragraph_id'))}`")
                lines.append(f"- **Class:** {self._md_escape(n.get('classification'))}")
                lines.append(f"- **Reason:** {self._md_escape(n.get('classification_reason'))}")
                if include_text and n.get("text"):
                    lines.append("")
                    lines.append(self._wrap_md(f"> {self._md_escape(n['text'])}", width=100))
                if include_uuids: lines.append(f"- **UUID:** `{uid}`")
            else:
                lines.append(f"### {t}")
                if include_uuids: lines.append(f"- **UUID:** `{uid}`")

            lines.append("")  # spacing between nodes

        # Context footer
        lines.append(f"> **Context:** section_root=`{section_root or 'n/a'}` ; subpart_root=`{subpart_root or 'n/a'}`")
        lines.append("")
        return "\n".join(lines)

    def format_intents_block(
            self,
            trace: List[Dict],
            intents: List[Dict],
            *,
            include_uuids: bool = True,
            fields: List[str],  # REQUIRED
            labels: Optional[Dict[str, str]] = None,
            include_levels: Optional[List[str]] = None,  # ["section"], ["trace"], ["section","trace"]
    ) -> str:
        """
        Markdown-format intents grouped by the node they attach to.

        - Only renders keys explicitly listed in `fields`.
        - `labels`: optional pretty labels for keys; defaults to Title Case of key.
        - `include_levels`: control which intents are shown.
           "section" → Section-level intent(s)
           "trace"   → Bottom paragraph intent only
           If None/blank, defaults to ["trace"].
        """

        def pretty_label(k: str) -> str:
            if labels and k in labels:
                return labels[k]
            return k.replace("_", " ").strip().capitalize()

        def render_value(key: str, val: Union[str, int, float, bool, list, dict]) -> List[str]:
            if isinstance(val, (str, int, float, bool)):
                return [f"- **{pretty_label(key)}:** {self._md_escape(str(val))}"]
            if isinstance(val, (list, tuple)):
                if not val:
                    return []
                out = [f"- **{pretty_label(key)}:**"]
                out += [f"  - {self._md_escape(str(item))}" for item in val]
                return out
            if isinstance(val, dict):
                if not val:
                    return []
                out = [f"- **{pretty_label(key)}:**"]
                out += [f"  - **{self._md_escape(str(dk))}:** {self._md_escape(str(dv))}" for dk, dv in val.items()]
                return out
            return [f"- **{pretty_label(key)}:** {self._md_escape(str(val))}"]

        lines: List[str] = ["## 🔵 Intent within this trace", ""]
        intents_by_node = {b.get("uuid_node"): b for b in (intents or []) if b.get("uuid_node")}

        if not intents_by_node:
            lines.append("> *(no intents)*")
            return "\n".join(lines)

        # --- normalize include_levels ---
        valid_levels = {"section", "trace"}
        if not include_levels:
            include_levels = ["trace"]
        else:
            include_levels = [
                                 (lvl or "").strip().lower() for lvl in include_levels
                                 if (lvl or "").strip().lower() in valid_levels
                             ] or ["trace"]

        # --- pick nodes to render (preserve requested order, dedupe) ---
        nodes_to_render: List[Dict] = []
        seen_uuids = set()

        # helper: prefer a Section in TRACE that HAS an intent; else take first Section from INTENTS
        def pick_section_node() -> Optional[Dict]:
            # prefer a Section node present in trace AND in intents
            for n in trace:
                if n.get("ntype") == "Section" and n.get("uuid") in intents_by_node:
                    return n
            # fallback: any Section from intents list
            for i in intents:
                if i.get("ntype") == "Section":
                    return {
                        "uuid": i.get("uuid_node"),
                        "ntype": "Section",
                        "label": i.get("label") or "Section",
                    }
            return None

        def pick_bottom_paragraph() -> Optional[Dict]:
            return next((n for n in reversed(trace) if n.get("ntype") == "Paragraph"), None)

        for level in include_levels:
            if level == "section":
                section_node = pick_section_node()
                if section_node:
                    uuid = section_node.get("uuid")
                    if uuid and uuid in intents_by_node and uuid not in seen_uuids:
                        nodes_to_render.append(section_node);
                        seen_uuids.add(uuid)
            elif level == "trace":
                bottom_para = pick_bottom_paragraph()
                if bottom_para:
                    uuid = bottom_para.get("uuid")
                    if uuid and uuid in intents_by_node and uuid not in seen_uuids:
                        nodes_to_render.append(bottom_para);
                        seen_uuids.add(uuid)

        if not nodes_to_render:
            lines.append("> *(no matching intents)*")
            return "\n".join(lines)

        # --- render ---
        for node in nodes_to_render:
            nid, ntype = node.get("uuid"), node.get("ntype")
            header_val = node.get("paragraph_id") if ntype == "Paragraph" else node.get("label")
            h = f"### {ntype}: {self._md_escape(header_val)}"
            if include_uuids:
                h += f"\n`uuid: {nid}`"
            lines += [h, ""]

            # render only whitelisted fields
            node_intents = intents_by_node[nid].get("intents", [])
            for it in node_intents:
                rendered_any = False
                for key in fields:
                    if key in it and it[key] not in (None, "", [], {}):
                        lines.extend(render_value(key, it[key]))
                        rendered_any = True
                if rendered_any:
                    lines.append("")

        return "\n".join(lines)

    def format_citations_block(
            self,
            trace: List[Dict[str, Any]],
            cites: List[Dict[str, Any]],
            *,
            include_uuids: bool = True
    ) -> str:
        """Markdown for inbound/outbound CITES, showing only nodes that actually have citations,
        and including a human-friendly label next to the node type."""

        # --- helpers to mine labels from the TRACE record ---
        def roots_from_trace():
            section_root = next(
                (n.get("number", "").replace("CS ", "").strip()
                 for n in trace if n.get("ntype") == "Section"),
                None
            )
            subpart_label = next(
                (n.get("label", "") for n in trace if n.get("ntype") == "Subpart"),
                ""
            )
            subpart_root = subpart_label.split("–")[0].strip().lower() if subpart_label else None
            return section_root, subpart_root

        def node_from_trace(uuid_node: str) -> Optional[Dict[str, Any]]:
            for n in trace:
                if n.get("uuid") == uuid_node:
                    return n
            return None

        def node_pretty_label(n: Optional[Dict[str, Any]]) -> str:
            if not n:
                return ""
            t = n.get("ntype")
            if t == "Document":
                return self._md_escape(n.get("label") or "")
            if t == "Subpart":
                return self._md_escape(n.get("label") or "")
            if t == "Heading":
                return self._md_escape(n.get("label") or "")
            if t == "Section":
                num = self._md_escape(n.get("number") or "")
                title = self._md_escape(n.get("title") or "")
                return f"{num} / {title}".strip(" /")
            if t == "Guidance":
                num = self._md_escape(n.get("number") or "")
                title = self._md_escape(n.get("title") or "")
                return f"{num} / {title}".strip(" /")
            if t == "Paragraph":
                pid = self._md_escape(n.get("paragraph_id") or "")
                return pid
            # fallback
            return self._md_escape(n.get("label") or n.get("number") or "")

        # scope classification (internal/external) based on roots
        section_root, subpart_root = roots_from_trace()

        def scope(tag: Optional[str]) -> str:
            if not tag:
                return "unknown"
            internal = ((section_root and section_root in tag) or
                        (subpart_root and subpart_root in (tag or "").lower()))
            return "internal" if internal else "external"

        lines: List[str] = ["## 🔵 Citations within this trace", ""]
        if not cites:
            lines.append("> *(no citations)*")
            lines.append("")
            return "\n".join(lines)

        any_rendered = False

        for entry in cites:
            nid = entry.get("uuid_node")
            ntype = entry.get("ntype")
            inbound = entry.get("inbound_cites") or []
            outbound = entry.get("outbound_cites") or []

            # Skip nodes with no citations at all
            if not inbound and not outbound:
                continue

            any_rendered = True

            # Build header with human label
            n = node_from_trace(nid)
            human = node_pretty_label(n)
            # Choose a nice prefix for types
            prefix = {
                "Document": "📄 Document",
                "Subpart": "🧩 Subpart",
                "Heading": "🔖 Heading",
                "Section": "§ Section",
                "Guidance": "📘 Guidance",
                "Paragraph": "¶ Paragraph",
            }.get(ntype, ntype or "Node")

            if ntype == "Paragraph" and human:
                header = f"### {prefix} — `{human}`"
            elif human:
                header = f"### {prefix} — {human}"
            else:
                header = f"### {prefix}"

            if include_uuids and nid:
                header += f"\n`uuid: {nid}`"

            lines.append(header)

            # Inbound block
            if inbound:
                lines.append("- **Inbound:**")
                for c in inbound:
                    ref = c.get("ref") or {}
                    src = ref.get("ref_source")
                    sc = scope(src)
                    lines.append(
                        f"  - from: `{self._md_escape(src)}` ({sc}); "
                        f"role: {self._md_escape(ref.get('role'))}; "
                        f"reason: {self._md_escape(ref.get('comment'))}"
                    )
                    if include_uuids:
                        lines.append(
                            f"    - `src_uuid: {c.get('source')}` ({c.get('source_ntype')}); "
                            f"`tgt_uuid: {c.get('target')}` ({c.get('target_ntype')})"
                        )

            # Outbound block
            if outbound:
                lines.append("- **Outbound:**")
                for c in outbound:
                    ref = c.get("ref") or {}
                    tgt = ref.get("ref_target")
                    tc = scope(tgt)
                    lines.append(
                        f"  - to: `{self._md_escape(tgt)}` ({tc}); "
                        f"role: {self._md_escape(ref.get('role'))}; "
                        f"reason: {self._md_escape(ref.get('comment'))}"
                    )
                    if include_uuids:
                        lines.append(
                            f"    - `src_uuid: {c.get('source')}` ({c.get('source_ntype')}); "
                            f"`tgt_uuid: {c.get('target')}` ({c.get('target_ntype')})"
                        )

            lines.append("")  # spacing between nodes

        if not any_rendered:
            lines.append("> *(no citations)*")
            lines.append("")
            return "\n".join(lines)

        # Context footer
        lines.append(
            f"> **Context:** section_root=`{section_root or 'n/a'}` ; "
            f"subpart_root=`{subpart_root or 'n/a'}`"
        )
        lines.append("")
        return "\n".join(lines)

    # ------------------------------
    # Internals: TRACE
    # ------------------------------

    def _build_trace(self, bottom_uuid: str) -> List[Dict[str, Any]]:
        """
        Walk upward via incoming CONTAINS edges until the root (Document).
        Returns list (Document → … → Paragraph(bottom)).
        Each node record is normalized for LLM use.
        """
        if bottom_uuid not in self.G:
            return []

        path: List[Dict[str, Any]] = []
        cur = bottom_uuid
        visited = set()

        while cur and cur not in visited:
            visited.add(cur)
            n = self.G.nodes.get(cur, {})
            ntype = n.get("ntype")

            # Normalize fields so the LLM consistently sees keys
            rec: Dict[str, Any] = {"uuid": cur, "ntype": ntype}

            if ntype == "Document":
                rec.update({
                    "label": n.get("label"),
                    "title": n.get("title"),
                    "issuer": n.get("issuer"),
                    "amendment": n.get("current_amendment"),
                    "effective_date": n.get("effective_date"),
                })
            elif ntype == "Subpart":
                rec.update({"label": n.get("label"), "code": n.get("code"), "title": n.get("title")})
            elif ntype == "Heading":
                rec.update({"label": n.get("label")})
            elif ntype == "Section":
                rec.update({
                    "label": n.get("label"),
                    "number": n.get("number"),
                    "title": n.get("title"),
                    "section_type": n.get("section_type"),
                })
            elif ntype == "Guidance":
                rec.update({
                    "label": n.get("label"),
                    "number": n.get("number"),
                    "title": n.get("title"),
                    "guidance_type": n.get("guidance_type"),
                })
            elif ntype == "Paragraph":
                rec.update({
                    "paragraph_id": n.get("paragraph_id"),
                    "text": n.get("text"),
                    "classification": n.get("classification"),
                    "classification_reason": n.get("classification_reason"),
                })
            else:
                # Keep unknowns minimal but present
                rec.update({"label": n.get("label") or n.get("number")})

            path.append(rec)

            # Move to parent via incoming CONTAINS
            parents = [
                u for (u, v, d) in self.G.in_edges(cur, data=True)
                if d.get("relation") == "CONTAINS"
            ]
            cur = parents[0] if parents else None

        return list(reversed(path))

    # ------------------------------
    # Internals: CITES
    # ------------------------------

    def _collect_cites(self, trace: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        For each node in trace, collect inbound/outbound CITES edges.
        Returns a list of per-node citation summaries:
          {
            "uuid_node": str,
            "ntype": str,
            "inbound_cites": [ {source,target,source_ntype,target_ntype,ref} ],
            "outbound_cites": [ ... ]
          }
        """
        out: List[Dict[str, Any]] = []
        if not trace:
            return out

        for node_entry in trace:
            nid = node_entry.get("uuid")
            ntype = node_entry.get("ntype")
            if not nid:
                continue

            inbound, outbound = [], []

            # inbound CITES  (src -> nid)
            for src, _, d in self.G.in_edges(nid, data=True):
                if d.get("relation") == "CITES":
                    inbound.append({
                        "source": src,
                        "target": nid,
                        "source_ntype": self.G.nodes.get(src, {}).get("ntype"),
                        "target_ntype": ntype,
                        "ref": d.get("ref"),
                    })

            # outbound CITES (nid -> tgt)
            for _, tgt, d in self.G.out_edges(nid, data=True):
                if d.get("relation") == "CITES":
                    outbound.append({
                        "source": nid,
                        "target": tgt,
                        "source_ntype": ntype,
                        "target_ntype": self.G.nodes.get(tgt, {}).get("ntype"),
                        "ref": d.get("ref"),
                    })

            out.append({
                "uuid_node": nid,
                "ntype": ntype,
                "inbound_cites": inbound,
                "outbound_cites": outbound
            })

        return out

    # ------------------------------
    # Internals: INTENTS
    # ------------------------------

    def _collect_intents(self, trace: List[Dict[str, Any]], bottom_uuid: str) -> List[Dict[str, Any]]:
        """
        Collects HAS_INTENT attached to:
          - any node in the trace (e.g., Section → Intent)
          - the Trace that anchors to the bottom paragraph (Trace --HAS_ANCHOR--> bottom, then Trace --HAS_INTENT--> Intent)
        Merges by node (uuid_node).
        Returns:
          [
            { "uuid_node": <node uuid>, "ntype": <type>, "intents": [ {intent fields...} ] }
          ]
        """
        intents_by_node: Dict[str, Dict[str, Any]] = {}

        def add(uuid_node: str, ntype: str, intent_node: Dict[str, Any]):
            bucket = intents_by_node.setdefault(
                uuid_node, {"uuid_node": uuid_node, "ntype": ntype, "intents": []}
            )
            bucket["intents"].append({
                "uuid_intent": intent_node.get("uuid"),
                "intent": intent_node.get("intent"),
                "summary": intent_node.get("summary"),
                "events": intent_node.get("events"),
            })

        # 1) HAS_INTENT from any node in trace
        for rec in trace:
            nid, ntype = rec.get("uuid"), rec.get("ntype")
            if not nid:
                continue
            for _, tgt, d in self.G.out_edges(nid, data=True):
                if d.get("relation") != "HAS_INTENT":
                    continue
                inode = self.G.nodes.get(tgt, {})
                if inode.get("ntype") == "Intent":
                    intent_norm = dict(inode)
                    intent_norm.setdefault("uuid", tgt)
                    add(nid, ntype, intent_norm)

        # 2) bottom paragraph → Trace → Intent
        # find Trace with HAS_ANCHOR to bottom_uuid
        for trc, _, d in self.G.in_edges(bottom_uuid, data=True):
            if d.get("relation") != "HAS_ANCHOR":
                continue
            if self.G.nodes.get(trc, {}).get("ntype") != "Trace":
                continue
            # the intent hanging off this trace
            for _, tgt, d2 in self.G.out_edges(trc, data=True):
                if d2.get("relation") != "HAS_INTENT":
                    continue
                inode = self.G.nodes.get(tgt, {})
                if inode.get("ntype") == "Intent":
                    intent_norm = dict(inode)
                    intent_norm.setdefault("uuid", tgt)
                    # attach this under the bottom paragraph node in the trace
                    add(bottom_uuid, "Paragraph", intent_norm)

        # emit list
        return list(intents_by_node.values())

    # ------------------------------
    # Private Markdown helpers
    # ------------------------------

    def _md_escape(self, s: Optional[str]) -> str:
        """Escape < and > for safe Markdown output."""
        return (s or "").replace("<", "&lt;").replace(">", "&gt;")

    def _wrap_md(self, txt: str, width: int = 100, indent: int = 0) -> str:
        """Wrap long text into Markdown-friendly lines."""
        if not txt:
            return ""
        return textwrap.fill(
            txt.strip(),
            width=width,
            initial_indent=" " * indent,
            subsequent_indent=" " * indent,
        )

    # ---------------------------------------------------------------------
    # Frontend Outline Builder - mirror CS25 outline
    # ---------------------------------------------------------------------
    def build_outline_for_frontend(self) -> tuple[dict, dict]:
        """
        Build a stable, nested outline of the document hierarchy suitable for a UI.
        Returns: (outline_tree, indices)
        """
        G = self.G
        if G is None or len(G) == 0:
            return {}, {"uuid_to_node": {}, "uuid_to_path": {}, "bottom_uuid_to_path": {}}

        from collections import defaultdict
        import re

        # --- roots: Documents (or indegree==0 fallback) ---
        doc_nodes = [nid for nid, d in G.nodes(data=True) if d.get("ntype") == "Document"]
        if not doc_nodes:
            doc_nodes = [nid for nid in G.nodes() if G.in_degree(nid) == 0]

        # --- helpers --------------------------------------------------------------

        def _add_child(parent: dict, child: dict) -> None:
            parent.setdefault("children", []).append(child)

        # Natural sort for sections / paragraphs
        _ROMAN = {
            'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10,
            'xi': 11, 'xii': 12, 'xiii': 13, 'xiv': 14, 'xv': 15, 'xvi': 16, 'xvii': 17, 'xviii': 18, 'xix': 19,
            'xx': 20
        }
        INF = 10 ** 9

        def _parse_first_section_pair(s: str) -> tuple[int, int]:
            """Extract (25, 20) from 'CS 25.20 Scope' or '25.20' etc."""
            if not s:
                return (INF, INF)
            m = re.search(r'(\d+)\.(\d+)', s)
            if m:
                return (int(m.group(1)), int(m.group(2)))
            return (INF, INF)

        def _paragraph_key_from_pid(pid: str) -> tuple:
            """Natural sort for paragraph ids like 25.20(b)(1)(i)."""
            m = re.match(r'^\s*(\d+)\.(\d+)(.*)$', pid or "")
            if not m:
                return (INF, INF, ())
            major, minor, rest = int(m.group(1)), int(m.group(2)), m.group(3)
            toks = re.findall(r'\(([^)]+)\)', rest)

            def tok_key(t: str) -> tuple:
                t = t.strip()
                if t.isdigit():
                    return (0, int(t))
                tl = t.lower()
                if tl in _ROMAN:
                    return (1, _ROMAN[tl])
                if len(t) == 1 and t.isalpha():
                    return (2, ord(t.lower()) - ord('a'))
                return (3, t)

            return (major, minor, tuple(tok_key(t) for t in toks))

        # Gather children by CONTAINS for quick traversal
        contains_children: dict[str, list[str]] = defaultdict(list)
        for u, v, edata in G.edges(data=True):
            if edata.get("relation") == "CONTAINS":
                contains_children[u].append(v)

        # Precompute each Section's numeric key
        section_key: dict[str, tuple[int, int]] = {}
        for nid, d in G.nodes(data=True):
            if d.get("ntype") == "Section":
                # prefer 'number'; fall back to 'label' if needed
                key = _parse_first_section_pair(d.get("number") or d.get("label") or "")
                section_key[nid] = key

        # Compute the minimal section key under a node's subtree (memoized)
        memo_min_key: dict[str, tuple[int, int]] = {}

        def min_section_key(nid: str) -> tuple[int, int]:
            if nid in memo_min_key:
                return memo_min_key[nid]
            d = G.nodes.get(nid, {})
            ntype = d.get("ntype")

            if ntype == "Section":
                val = section_key.get(nid, (INF, INF))
                memo_min_key[nid] = val
                return val

            best = (INF, INF)
            for child in contains_children.get(nid, []):
                ck = min_section_key(child)
                if ck < best:
                    best = ck
            memo_min_key[nid] = best
            return best

        # Sorting keys (now driven by min_section_key where it matters)
        def _section_sort_key(nid: str) -> tuple:
            # direct numeric section key, fallback keeps label/title stable
            key = section_key.get(nid, (INF, INF))
            d = G.nodes.get(nid, {})
            return (*key, d.get("label") or "", d.get("title") or "")

        def _subpart_sort_key(nid: str) -> tuple:
            # order by earliest section contained in the subpart
            key = min_section_key(nid)
            d = G.nodes.get(nid, {})
            # tie-breakers for stability
            return (*key, d.get("code") or "", d.get("label") or "")

        def _heading_sort_key(nid: str) -> tuple:
            # CRITICAL: order headings by the earliest section they contain
            key = min_section_key(nid)
            d = G.nodes.get(nid, {})
            return (*key, d.get("label") or "")

        def _paragraph_sort_key(nid: str) -> tuple:
            d = G.nodes.get(nid, {})
            return _paragraph_key_from_pid(d.get("paragraph_id") or "")

        # Indices we’ll populate
        uuid_to_node: dict[str, dict] = {}
        uuid_to_path: dict[str, list[str]] = {}
        bottom_uuid_to_path: dict[str, list[str]] = {}

        def _make_outline_node(nid: str) -> dict:
            d = G.nodes.get(nid, {})
            t = d.get("ntype")
            out = {"type": t, "uuid": nid}
            if t == "Document":
                out["label"] = d.get("label");
                out["title"] = d.get("title")
            elif t == "Subpart":
                out["label"] = d.get("label");
                out["code"] = d.get("code");
                out["title"] = d.get("title")
            elif t == "Heading":
                out["label"] = d.get("label")
            elif t == "Section":
                out["label"] = d.get("label");
                out["number"] = d.get("number");
                out["title"] = d.get("title")
            elif t == "Guidance":
                out["label"] = d.get("label");
                out["number"] = d.get("number");
                out["title"] = d.get("title")
            elif t == "Paragraph":
                out["paragraph_id"] = d.get("paragraph_id");
                out["results"] = []
            else:
                out["label"] = d.get("label") or d.get("number") or d.get("paragraph_id")
            return out

        def _ordered_children(parent_id: str) -> list[str]:
            kids = contains_children.get(parent_id, [])
            buckets: dict[str, list[str]] = defaultdict(list)
            for k in kids:
                buckets[G.nodes.get(k, {}).get("ntype", "Other")].append(k)

            ordered_ids: list[str] = []
            for t in ("Subpart", "Heading", "Section", "Guidance", "Paragraph"):
                if t not in buckets:
                    continue
                arr = buckets[t]
                if t == "Subpart":
                    arr.sort(key=_subpart_sort_key)
                elif t == "Heading":
                    arr.sort(key=_heading_sort_key)  # <-- key fix
                elif t == "Section":
                    arr.sort(key=_section_sort_key)
                elif t == "Paragraph":
                    arr.sort(key=_paragraph_sort_key)
                else:
                    arr.sort()
                ordered_ids.extend(arr)

            for t, arr in buckets.items():
                if t in ("Subpart", "Heading", "Section", "Guidance", "Paragraph"):
                    continue
                ordered_ids.extend(sorted(arr))
            return ordered_ids

        def _walk_build(nid: str, path_prefix: list[str]) -> dict:
            node = _make_outline_node(nid)
            uuid_to_node[nid] = node
            my_path = path_prefix + [nid]
            uuid_to_path[nid] = my_path
            if node.get("type") == "Paragraph":
                bottom_uuid_to_path[nid] = my_path
            for cid in _ordered_children(nid):
                _add_child(node, _walk_build(cid, my_path))
            return node

        # Build forest or single root
        if len(doc_nodes) > 1:
            root = {"type": "Corpus", "children": []}
            uuid_to_node["__corpus__"] = root
            uuid_to_path["__corpus__"] = ["__corpus__"]
            for doc_id in sorted(doc_nodes, key=lambda x: (self.G.nodes.get(x, {}).get("label") or "")):
                _add_child(root, _walk_build(doc_id, ["__corpus__"]))
        else:
            root_id = doc_nodes[0]
            root = _walk_build(root_id, [])

        indices = {
            "uuid_to_node": uuid_to_node,
            "uuid_to_path": uuid_to_path,
            "bottom_uuid_to_path": bottom_uuid_to_path,
        }
        return root, indices

    def attach_result(self, outline_root: dict, indices: dict, item: dict) -> bool:
        """
        Append a streaming 'item' (from item_done) into the correct Paragraph node's `results` list.
        Returns True if inserted, False if no matching paragraph uuid found.
        Expected item shape (yours): { trace_uuid, bottom_uuid, bottom_clause, response, usage, run_id }
        """
        bottom_uuid = item.get("bottom_uuid")
        if not bottom_uuid:
            return False
        uuid_to_node: dict = indices.get("uuid_to_node") or {}
        para_node = uuid_to_node.get(bottom_uuid)
        if not para_node or para_node.get("type") != "Paragraph":
            return False
        para_node.setdefault("results", []).append(item)
        return True

    # ---------------------------------------------------------------------
    # Frontend Outline Builder - build from traces
    # ---------------------------------------------------------------------

    def _children_map(self) -> dict[str, list[str]]:
        """parent -> [children] for CONTAINS edges."""
        kids: dict[str, list[str]] = defaultdict(list)
        for u, v, ed in self.G.edges(data=True):
            if ed.get("relation") == "CONTAINS":
                kids[u].append(v)
        return kids

    def _parent_map(self) -> dict[str, str]:
        """child -> parent for CONTAINS edges."""
        parent: dict[str, str] = {}
        for u, v, ed in self.G.edges(data=True):
            if ed.get("relation") == "CONTAINS":
                parent[v] = u
        return parent

    def _child_sort_key(self, nid: str) -> tuple:
        """Stable, human-friendly ordering for siblings (same spirit as your section/paragraph sort)."""
        d = self.G.nodes.get(nid, {})
        t = d.get("ntype")
        if t == "Subpart":
            return (0, d.get("code") or "", d.get("label") or "")
        if t == "Heading":
            return (1, d.get("label") or "")
        if t == "Section":
            return (2, d.get("number") or "", d.get("title") or "", d.get("label") or "")
        if t == "Guidance":
            return (3, d.get("number") or "", d.get("title") or "", d.get("label") or "")
        if t == "Paragraph":
            return (4, d.get("paragraph_id") or "")
        # fallback
        return (9, d.get("label") or d.get("number") or d.get("title") or "")

    def _ordered_children_ids(self, children_map: dict[str, list[str]], parent_id: str) -> list[str]:
        arr = list(children_map.get(parent_id, []))
        arr.sort(key=self._child_sort_key)
        return arr

    def _labels_section_to_bottom(self, parent_map: dict[str, str], section_id: str, bottom_id: str) -> list[str]:
        """
        Build pretty labels from Section → ... → bottom Paragraph (inclusive).
        e.g. ["CS 25.1309", "25.1309(b)", "25.1309(b)(1)", "25.1309(b)(1)(i)"]
        """
        cur = bottom_id
        labels: list[str] = []
        while cur:
            d = self.G.nodes.get(cur, {})
            t = d.get("ntype")
            if t == "Paragraph":
                labels.append(d.get("paragraph_id") or d.get("label") or cur)
            elif t == "Section":
                labels.append(d.get("number") or d.get("label") or d.get("title") or cur)
                break
            elif t == "Heading":
                labels.append(d.get("label") or cur)
            else:
                labels.append(d.get("label") or d.get("number") or d.get("title") or cur)
            cur = parent_map.get(cur)
        labels.reverse()
        return labels

    def _rank_tuple_along_path(
            self,
            children_map: dict[str, list[str]],
            parent_map: dict[str, str],
            section_id: str,
            bottom_id: str,
    ) -> tuple:
        """
        Stable sort key for a bottom paragraph under its Section:
        rank = (index at section level, index at heading, index at paragraph group, ...)
        """
        ranks: list[int] = []
        cur = bottom_id
        chain = [cur]
        # climb to the section
        while cur in parent_map:
            cur = parent_map[cur]
            chain.append(cur)
            if cur == section_id:
                break
        chain.reverse()  # [section, ..., bottom]

        for i in range(len(chain) - 1):
            parent, child = chain[i], chain[i + 1]
            ordered = self._ordered_children_ids(children_map, parent)
            try:
                idx = ordered.index(child)
            except ValueError:
                idx = 10 ** 6
            ranks.append(idx)
        return tuple(ranks)

    def build_section_traces_for_frontend(self) -> tuple[dict, dict]:
        """
        Build UI-friendly trace rows per Section using explicit Trace nodes.

        Returns:
          section_traces: {
            <section_uuid>: [
              {
                "trace_uuid": <str>,
                "bottom_uuid": <str>,
                "bottom_paragraph_id": <str | None>,
                "path_labels": <list[str]>,   # e.g. ["CS 25.20", "25.20(b)", "25.20(b)(1)"]
                "results": [],                # place to append streamed item results (optional)
              },
              ...
            ],
            ...
          }

          trace_lookup: {
            <trace_uuid>: { "section_uuid": <str>, "index": <int>, "bottom_uuid": <str> },
            ...
          }
        """
        children_map = self._children_map()
        parent_map = self._parent_map()

        # 1) collect Trace nodes
        trace_nodes = [(nid, d) for nid, d in self.G.nodes(data=True) if d.get("ntype") == "Trace"]

        # 2) bucket rows under owning Section (unsorted first)
        buckets: dict[str, list[dict]] = defaultdict(list)

        for tid, td in trace_nodes:
            bottom_uuid = td.get("bottom_uuid")
            if not bottom_uuid or bottom_uuid not in self.G.nodes:
                continue

            # climb parent chain to the Section that owns this paragraph
            cur = bottom_uuid
            section_id: Optional[str] = None
            while cur in parent_map:
                cur = parent_map[cur]
                if self.G.nodes[cur].get("ntype") == "Section":
                    section_id = cur
                    break
            if not section_id:
                continue  # skip traces not beneath a Section

            labels = self._labels_section_to_bottom(parent_map, section_id, bottom_uuid)
            rank = self._rank_tuple_along_path(children_map, parent_map, section_id, bottom_uuid)

            buckets[section_id].append({
                "trace_uuid": tid,
                "bottom_uuid": bottom_uuid,
                "bottom_paragraph_id": self.G.nodes[bottom_uuid].get("paragraph_id"),
                "path_labels": labels,
                "rank": rank,  # temp, used for sort below
                "results": [],  # optional server-seed
            })

        # 3) sort rows by rank & build lookup
        section_traces: dict[str, list[dict]] = {}
        trace_lookup: dict[str, dict] = {}

        for sid, rows in buckets.items():
            rows.sort(key=lambda r: r["rank"])
            cleaned: list[dict] = []
            for i, r in enumerate(rows):
                trace_lookup[r["trace_uuid"]] = {
                    "section_uuid": sid,
                    "index": i,
                    "bottom_uuid": r["bottom_uuid"],
                }
                cleaned.append({
                    "trace_uuid": r["trace_uuid"],
                    "bottom_uuid": r["bottom_uuid"],
                    "bottom_paragraph_id": r["bottom_paragraph_id"],
                    "path_labels": r["path_labels"],
                    "results": r["results"],
                })
            section_traces[sid] = cleaned

        return section_traces, trace_lookup

    def append_trace_result(
            self,
            section_traces: dict,
            trace_lookup: dict,
            item: dict,
    ) -> dict:
        """
        Immutably append one streamed item (from item_done.item) to the correct trace row.

        item is expected to include trace_uuid (preferred) or bottom_uuid (fallback).
        Returns a NEW section_traces dict (safe for React state updates).
        """
        t_id: Optional[str] = item.get("trace_uuid")
        btm: Optional[str] = item.get("bottom_uuid")

        # 1) Resolve section & index
        sid: Optional[str] = None
        idx: Optional[int] = None

        if t_id and t_id in trace_lookup:
            sid = trace_lookup[t_id]["section_uuid"]
            idx = trace_lookup[t_id]["index"]
        elif btm:
            # Fallback: scan to find by bottom_uuid
            for sec, rows in section_traces.items():
                for i, r in enumerate(rows):
                    if r.get("bottom_uuid") == btm:
                        sid, idx = sec, i
                        break
                if sid:
                    break

        if sid is None or idx is None:
            return section_traces  # nothing to do

        # 2) append immutably
        rows = section_traces.get(sid, [])
        if idx < 0 or idx >= len(rows):
            return section_traces

        row = rows[idx]
        new_row = dict(row)
        new_row["results"] = (row.get("results") or []) + [item]

        new_rows = rows[:]
        new_rows[idx] = new_row

        new_section_traces = dict(section_traces)
        new_section_traces[sid] = new_rows
        return new_section_traces

    def enrich_sections_with_intents(
            self,
            outline_root: dict,
            uuid_to_node: dict[str, dict],
    ) -> None:
        """
        For every 'Section' node in the OUTLINE, follow HAS_INTENT edges in the graph
        to 'Intent' nodes and attach their key fields to the outline node.

        Outline Section node after enrichment will have either:
          - node["intent"] = { summary, intent, events, uuid? }  (single)
          - node["intents"] = [ { ... }, ... ]                   (multiple)
        """
        G = self.G
        if G is None or len(G) == 0:
            return

        for sec_uuid, out_node in uuid_to_node.items():
            if out_node.get("type") != "Section":
                continue
            if not G.has_node(sec_uuid):
                continue

            intents = []
            # outgoing edges from Section
            for _, v, ed in G.out_edges(sec_uuid, data=True):
                if ed.get("relation") != "HAS_INTENT":
                    continue
                nd = G.nodes.get(v, {})
                if nd.get("ntype") != "Intent":
                    continue

                # extract safe, JSON-serializable fields
                intents.append({
                    "uuid": v,
                    "summary": nd.get("summary"),
                    "intent": nd.get("intent"),
                    "events": nd.get("events"),
                })

            if not intents:
                continue

            # attach (prefer single object when only one)
            if len(intents) == 1:
                out_node["intent"] = intents[0]
            else:
                out_node["intents"] = intents

    # --- NEW: iterate all Section nodes ---------------------------------
    # following functions are for rank_sections_by_intent_tool
    #
    #
    # ======================
    def iter_section_nodes(self) -> list[dict]:
        out = []
        for nid, d in self.G.nodes(data=True):
            if d.get("ntype") == "Section":
                out.append({
                    "section_uuid": nid,
                    "number": d.get("number"),
                    "title": d.get("title"),
                    "label": d.get("label"),
                })
        return out

    # --- NEW: generic upward trace starting at any node -----------------
    def _build_trace_from_node(self, start_uuid: str) -> list[dict]:
        """
        Walk upward via incoming CONTAINS edges until Document.
        Returns list from Document → … → start_node.
        """
        if start_uuid not in self.G:
            return []
        path, cur, visited = [], start_uuid, set()
        while cur and cur not in visited:
            visited.add(cur)
            n = self.G.nodes.get(cur, {})
            ntype = n.get("ntype")
            rec = {"uuid": cur, "ntype": ntype}

            if ntype == "Document":
                rec.update({"label": n.get("label"), "title": n.get("title"),
                            "issuer": n.get("issuer"),
                            "amendment": n.get("current_amendment"),
                            "effective_date": n.get("effective_date")})
            elif ntype == "Subpart":
                rec.update({"label": n.get("label"), "code": n.get("code"), "title": n.get("title")})
            elif ntype == "Heading":
                rec.update({"label": n.get("label")})
            elif ntype == "Section":
                rec.update({"label": n.get("label"),
                            "number": n.get("number"),
                            "title": n.get("title"),
                            "section_type": n.get("section_type")})
            else:
                rec.update({"label": n.get("label") or n.get("number") or n.get("title")})

            path.append(rec)

            parents = [u for (u, v, d) in self.G.in_edges(cur, data=True) if d.get("relation") == "CONTAINS"]
            cur = parents[0] if parents else None
        return list(reversed(path))

    # --- NEW: collect ONLY section-level intents ------------------------
    def _collect_section_intents_only(self, section_uuid: str) -> list[dict]:
        """
        Follow Section --HAS_INTENT--> Intent and return normalized intent entries.
        """
        if not (section_uuid and section_uuid in self.G):
            return []
        intents = []
        for _, tgt, d in self.G.out_edges(section_uuid, data=True):
            if d.get("relation") != "HAS_INTENT":
                continue
            inode = self.G.nodes.get(tgt, {})
            if inode.get("ntype") == "Intent":
                intents.append({
                    "uuid_intent": tgt,
                    "intent": inode.get("intent"),
                    "summary": inode.get("summary"),
                    "events": inode.get("events"),
                })
        return intents

    # --- NEW: build section bundle (context + intents) ------------------
    def build_records_for_section(self, section_uuid: str) -> dict:
        """
        Returns:
          {
            "section_uuid": <str>,
            "trace": <List[NodeRecord]>   # Document → … → Section
            "intents": <List[IntentRecordForSection]>  # HAS_INTENT from Section
          }
        """
        trace = self._build_trace_from_node(section_uuid)
        intents = self._collect_section_intents_only(section_uuid)
        return {"section_uuid": section_uuid, "trace": trace, "intents": intents}

    # --- NEW: format a compact section context block --------------------
    def format_section_context_block(self, trace: list[dict], *, include_uuids: bool = False) -> str:
        """
        Markdown block: Document → Subpart/Heading → Section (no paragraphs).
        """
        if not trace:
            return "## 🟢 Section Context\n\n> *(no context)*\n"
        lines = ["## 🟢 Section Context", ""]
        for n in trace:
            t, uid = n.get("ntype"), n.get("uuid")
            if t == "Document":
                lines += [f"### 📄 Document",
                          f"- **Label:** {self._md_escape(n.get('label'))}",
                          f"- **Title:** {self._md_escape(n.get('title'))}"]
            elif t == "Subpart":
                lines += [f"### 🧩 Subpart",
                          f"- **Label:** {self._md_escape(n.get('label'))}"]
            elif t == "Heading":
                lines += [f"### 🔖 Heading",
                          f"- **Label:** {self._md_escape(n.get('label'))}"]
            elif t == "Section":
                lines += [f"### § Section",
                          f"- **Label:** {self._md_escape(n.get('label'))}"]
            else:
                lines += [f"### {t}", f"- **Label:** {self._md_escape(n.get('label'))}"]
            if include_uuids and uid:
                lines.append(f"- **UUID:** `{uid}`")
            lines.append("")
        return "\n".join(lines)

    # --- NEW: format section-level intents only -------------------------
    def format_section_intents_block(self, section_uuid: str, intents: list[dict], *,
                                     include_uuids: bool = False) -> str:
        lines = ["## 🔵 Section Intent", ""]
        if not intents:
            lines.append("> *(no section-level intent)*")
            return "\n".join(lines)
        for it in intents:
            if include_uuids:
                lines.append(f"`uuid_intent: {it.get('uuid_intent')}`")
            if it.get("summary"):
                lines.append(f"- **Summary:** {self._md_escape(it['summary'])}")
            #if it.get("intent"):
            #    lines.append(f"- **Intent:** {self._md_escape(it['intent'])}")
            #if it.get("events"):
            #    lines.append(f"- **Events:**")
            #    for ev in (it["events"] or []):
            #        lines.append(f"  - {self._md_escape(ev)}")
            lines.append("")
        return "\n".join(lines)

