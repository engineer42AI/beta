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


class Need(BaseModel):
    statement: str = Field(description="Engineering need statement (solution-agnostic, verifiable later).")
    rationale: str = Field(description="BLUF rationale (<20 words). Start with 'Needed because ...'.")
    need_objective: str = Field(description="A short (<10 words), declarative objective of what the need statement requires to be true.")


class NeedsOutput(BaseModel):
    needs: List[Need] = Field(description="Zero, one, or multiple needs derived from intent.")


class AsyncAgent:
    def __init__(self, model: str, api_key: Optional[str] = None):
        self.model = model
        self.client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))

    async def run(self, query: str, inputs: AgentInputs) -> Dict[str, Any]:
        system = """
You are an expert aircraft certification engineer specialising in CS-25 and translating regulatory intent into engineering needs.

Task:
Extract ENGINEERING NEED STATEMENTS from the provided regulatory intent and trace structure.

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

Output:
Return JSON matching the schema exactly.
"""

        user_content = f"""
<USER_QUERY>
{query}
</USER_QUERY>

<TRACE>
{inputs.trace_block or ""}
</TRACE>

<INTENTS>
{inputs.intents_block or ""}
</INTENTS>
"""

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
                    "need_objective": "",
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
            include_levels=["section", "trace"],
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

        payload = AgentInputs(trace_block=tb, cites_block=cb, intents_block=ib)
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
            obj = (n or {}).get("need_objective", "") if isinstance(n, dict) else ""

            if not st.strip():
                continue
            items.append({
                "need_id": _stable_need_id(trace_uuid, st, i),
                "need_code": f"N-{trace_seq:02d}-{i + 1:02d}",  # ✅ UX id
                "trace_uuid": trace_uuid,
                "path_labels": path_labels,
                "statement": st.strip(),
                "rationale": (ra or "").strip(),  # this is needs statement rationale
                "need_objective": (obj or "").strip(),  # shor summary of the need statement
                "frozen_at": frozen_at,
                "run_id": res.get("run_id"),
                # Optional: attach usage per item; UI can ignore
                "usage": usage,
                "relevance_rationale": (trace_rationale or "").strip(),  # this is your frozen selection rationale
                "intent_summary_trace": (trace_intent_summary or "").strip(),
                "intent_summary_section": (section_intent_summary or "").strip(),
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

    agent = AsyncAgent(model=model)
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
        if (r or {}).get("relevant") is not True:
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