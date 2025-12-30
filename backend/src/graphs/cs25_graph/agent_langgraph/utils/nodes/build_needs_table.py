# backend/src/graphs/cs25_graph/agent_langgraph/utils/nodes/build_needs_table.py

import os
import uuid
import time
import json
import asyncio
import random
import hashlib
from typing import Dict, Any, List, Optional, Tuple, AsyncGenerator

from pydantic import BaseModel, Field
from openai import AsyncOpenAI, APIStatusError
from langchain_core.messages import AIMessage

from src.graphs.cs25_graph.utils import ManifestGraph, GraphOps
from src.graphs.cs25_graph.agent_langgraph.utils.progress_bus import emit as bus_emit


# ------------------ Stable IDs ------------------

def _stable_need_id(trace_uuid: str, statement: str, idx: int) -> str:
    # Deterministic per (trace_uuid, statement, idx) – stable for identical outputs
    base = f"{trace_uuid}::{idx}::{statement.strip().lower()}"
    h = hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]
    return f"need-{h}"


# ------------------ Agent (async, structured output) ------------------

class AgentInputs(BaseModel):
    trace_block: str
    cites_block: str
    intents_block: str
    paragraph_name: str


class Need(BaseModel):
    statement: str = Field(description="Engineering need statement (solution-agnostic, verifiable later).")
    rationale: str = Field(description="BLUF rationale (<20 words). Start with 'Needed because ...'.")
    headline: str = Field(description=(
            "UI headline. Start with one imperative verb. 6–15 words. "
            "Max one 'and'. No implementation terms (system/device/unit/integration). "
            "No vague filler. Output only the statement."
        )
    )


class NeedsOutput(BaseModel):
    needs: List[Need] = Field(description="Zero, one, or multiple needs derived from intent.")


class AsyncAgent:
    def __init__(self, model: str, client: AsyncOpenAI):
        self.model = model
        self.client = client

    async def run(self, query: str, inputs: AgentInputs) -> Dict[str, Any]:
        system = f"""
You are an expert aircraft certification engineer specialising in CS-25 and translating regulatory intent into engineering needs.

Task:
Extract ENGINEERING NEED STATEMENTS from the provided regulatory intent and trace structure for the bottom paragraph: <<{inputs.paragraph_name}>>

A “need” is:
- a statement of what must be true for compliance
- independent of design solution or verification method
- derived from intent (not wording alone)
- suitable for later grouping into compliance demonstration items

Do NOT:
- restate regulation text
- propose means of compliance, tests, analyses
- assign DALs, certification categories
- reference CDIs or verification plans

Each clause may produce zero, one, or multiple needs.

– Use the classification of each paragraph to understand the structure:  
        - Scope setter: sets boundaries.  
        - Normative requirement: creates the obligation.  
        - Condition clause: applies only under listed conditions.  
        - Exception clause: narrows or excludes applicability.  
        - Definition: clarifies technical terms.  
        - Reference only: points to other rules.  
        - Reserved: placeholder, no content.  
        - Guidance: advisory, non-binding explanation.  



Output:
Return JSON matching the schema exactly.
"""

        user_content = f"""
<USER_QUERY>
{query}
</USER_QUERY>

**INPUT TRACES for {inputs.paragraph_name}:** 

<TRACE>
{inputs.trace_block or ""}
</TRACE>

<INTENTS>
{inputs.intents_block or ""}
</INTENTS>
"""
        print(f"============== [E42][NEEDS][PROMPT][SYSTEM] ==============\n {system}")
        print(f"============== [E42][NEEDS][PROMPT][USER] ================\n {user_content}")

        resp = await self.client.responses.parse(
            model=self.model,
            input=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            text_format=NeedsOutput,
        )

        parsed = (
            resp.output_parsed.model_dump()
            if hasattr(resp.output_parsed, "model_dump")
            else resp.output_parsed.dict()
        )

        usage = {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
            "total_tokens": resp.usage.total_tokens,
        }

        return {
            "run_id": f"needs-{uuid.uuid4().hex[:8]}",
            "response": parsed,
            "usage": usage,
        }


# ------------------ Cost helper (schema-agnostic) ------------------

def _enrich_usage_with_costs(usage: Dict[str, Any], pricing_per_million: Tuple[float, float]) -> Dict[str, Any]:
    u = dict(usage or {})
    pin, pout = pricing_per_million
    in_tok  = int(u.get("input_tokens", 0) or 0)
    out_tok = int(u.get("output_tokens", 0) or 0)
    total   = int(u.get("total_tokens", in_tok + out_tok) or (in_tok + out_tok))
    in_cost  = (in_tok  / 1_000_000.0) * pin
    out_cost = (out_tok / 1_000_000.0) * pout
    u.update({
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "total_tokens": total,
        "input_cost": in_cost,
        "output_cost": out_cost,
        "total_cost": in_cost + out_cost,
    })
    return u


# ------------------ Retry wrapper (stable envelope) ------------------

async def _call_with_retry(
    agent: AsyncAgent,
    query: str,
    payload: AgentInputs,
    *,
    max_retries: int = 5
) -> Dict[str, Any]:
    delay = 0.6
    for attempt in range(max_retries):
        try:
            return await agent.run(query, payload)
        except APIStatusError as e:
            code = getattr(e, "status_code", 0)
            retryable = code in (429, 500, 502, 503, 504)
            if retryable and attempt < max_retries - 1:
                await asyncio.sleep(delay + random.uniform(0, 0.4))
                delay = min(delay * 2, 6)
                continue
            break
        except Exception:
            if attempt < max_retries - 1:
                await asyncio.sleep(delay + random.uniform(0, 0.4))
                delay = min(delay * 2, 6)
                continue
            break

    return {
        "run_id": f"needs-{uuid.uuid4().hex[:8]}",
        "response": {"error": "agent_call_failed"},
        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
    }

# -----------------

_OPENAI_CLIENT: Optional[AsyncOpenAI] = None

def get_openai_client() -> AsyncOpenAI:
    global _OPENAI_CLIENT
    if _OPENAI_CLIENT is None:
        _OPENAI_CLIENT = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _OPENAI_CLIENT

# ------------------ Graph runtime cache ------------------

_RUNTIME_CACHE = None

def _get_runtime():
    global _RUNTIME_CACHE
    if _RUNTIME_CACHE is None:
        mg = ManifestGraph()
        mg.load()
        ops = GraphOps(mg.G)
        _RUNTIME_CACHE = (mg, ops)
    return _RUNTIME_CACHE


def _bottom_uuid_for_trace(G, trace_uuid: str) -> Optional[str]:
    try:
        n = G.nodes.get(trace_uuid) or {}
        return n.get("bottom_uuid")
    except Exception:
        return None


def _intent_summary_for_node(intents: Any, uuid_node: Optional[str]) -> str:
    if not uuid_node or not isinstance(intents, list):
        return ""
    for entry in intents:
        if not isinstance(entry, dict):
            continue
        if entry.get("uuid_node") != uuid_node:
            continue
        arr = entry.get("intents") or []
        for it in arr:
            if isinstance(it, dict) and it.get("summary"):
                return str(it["summary"]).strip()
    return ""



# ------------------ One batch, parallel, streaming ------------------

async def _stream_batch_parallel(
    batch_rows: List[Dict[str, Any]],
    *,
    agent: AsyncAgent,
    ops: GraphOps,
    G,
    query: str,
    pricing_per_million: Tuple[float, float],
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Emits:
      batch_start
      items_done   (a batch of StreamedNeedItems for a single trace_uuid)
      batch_progress
      batch_end
    """
    t0 = time.time()
    total = len(batch_rows)
    done = 0

    batch_in_tokens = 0
    batch_out_tokens = 0
    pin, pout = pricing_per_million

    yield {"type": "batch_start", "ts": time.time(), "size": total}

    async def one(row: Dict[str, Any]) -> Dict[str, Any]:
        trace_uuid = (row or {}).get("trace_uuid") or ""
        path_labels = (row or {}).get("path_labels") or []
        trace_rationale = (row or {}).get("rationale") or ""
        frozen_at = (row or {}).get("frozen_at") or ""
        trace_seq = int((row or {}).get("trace_seq") or 0)

        bottom_uuid = _bottom_uuid_for_trace(G, trace_uuid)
        if not bottom_uuid:
            usage = _enrich_usage_with_costs({"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}, pricing_per_million)
            return {
                "trace_uuid": trace_uuid,
                "path_labels": path_labels,
                "items": [{
                    "need_id": _stable_need_id(trace_uuid, "missing bottom_uuid", 0),
                    "trace_uuid": trace_uuid,
                    "path_labels": path_labels,
                    "statement": "",
                    "rationale": "",
                    "headline": "",
                    "trace_rationale": trace_rationale,
                    "frozen_at": frozen_at,
                    "error": "missing bottom_uuid",
                    "relevance_rationale": "",
                    "intent_summary_trace": "",
                    "intent_summary_section": "",
                }],
                "usage": usage,
            }

        bundle = ops.build_records_for_bottom(bottom_uuid)
        tb = ops.format_trace_block(bundle["trace"], include_uuids=False, include_text=False)
        cb = ops.format_citations_block(bundle["trace"], bundle["cites"], include_uuids=False)
        ib = ops.format_intents_block(
            bundle["trace"], bundle["intents"],
            fields=["intent", "events", "summary"],
            include_uuids=False,
            include_levels=["trace"],
        )

        # section uuid from trace
        section_uuid = next(
            (n.get("uuid") for n in (bundle.get("trace") or []) if n.get("ntype") == "Section" and n.get("uuid")),
            None
        )

        # pick one “best” summary (usually trace summary is more specific)
        #TODO we must go back to the CS25 graph and rerun separate intent, summary, and events.
        # At the moment this is only done for sections not for traces

        trace_intent_summary = _intent_summary_for_node(bundle.get("intents"), bottom_uuid)
        section_intent_summary = _intent_summary_for_node(bundle.get("intents"), section_uuid)

        paragraph_name = ops.get_paragraph_id(bottom_uuid)

        #print(f" ******************** \nTEST \n paragraph_name: \n {paragraph_name} \n\n")
        #print(f" ******************** \nTEST \n ib: \n {ib} \n\n")
        #print(f" ******************** \nTEST \n tb: \n {tb} \n\n")
        #print(f" ******************** \nTEST \n cb: \n {cb} \n\n")
        #print(f" ******************** \nTEST \n trace_intent_summary: \n {trace_intent_summary} \n\n")
        #print(f" ******************** \nTEST \n section_intent_summary: \n {section_intent_summary} \n\n")

        payload = AgentInputs(trace_block=tb, cites_block=cb, intents_block=ib, paragraph_name=paragraph_name)
        res = await _call_with_retry(agent, query, payload)
        usage = _enrich_usage_with_costs(res.get("usage") or {}, pricing_per_million)

        resp = res.get("response") or {}
        needs = resp.get("needs") if isinstance(resp, dict) else None
        if not isinstance(needs, list):
            needs = []

        items: List[Dict[str, Any]] = []



        for i, n in enumerate(needs):
            st = (n or {}).get("statement", "") if isinstance(n, dict) else ""
            ra = (n or {}).get("rationale", "") if isinstance(n, dict) else ""
            obj = (n or {}).get("headline", "") if isinstance(n, dict) else ""

            if not st.strip():
                continue
            items.append({
                "need_id": _stable_need_id(trace_uuid, st, i),
                "need_code": f"N-{trace_seq:02d}-{i + 1:02d}",  # ✅ UX id
                "trace_uuid": trace_uuid,
                "path_labels": path_labels,
                "statement": st.strip(),
                "rationale": (ra or "").strip(),  # this is needs statement rationale
                "headline": (obj or "").strip(),  # shor summary of the need statement
                "frozen_at": frozen_at,
                "run_id": res.get("run_id"),
                # Optional: attach usage per item; UI can ignore
                "usage": usage,
                "relevance_rationale": (trace_rationale or "").strip(),  # this is your frozen selection rationale
                "intent_summary_trace": (trace_intent_summary or "").strip(),
                "intent_summary_section": (section_intent_summary or "").strip(),
                "paragraph_name": paragraph_name,  # ✅ bottom paragraph id/name
                "intents_block_trace": (ib or "").strip(),  # ✅ full trace intents block (intent+events+summary)
            })

        # If the agent returns zero needs, still emit a “no needs” item? (optional)
        # For now: emit nothing (items=[]). Caller can decide whether to stream empties.
        return {"trace_uuid": trace_uuid, "path_labels": path_labels, "items": items, "usage": usage}

    tasks = [asyncio.create_task(one(r)) for r in batch_rows]

    for fut in asyncio.as_completed(tasks):
        obj = await fut
        u = obj.get("usage") or {}
        batch_in_tokens  += int(u.get("input_tokens", 0) or 0)
        batch_out_tokens += int(u.get("output_tokens", 0) or 0)

        done += 1
        yield {
            "type": "items_done",
            "ts": time.time(),
            "done": done,
            "total": total,
            "trace_uuid": obj.get("trace_uuid"),
            "items": obj.get("items") or [],
            "usage": u,
        }

        yield {
            "type": "batch_progress",
            "ts": time.time(),
            "done": done,
            "total": total,
            "tokens_in": batch_in_tokens,
            "tokens_out": batch_out_tokens,
            "batch_cost": (batch_in_tokens / 1e6) * pin + (batch_out_tokens / 1e6) * pout,
            "elapsed_s": time.time() - t0,
        }

    elapsed = time.time() - t0
    yield {
        "type": "batch_end",
        "ts": time.time(),
        "elapsed_s": elapsed,
        "tokens_in": batch_in_tokens,
        "tokens_out": batch_out_tokens,
        "batch_cost": (batch_in_tokens / 1e6) * pin + (batch_out_tokens / 1e6) * pout,
        "size": total,
    }


def _chunked(items: List[Any], size: int) -> List[List[Any]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


# ------------------ Whole run stream ------------------

async def stream_needs_for_snapshot(
    *,
    snapshot_rows: List[Dict[str, Any]],
    G,
    ops: GraphOps,
    query: str,
    model: str,
    batch_size: int,
    pricing_per_million: Tuple[float, float],
) -> AsyncGenerator[Dict[str, Any], None]:

    rows = list(snapshot_rows or [])
    total_traces = len(rows)
    batches = _chunked(rows, batch_size)
    num_batches = len(batches)

    yield {
        "type": "run_start",
        "ts": time.time(),
        "model": model,
        "query": query,
        "total_traces": total_traces,
        "batch_size": batch_size,
        "num_batches": num_batches,
        "pricing_per_million": {"input_usd": pricing_per_million[0], "output_usd": pricing_per_million[1]},
    }

    agent = AsyncAgent(model=model, client=get_openai_client())
    total_in_tokens = 0
    total_out_tokens = 0
    pin, pout = pricing_per_million

    for i, batch in enumerate(batches, start=1):
        yield {"type": "batch_header", "ts": time.time(), "index": i, "of": num_batches, "size": len(batch)}

        async for evt in _stream_batch_parallel(
            batch,
            agent=agent,
            ops=ops,
            G=G,
            query=query,
            pricing_per_million=pricing_per_million,
        ):
            yield evt
            if evt["type"] == "items_done":
                u = evt.get("usage") or {}
                total_in_tokens  += int(u.get("input_tokens", 0) or 0)
                total_out_tokens += int(u.get("output_tokens", 0) or 0)

    grand_cost = (total_in_tokens / 1e6) * pin + (total_out_tokens / 1e6) * pout
    yield {
        "type": "run_end",
        "ts": time.time(),
        "summary": {
            "model": model,
            "query": query,
            "total_traces": total_traces,
            "batch_size_parallelism": batch_size,
            "num_batches": num_batches,
            "tokens_in": total_in_tokens,
            "tokens_out": total_out_tokens,
            "estimated_cost": grand_cost,
            "pricing_per_million": {"input_usd": pin, "output_usd": pout},
        },
    }


# ------------------ Event mapping to frontend types ------------------

def _wrap(evt: Dict[str, Any]) -> Dict[str, Any]:
    t = evt.get("type")
    mapping = {
        "run_start":      "needsTables.runStart",
        "batch_header":   "needsTables.batchHeader",     # optional; UI can ignore
        "batch_start":    "needsTables.batchStart",      # optional; UI can ignore
        "items_done":     "needsTables.itemsBatch",      # ✅ your UI supports this
        "batch_progress": "needsTables.progress",        # ✅ your UI supports progress
        "batch_end":      "needsTables.batchEnd",        # optional
        "run_end":        "needsTables.runEnd",
        "error":          "needsTables.error",
    }
    return {**evt, "type": mapping.get(t, f"needsTables.{t or 'event'}")}


# ------------------ Node ------------------

async def build_needs_table(state, store, **kwargs):
    tab_id = state.get("tab_id", "") or ""

    item = await store.aget(("cs25_context", tab_id), "latest")
    ctx = item.value if item and hasattr(item, "value") else {}

    frozen = bool(ctx.get("selections_frozen"))
    frozen_at = ctx.get("selections_frozen_at") or ""
    snapshot_rows = ctx.get("snapshotRows") or []

    async def emit(evt: Dict[str, Any]) -> None:
        evt.setdefault("ts", time.time())
        evt.setdefault("tabId", tab_id)  # your frontend checks metadata.tabId; bus layer may also set it
        evt.setdefault("sink", "needs")  # ✅ REQUIRED (frontend filters by sink)
        await bus_emit(tab_id, evt)

    # If not frozen, end cleanly
    if not frozen:
        await emit({"type": "needsTables.runEnd", "data": {"total": 0, "frozen_at": ""}})
        return {"messages": [AIMessage(content="Not frozen; skipping needs table build.")]}

    # Keep only relevant and dedupe by trace_uuid (your snapshot rows are already relevant-only,
    # but this is safe if the UI ever changes)
    seen = set()
    kept: List[Dict[str, Any]] = []
    for seq, r in enumerate(snapshot_rows, start=1):
        tid = (r or {}).get("trace_uuid")
        if not tid or tid in seen:
            continue
        rel = (r or {}).get("relevant")
        if rel not in (True, "true", "True", 1):
            continue
        seen.add(tid)
        kept.append({
            **(r or {}),
            "frozen_at": frozen_at,
            "trace_seq": seq,  # ✅ deterministic per freeze order
        })

    mg, ops = _get_runtime()

    # node start ping (optional)
    await emit({
        "type": "needsTables.nodeStart",
        "node": "build_needs_table",
        "ts": time.time(),
        "data": {"selectedCount": len(kept), "frozen_at": frozen_at},
    })

    all_items: List[Dict[str, Any]] = []

    last_progress_ts = 0.0

    try:
        async for evt in stream_needs_for_snapshot(
            snapshot_rows=kept,
            G=mg.G,
            ops=ops,
            query=state.get("topic", "") or "",
            model="gpt-5.2",
            batch_size=25,                 # <<< keep lower than 200; needs calls are heavier
            pricing_per_million=(0.05, 0.40),
        ):
            wrapped = _wrap(evt)

            # Your UI expects:
            # - needsTables.runStart payload.data.total
            # - needsTables.itemsBatch payload.items
            # - needsTables.progress done/total
            #
            # So we normalize those here.

            if wrapped["type"] == "needsTables.runStart":
                await emit({
                    "type": "needsTables.runStart",
                    "ts": wrapped.get("ts"),
                    "data": {
                        "total": int(wrapped.get("total_traces", 0) or 0),
                        "frozen_at": frozen_at,
                    },
                })
                continue

            if wrapped["type"] == "needsTables.itemsBatch":
                items = wrapped.get("items") or []
                # You can choose to skip empty batches to reduce chatter
                if items:
                    all_items.extend(items)  # ✅ collect for clustering later
                    await emit({"type": "needsTables.itemsBatch", "ts": wrapped.get("ts"), "items": items})
                # progress uses trace-done count (not needs count)
                await emit({
                    "type": "needsTables.progress",
                    "ts": wrapped.get("ts"),
                    "done": int(wrapped.get("done", 0) or 0),
                    "total": int(wrapped.get("total", 0) or 0),
                })
                continue

            if wrapped["type"] == "needsTables.progress":
                now = time.time()
                if now - last_progress_ts < 0.05:
                    continue
                last_progress_ts = now
                await emit({
                    "type": "needsTables.progress",
                    "ts": wrapped.get("ts"),
                    "done": int(wrapped.get("done", 0) or 0),
                    "total": int(wrapped.get("total", 0) or 0),
                })
                continue

            if wrapped["type"] == "needsTables.runEnd":
                # ✅ compute clusters once, at the end of the run
                try:
                    cluster_result = await cluster_needs_pipeline(
                        items=all_items,
                        openai_client=get_openai_client(),
                        k=None,  # this is optional, chose k integer if we want manually select a number of clusters
                    )

                    # ✅ DEBUG PRINT HERE (best spot)
                    print("\n================ NEED CLUSTERS ================\n")
                    print(f"k={cluster_result.get('k')}, needs={len(all_items)}")
                    for c in (cluster_result.get("clusters") or []):
                        print(f"- {c['cluster_id']} ({c['size']}): {c['label']}")
                    print("\n==============================================\n")

                    await emit({
                        "type": "needsTables.clusters",
                        "ts": time.time(),
                        "sink": "needs",
                        "data": cluster_result,
                    })
                except Exception as e:
                    await emit({
                        "type": "needsTables.error",
                        "node": "cluster_needs_pipeline",
                        "ts": time.time(),
                        "data": {"message": str(e)},
                    })

                # ✅ tag strands once needs are ready
                try:
                    strands_result = await tag_needs_with_strands(
                        items=all_items,
                        openai_client=get_openai_client(),
                        topic=state.get("topic", "") or "",  # ✅ pass topic here
                        model="gpt-5.2",
                        batch_size=25,
                    )

                    await emit({
                        "type": "needsTables.strands",
                        "ts": time.time(),
                        "sink": "needs",
                        "data": strands_result,
                    })
                except Exception as e:
                    await emit({
                        "type": "needsTables.error",
                        "node": "tag_needs_with_strands",
                        "ts": time.time(),
                        "data": {"message": str(e)},
                    })



                await emit({
                    "type": "needsTables.runEnd",
                    "ts": wrapped.get("ts"),
                    "data": {"frozen_at": frozen_at},
                })
                continue

            # optional extras (batch headers etc.)
            await emit(wrapped)

    except asyncio.CancelledError:
        await emit({"type": "needsTables.aborted", "node": "build_needs_table", "ts": time.time()})
        raise
    except Exception as e:
        await emit({"type": "needsTables.error", "node": "build_needs_table", "ts": time.time(), "data": {"message": str(e)}})
        return {"messages": [AIMessage(content=f"Needs table build failed: {e}")]}

    await emit({"type": "needsTables.nodeDone", "node": "build_needs_table", "ts": time.time()})
    return {"messages": [AIMessage(content=f"✅ Needs table streamed for {len(kept)} traces (frozen at {frozen_at}).")]}

# ----------------------------------------------------
# Embeddings + clustering + LLM labelling for Needs
# This is 'grouped' view
# 28 Dec 2025
# ----------------------------------------------------

import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize
from sklearn.metrics import silhouette_score, calinski_harabasz_score, davies_bouldin_score


def _need_cluster_text(it: Dict[str, Any]) -> str:
    return "\n".join([
        f"HEADLINE: {(it.get('headline') or '').strip()}",
        f"STATEMENT: {(it.get('statement') or '').strip()}",
        f"RATIONALE: {(it.get('rationale') or '').strip()}",
    ]).strip()


def _select_cluster_examples(
    usable: List[Dict[str, Any]],
    cluster_indices: List[int],
    limit: int = 12,
) -> str:
    bullets = []
    for j in cluster_indices[:limit]:
        obj = (usable[j].get("headline") or "").strip()
        st = (usable[j].get("statement") or "").strip()
        if obj:
            bullets.append(f"- {obj}")
        elif st:
            bullets.append(f"- {st[:140]}")
    return "\n".join(bullets)


async def embed_texts(
    *,
    texts: List[str],
    openai_client: AsyncOpenAI,
    embed_model: str = "text-embedding-3-small",
    batch_size: int = 128,
) -> np.ndarray:
    vecs: List[List[float]] = []
    for i in range(0, len(texts), batch_size):
        resp = await openai_client.embeddings.create(
            model=embed_model,
            input=texts[i:i + batch_size],
        )
        vecs.extend([d.embedding for d in resp.data])

    X = np.array(vecs, dtype=np.float32)
    return normalize(X)  # important for cosine-ish behaviour


def kmeans_cluster(
    *,
    X: np.ndarray,
    k: int,
    seed: int = 42,
) -> np.ndarray:
    k_eff = max(1, min(int(k), X.shape[0]))
    if k_eff == 1:
        return np.zeros(X.shape[0], dtype=int)

    km = KMeans(n_clusters=k_eff, random_state=seed, n_init=10)
    return km.fit_predict(X)


async def label_cluster_with_llm(
    *,
    usable: List[Dict[str, Any]],
    cluster_indices: List[int],
    openai_client: AsyncOpenAI,
    label_model: str = "gpt-5.2",
) -> str:
    examples = _select_cluster_examples(usable, cluster_indices, limit=12)

    #TODO 29 Dec '25. Investigate this prompt, check whats exactly is passed into it
    # also for better grouping we may need to pass into it the 'intent' block so AI understands not only the need but also the intent behind it
    # we may need to pre-process these inputs into a format that can be organised e.g. clause, intent, broken into needs.

    prompt = f"""
You are grouping engineering needs into human-readable themes.

Write ONE plain-English cluster title describing what these needs are about.

Rules:
- 3–7 words.
- BLUF style.
- Noun phrase (no “Demonstrate/Ensure/Verify”).
- Use concrete aerospace nouns (e.g., oil cooler fire, EWIS wiring, latent failures, maintenance limitations).
- Avoid vague words alone (“safety”, “compliance”, “risk”) unless paired with a concrete subject.
- Output ONLY the title.

Needs (examples):
{examples}
""".strip()

    r = await openai_client.responses.create(
        model=label_model,
        input=[{"role": "user", "content": prompt}],
    )
    return (r.output_text or "").strip() or "Unlabelled cluster"


async def cluster_needs_pipeline(
    *,
    items: List[Dict[str, Any]],
    openai_client: AsyncOpenAI,
    k: Optional[int] = None,   # ✅ allow None = auto
    embed_model: str = "text-embedding-3-small",
    label_model: str = "gpt-5.2",
) -> Dict[str, Any]:
    usable = [it for it in items if (it.get("statement") or "").strip()]

    if not usable:
        return {"k": 0, "map": {}, "clusters": []}

    if len(usable) < 3:
        return {"k": 0, "map": {}, "clusters": []}

    need_ids = [it["need_id"] for it in usable]
    texts = [_need_cluster_text(it) for it in usable]

    X = await embed_texts(texts=texts, openai_client=openai_client, embed_model=embed_model)

    # Auto-pick k (cap k_max so it doesn't go crazy)
    k_auto, k_debug = choose_best_k(
        X=X,
        k_min=2,
        k_max=min(20, max(2, int(np.sqrt(len(texts)) * 2))),
    )

    # Optional: keep your manual k mode
    # if we pass k=None --> k_auto, otherwise select the manual k
    k_used = int(k) if (k is not None) else int(k_auto)

    print("[needs clustering] k_auto:", k_auto, "k_used:", k_used)
    print("[needs clustering] top candidates:", sorted(k_debug["grid"], key=lambda r: -r["silhouette_cosine"])[:5])

    labels = kmeans_cluster(X=X, k=k_used)



    from collections import Counter
    print("[needs clustering] k_used:", k_used, "unique_labels:", len(set(labels)))
    print("[needs clustering] label counts:", dict(Counter(labels.tolist())))

    grouped: Dict[int, List[int]] = {}
    for idx, lab in enumerate(labels):
        grouped.setdefault(int(lab), []).append(idx)

    ordered = sorted(grouped.items(), key=lambda kv: (-len(kv[1]), kv[0]))

    for lab, idxs in ordered:
        print("cluster", lab, "size", len(idxs))
        for j in idxs[:3]:
            print(" -", usable[j].get("headline") or usable[j].get("statement", "")[:120])

    clusters_out = []
    map_out: Dict[str, str] = {}

    for i, (_lab, idxs) in enumerate(ordered, start=1):
        cid = f"C-{i:02d}"
        for j in idxs:
            map_out[need_ids[j]] = cid

        label = await label_cluster_with_llm(
            usable=usable,
            cluster_indices=idxs,
            openai_client=openai_client,
            label_model=label_model,
        )

        clusters_out.append({
            "cluster_id": cid,
            "size": len(idxs),
            "label": label,
            "need_ids": [need_ids[j] for j in idxs],
        })

    return {"k": len(clusters_out), "map": map_out, "clusters": clusters_out}

def choose_best_k(
    *,
    X: np.ndarray,
    k_min: int = 2,
    k_max: int = 20,
    seed: int = 42,
) -> Tuple[int, Dict[str, Any]]:
    """
    Pick k by maximizing silhouette (cosine). Also records CH + DB for debugging.
    X should already be normalized (you already do normalize()).
    """
    n = int(X.shape[0])
    if n < 3:
        return 1, {"reason": "too_few_items", "n": n}

    k_max_eff = min(int(k_max), n - 1)
    k_min_eff = min(int(k_min), k_max_eff)
    if k_max_eff < 2:
        return 1, {"reason": "too_few_items_for_k2", "n": n}

    best_k = 2
    best_sil = -1.0
    rows = []

    for k in range(k_min_eff, k_max_eff + 1):
        km = KMeans(n_clusters=k, random_state=seed, n_init=10)
        labels = km.fit_predict(X)

        # silhouette requires at least 2 labels
        sil = silhouette_score(X, labels, metric="cosine")
        ch = calinski_harabasz_score(X, labels)
        db = davies_bouldin_score(X, labels)

        rows.append({"k": k, "silhouette_cosine": sil, "calinski_harabasz": ch, "davies_bouldin": db})
        if sil > best_sil:
            best_sil = sil
            best_k = k

    return best_k, {"picked_by": "silhouette_cosine", "best_silhouette": best_sil, "grid": rows}


# ------------------ Strand tagging (Drivers view) ------------------

from enum import Enum
from pydantic import BaseModel, Field

class Strand(str, Enum):
    FUNCTIONAL_DESIGN_PERFORMANCE = "FUNCTIONAL_DESIGN_PERFORMANCE"
    MATERIALS = "MATERIALS"
    MANUFACTURING_METHOD = "MANUFACTURING_METHOD"
    INTEGRATION_ENVIRONMENT = "INTEGRATION_ENVIRONMENT"
    OTHER = "OTHER"

class SingleStrandOutput(BaseModel):
    strand: Strand
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(description="<= 12 words. Concrete, no fluff.")

def _need_core_block(it: Dict[str, Any]) -> str:
    return "\n".join([
        f"NEED_HEADLINE: {(it.get('headline') or '').strip()}",
        f"NEED_STATEMENT: {(it.get('statement') or '').strip()}",
        f"NEED_RATIONALE: {(it.get('rationale') or '').strip()}",
    ]).strip()

async def tag_needs_with_strands(
    *,
    items: List[Dict[str, Any]],
    openai_client: AsyncOpenAI,
    topic: str,
    model: str = "gpt-5.2",
    batch_size: int = 25,
    concurrency: int = 8,
    pricing_per_million: Tuple[float, float] = (0.05, 0.40),  # ✅ add pricing like needs
    debug: bool = True,
) -> Dict[str, Any]:
    usable = [it for it in items if (it.get("statement") or "").strip()]
    if not usable:
        return {
            "map": {},
            "tags": [],
            "summary": {
                "model": model,
                "total_needs": 0,
                "success": 0,
                "failed": 0,
                "tokens_in": 0,
                "tokens_out": 0,
                "estimated_cost": 0.0,
                "pricing_per_million": {"input_usd": pricing_per_million[0], "output_usd": pricing_per_million[1]},
            },
        }

    topic = (topic or "").strip()
    sem = asyncio.Semaphore(max(1, int(concurrency)))
    pin, pout = pricing_per_million

    system = """
You are an expert aerospace certification & technology maturation engineer.

Goal:
Classify the NEED into ONE "technology strand" (maturity dimension).
This is not a verification method and not a requirement rewrite.

Technology strands (choose ONE):

1) FUNCTIONAL_PERFORMANCE
   - The key uncertainty is whether the item performs its intended function
     to required levels across operating conditions (capacity, thermal limits,
     control behaviour, envelope performance, efficiency, stability).

2) MATERIALS_INTEGRITY
   - The key uncertainty is material behaviour or structural/physical integrity:
     strength/allowables, durability, fatigue/fracture/crack growth,
     corrosion/erosion/creep, damage tolerance, containment,
     leak/rupture prevention, fire resistance.
   - If "vibration" is mentioned:
       * structural integrity / fatigue under vibration loads -> MATERIALS_INTEGRITY
       * installation vib environment / isolation / interface effects -> INTEGRATION_ENVIRONMENT

3) MANUFACTURING_MAINTAINABILITY
   - The key uncertainty is build/assembly/process maturity or maintainability:
     manufacturing method maturity, process capability & repeatability,
     joining/winding/impregnation/fabrication steps, inspection/QA,
     tolerances, repairability, service access, draining, inspection intervals,
     maintenance error prevention.

4) INTEGRATION_ENVIRONMENT
   - The key uncertainty is behaviour when installed and interacting with the
     system + operational environment:
     interfaces, routing/ducting, packaging, fire zones, icing/freezing,
     EMI/EMC, thermal interactions, dependencies, integration complexity,
     environmental compatibility in the relevant environment.

5) OTHER
   - Use only if it does not fit the four strands (e.g., purely administrative,
     documentation-only, generic programme assurance statements without a
     technical maturity dimension).

Rules:
- Use the full INTENTS block as primary context.
- Use the NEED statement/objective as the item being classified.
- Do not invent design details.
- Output must match the schema exactly.
""".strip()

    # Totals across whole run
    total_in_tokens = 0
    total_out_tokens = 0
    total_cost = 0.0
    success = 0
    failed = 0

    async def tag_one(it: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        need_id = it.get("need_id", "")
        need_code = it.get("need_code", "")
        paragraph_name = (it.get("paragraph_name") or "").strip()
        intents_block = (it.get("intents_block_trace") or "").strip()
        need_block = _need_core_block(it)

        user = f"""
<TOPIC>
{topic}
</TOPIC>

<NEED>
{need_block}
</NEED>

<BOTTOM_PARAGRAPH - this is the regulatory clause of focus>
{paragraph_name}
</BOTTOM_PARAGRAPH>

<TRACE_INTENTS - this is a {paragraph_name} regulatory clause from which the engineering need was derived>
{intents_block}
</TRACE_INTENTS>
""".strip()

        delay = 0.6
        for attempt in range(5):
            try:
                if debug:
                    print("\n" + "=" * 120)
                    print(f"[E42][STRANDS][REQ] need_id={need_id} need_code={need_code} attempt={attempt+1}/5 model={model}")
                    print("-" * 120)
                    print("[SYSTEM]\n" + system)
                    print("-" * 120)
                    print("[USER]\n" + user)
                    print("=" * 120 + "\n")

                async with sem:
                    resp = await openai_client.responses.parse(
                        model=model,
                        input=[
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        text_format=SingleStrandOutput,
                    )

                parsed_obj = resp.output_parsed
                parsed = parsed_obj.model_dump(mode="json") if hasattr(parsed_obj, "model_dump") else parsed_obj.dict()

                # ✅ usage -> cost (same helper you already have)
                usage = {
                    "input_tokens": getattr(resp.usage, "input_tokens", 0) if getattr(resp, "usage", None) else 0,
                    "output_tokens": getattr(resp.usage, "output_tokens", 0) if getattr(resp, "usage", None) else 0,
                    "total_tokens": getattr(resp.usage, "total_tokens", 0) if getattr(resp, "usage", None) else 0,
                }
                usage = _enrich_usage_with_costs(usage, pricing_per_million)

                if debug:
                    print("\n" + "-" * 120)
                    print(f"[E42][STRANDS][RESP] need_id={need_id} need_code={need_code}")
                    print("[PARSED OUTPUT]")
                    try:
                        print(json.dumps(parsed, indent=2, ensure_ascii=False))
                    except Exception:
                        print(parsed)
                    print("[USAGE]")
                    print(json.dumps(usage, indent=2))
                    print("-" * 120 + "\n")

                return {
                    "need_id": need_id,                 # local mapping key (LLM never saw it)
                    "strand": parsed.get("strand"),
                    "confidence": float(parsed.get("confidence", 0.0) or 0.0),
                    "reason": (parsed.get("reason") or "").strip(),
                    "usage": usage,                     # ✅ attach per-need usage (optional)
                }

            except APIStatusError as e:
                code = getattr(e, "status_code", 0)
                retryable = code in (429, 500, 502, 503, 504)
                if debug:
                    print(f"[E42][STRANDS][APIStatusError] need_id={need_id} code={code} retryable={retryable} err={e}")
                if retryable and attempt < 4:
                    await asyncio.sleep(delay + random.uniform(0, 0.4))
                    delay = min(delay * 2, 6)
                    continue
                return None
            except Exception as e:
                if debug:
                    print(f"[E42][STRANDS][Exception] need_id={need_id} attempt={attempt+1}/5 err={type(e).__name__}: {e}")
                if attempt < 4:
                    await asyncio.sleep(delay + random.uniform(0, 0.4))
                    delay = min(delay * 2, 6)
                    continue
                return None

        return None

    out_tags: List[Dict[str, Any]] = []

    for i in range(0, len(usable), batch_size):
        chunk = usable[i : i + batch_size]

        if debug:
            print("\n" + "#" * 120)
            print(f"[E42][STRANDS][BATCH] {i//batch_size + 1} | items {i}..{i + len(chunk) - 1} | "
                  f"batch_size={batch_size} concurrency={concurrency} pricing_in={pin} pricing_out={pout}")
            print("#" * 120 + "\n")

        results = await asyncio.gather(*[asyncio.create_task(tag_one(it)) for it in chunk])

        for r in results:
            if isinstance(r, dict) and r.get("need_id"):
                out_tags.append(r)
                u = r.get("usage") or {}
                total_in_tokens += int(u.get("input_tokens", 0) or 0)
                total_out_tokens += int(u.get("output_tokens", 0) or 0)
                total_cost += float(u.get("total_cost", 0.0) or 0.0)
                success += 1
            else:
                failed += 1

        if debug:
            batch_cost = (total_in_tokens / 1e6) * pin + (total_out_tokens / 1e6) * pout
            print(f"[E42][STRANDS][PROGRESS] success={success} failed={failed} "
                  f"tokens_in={total_in_tokens} tokens_out={total_out_tokens} est_cost={batch_cost:.6f}")

    # map need_id -> {strand, confidence, reason}
    m: Dict[str, Any] = {}
    for t in out_tags:
        nid = t.get("need_id")
        if not nid:
            continue
        m[nid] = {
            "strand": t.get("strand"),
            "confidence": float(t.get("confidence", 0.0) or 0.0),
            "reason": (t.get("reason") or "").strip(),
        }

    summary = {
        "model": model,
        "total_needs": len(usable),
        "success": success,
        "failed": failed,
        "tokens_in": total_in_tokens,
        "tokens_out": total_out_tokens,
        "estimated_cost": (total_in_tokens / 1e6) * pin + (total_out_tokens / 1e6) * pout,
        "pricing_per_million": {"input_usd": pin, "output_usd": pout},
    }

    if debug:
        print("\n" + "=" * 90)
        print("[E42][STRANDS][SUMMARY]")
        print(json.dumps(summary, indent=2))
        print("=" * 90 + "\n")

    return {"map": m, "tags": out_tags, "summary": summary}

