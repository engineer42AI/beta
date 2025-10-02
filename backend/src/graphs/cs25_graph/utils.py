# utils.py

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
            labels: Optional[Dict[str, str]] = None,  # optional pretty labels
    ) -> str:
        """
        Markdown-format intents grouped by the node they attach to.

        - Only renders keys explicitly listed in `fields`.
        - `labels`: optional pretty labels for keys; defaults to Title Case of key.
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
                for item in val:
                    out.append(f"  - {self._md_escape(str(item))}")
                return out
            if isinstance(val, dict):
                if not val:
                    return []
                out = [f"- **{pretty_label(key)}:**"]
                for dk, dv in val.items():
                    out.append(f"  - **{self._md_escape(str(dk))}:** {self._md_escape(str(dv))}")
                return out
            return [f"- **{pretty_label(key)}:** {self._md_escape(str(val))}"]

        lines: List[str] = ["## 🔵 Intent within this trace", ""]
        intents_by_node = {b["uuid_node"]: b for b in (intents or [])}

        if not intents_by_node:
            lines.append("> *(no intents)*")
            lines.append("")
            return "\n".join(lines)

        for node in trace:
            nid, ntype = node.get("uuid"), node.get("ntype")
            if not nid or nid not in intents_by_node:
                continue

            header_val = node.get("paragraph_id") if ntype == "Paragraph" else node.get("label")
            h = f"### {ntype}: {self._md_escape(header_val)}"
            if include_uuids:
                h += f"\n`uuid: {nid}`"
            lines += [h, ""]

            for it in intents_by_node[nid].get("intents", []):
                rendered_any = False
                for key in fields:  # only those explicitly provided
                    if key in it and it[key] not in (None, "", [], {}):
                        lines.extend(render_value(key, it[key]))
                        rendered_any = True
                if rendered_any:
                    lines.append("")  # spacing between entries

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
            bucket = intents_by_node.setdefault(uuid_node, {"uuid_node": uuid_node, "ntype": ntype, "intents": []})
            # Normalize two intent schemas into one
            if "section_intent" in intent_node or "ai_notes" in intent_node:
                bucket["intents"].append({
                    "uuid_intent": intent_node.get("uuid"),
                    "section_intent": intent_node.get("section_intent"),
                    "ai_notes": intent_node.get("ai_notes"),
                })
            else:
                bucket["intents"].append({
                    "uuid_intent": intent_node.get("uuid"),
                    "intent": intent_node.get("intent"),
                    "expert_notes": intent_node.get("expert_notes"),
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
