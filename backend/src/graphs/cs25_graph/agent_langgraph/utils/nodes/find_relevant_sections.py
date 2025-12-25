# backend/src/graphs/cs25_graph/agent_langgraph/utils/nodes/find_relevant_sections.py

from typing import Annotated, Optional, Any
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool, InjectedToolCallId
from langgraph.types import Command
from langgraph.prebuilt import InjectedState, InjectedStore
from langgraph.store.base import BaseStore
from src.graphs.cs25_graph.agent_langgraph.utils.state import AgentState

from src.graphs.cs25_graph.utils import ManifestGraph, GraphOps

import os, uuid, asyncio, time, random, json
from typing import Dict, Any, List, Optional, Tuple, Callable, AsyncGenerator
from pydantic import BaseModel, Field
from openai import AsyncOpenAI, APIStatusError
from langchain_openai import ChatOpenAI

from src.graphs.cs25_graph.agent_langgraph.utils.progress_bus import emit as bus_emit


from langchain_core.messages import AIMessage
from typing import Callable, Awaitable
ProgressEmitter = Callable[[Dict[str, Any]], Awaitable[None]]

# ------------------ Agent (async, structured output) ------------------
class AgentInputs(BaseModel):
    trace_block: str
    cites_block: str
    intents_block: str

class RelevanceResult(BaseModel):
    # You can change these fields any time. We won't hard-code them elsewhere.
    relevant: bool
    rationale: Optional[str] = Field(description="Rationale in one plain-English sentence, BLUF style <20 words. Start with 'Included because' or 'Excluded because'.")

class AsyncAgent:
    def __init__(self, model, api_key: Optional[str] = None):
        self.model = model
        self.client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))

    async def run(self, query: str, inputs: AgentInputs) -> Dict[str, Any]:
        """
        Returns a stable envelope:
          { run_id: str, response: <dict>, usage: {input_tokens, output_tokens, total_tokens} }
        'response' mirrors your Pydantic schema (no hard-coded keys).
        """
        system = ("""
You are the world’s best CS-25 aircraft certification and systems engineer.

Task:
Decide if the provided CS-25 regulatory content is relevant to the USER QUERY.  
Ask yourself: Would a certifying engineer reasonably cite or apply this regulation when analyzing that USER QUERY scenario?  

Inputs:
1. USER QUERY
2. TRACE: structure of the regulation from bottom paragraph up, with classifications showing each paragraph’s function.
3. INTENT: focused explanation of the specific intent of this trace.

Guidance:
- TRACE shows structure and roles, not raw text.
- Trace Intent is your main guide for this decision.
- Classifications tell you the function:
  • normative_requirement = binding rule  
  • condition_clause = dependent on parent normative  
  • exception_clause = carve-out or limiter  
  • scope_setter = applicability boundaries  
  • guidance = advisory or explanatory  
  • definition = term meaning  
  • reference_only = pointer only  
  • reserved = no content

Important:
- NEVER mention or expose the internal classification labels (e.g., normative_requirement, scope_setter, condition_clause, etc.) in your output.
- Use them only to guide your reasoning about relevance.
""")
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
        #<CITATIONS>
        #{inputs.cites_block or ""}
        #</CITATIONS>
        # print(user_content)
        resp = await self.client.responses.parse(
            model=self.model,
            input=[{"role": "system", "content": system},
                   {"role": "user", "content": user_content}],
            text_format=RelevanceResult,  # enforce schema
        )
        # Convert parsed pydantic obj to plain dict (works v1/v2)
        parsed = resp.output_parsed.model_dump() if hasattr(resp.output_parsed, "model_dump") else resp.output_parsed.dict()
        usage = {
            "input_tokens":  resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
            "total_tokens":  resp.usage.total_tokens,
        }
        return {
            "run_id": f"filter-{uuid.uuid4().hex[:8]}",
            "response": parsed,   # <- no schema keys hard-coded
            "usage": usage,       # <- raw token counts only
        }

# ------------------ Graph helpers ------------------
def iter_trace_nodes(G) -> List[Dict[str, Any]]:
    out = []
    for nid, data in G.nodes(data=True):
        if data.get("ntype") == "Trace":
            out.append({
                "trace_uuid": nid,
                "bottom_uuid": data.get("bottom_uuid"),
                "bottom_clause": data.get("bottom"),
            })
    return out

def chunked(items: List[Any], size: int) -> List[List[Any]]:
    return [items[i:i+size] for i in range(0, len(items), size)]

# ------------------ Cost helper (no schema dependence) ------------------
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

# ------------------ Retry wrapper (always returns the SAME envelope) ----------
async def _call_with_retry(agent: AsyncAgent, query: str, payload: AgentInputs, *, max_retries=5) -> Dict[str, Any]:
    """
    Always returns:
      { run_id, response: <dict>, usage: {input_tokens, output_tokens, total_tokens} }
    On error, response={'error': '...'}, usage=0s — no schema keys are referenced.
    """
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
    # unified error envelope:
    return {
        "run_id": f"filter-{uuid.uuid4().hex[:8]}",
        "response": {"error": "agent_call_failed"},
        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
    }

# ------------------ ONE batch, fully parallel, as an event stream -----------
async def _stream_batch_parallel(
    batch_items: List[Dict[str, Any]],
    *,
    agent: AsyncAgent,
    ops,
    query: str,
    pricing_per_million: Tuple[float, float],
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Yields events: batch_start, item_done, batch_progress, batch_end.
    Each 'item_done' contains an 'item' object with:
      {
        run_id, trace_uuid, bottom_uuid, bottom_clause,
        response: <dict>,             # from your Pydantic schema (no hard-coding)
        usage: {tokens..., costs...}  # costs added here
      }
    """
    t0 = time.time()
    total = len(batch_items)
    done = 0
    batch_in_tokens = 0
    batch_out_tokens = 0
    pin, pout = pricing_per_million

    yield {"type": "batch_start", "ts": time.time(), "size": total}

    async def one(item: Dict[str, Any]) -> Dict[str, Any]:
        if not item.get("bottom_uuid"):
            # fabricate a minimal item using the same envelope shapes
            usage = _enrich_usage_with_costs({"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}, pricing_per_million)
            return {
                "run_id": f"filter-{uuid.uuid4().hex[:8]}",
                "trace_uuid": item.get("trace_uuid"),
                "bottom_uuid": item.get("bottom_uuid"),
                "bottom_clause": item.get("bottom_clause"),
                "response": {"error": "missing bottom_uuid"},
                "usage": usage,
            }

        # Build blocks
        bundle = ops.build_records_for_bottom(item["bottom_uuid"])
        tb = ops.format_trace_block(bundle["trace"], include_uuids=False, include_text=False)
        cb = ops.format_citations_block(bundle["trace"], bundle["cites"], include_uuids=False)
        ib = ops.format_intents_block(
            bundle["trace"], bundle["intents"],
            fields=["intent", "events", "summary"],  # what keys to include in the response?
            include_uuids=False,
            include_levels=["section", "trace"] # what intents to return - only for trace, or trace and section, or only for section?
        )
        payload = AgentInputs(trace_block=tb, cites_block=cb, intents_block=ib)

        # Agent call (stable envelope)
        res = await _call_with_retry(agent, query, payload)
        # enrich usage with costs (no schema knowledge)
        enriched_usage = _enrich_usage_with_costs(res.get("usage") or {}, pricing_per_million)
        # assemble item (no schema knowledge)
        return {
            "run_id": res.get("run_id"),
            "trace_uuid": item.get("trace_uuid"),
            "bottom_uuid": item.get("bottom_uuid"),
            "bottom_clause": item.get("bottom_clause"),
            "response": res.get("response") or {},
            "usage": enriched_usage,
        }

    tasks = [asyncio.create_task(one(it)) for it in batch_items]

    for fut in asyncio.as_completed(tasks):
        item_obj = await fut
        u = item_obj.get("usage") or {}
        batch_in_tokens  += int(u.get("input_tokens", 0) or 0)
        batch_out_tokens += int(u.get("output_tokens", 0) or 0)
        done += 1

        # emit the actual result right away
        yield {
            "type": "item_done",
            "ts": time.time(),
            "done": done,
            "total": total,
            "item": item_obj,  # <-- your UI consumes this; it already has all fields
        }

        # also a lightweight progress tick
        yield {
            "type": "batch_progress",
            "ts": time.time(),
            "done": done,
            "total": total,
            "tokens_in": batch_in_tokens,
            "tokens_out": batch_out_tokens,
            "batch_cost": (batch_in_tokens/1e6)*pin + (batch_out_tokens/1e6)*pout,
            "elapsed_s": time.time() - t0,
        }

    elapsed = time.time() - t0
    yield {
        "type": "batch_end",
        "ts": time.time(),
        "elapsed_s": elapsed,
        "tokens_in": batch_in_tokens,
        "tokens_out": batch_out_tokens,
        "batch_cost": (batch_in_tokens/1e6)*pin + (batch_out_tokens/1e6)*pout,
        "size": total,
    }

# ------------------ Whole run as an async **event stream** -------------------
async def stream_all_traces(
    G,
    ops,
    *,
    query: str,
    model: str = "gpt-4o-mini",
    batch_size: int = 200,
    limit: Optional[int] = None,
    pricing_per_million: Tuple[float, float] = (0.15, 0.60),
    selected_trace_ids: Optional[List[str]] = None,   # <-- NEW
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Yields events for the entire run:
      run_start, batch_header, (batch_*...), run_end
    """
    # original list in graph order
    all_traces = iter_trace_nodes(G)

    # NEW: filter if a selection is provided (preserve original order)
    if selected_trace_ids:
        sel = set(selected_trace_ids)
        all_traces = [t for t in all_traces if t.get("trace_uuid") in sel]

    if limit:
        all_traces = all_traces[:limit]

    total_traces = len(all_traces)
    batches = chunked(all_traces, batch_size)
    num_batches = len(batches)

    yield {
        "type": "run_start",
        "ts": time.time(),
        "model": model,
        "query": query,
        "total_traces": total_traces,   # <-- now reflects selection
        "batch_size": batch_size,
        "num_batches": num_batches,
        "pricing_per_million": {"input_usd": pricing_per_million[0], "output_usd": pricing_per_million[1]},
    }

    agent = AsyncAgent(model=model)
    total_in_tokens = 0
    total_out_tokens = 0

    for i, batch in enumerate(batches, start=1):
        yield {"type": "batch_header", "index": i, "of": num_batches, "size": len(batch), "ts": time.time()}

        async for evt in _stream_batch_parallel(
            batch,
            agent=agent,
            ops=ops,
            query=query,
            pricing_per_million=pricing_per_million,
        ):
            yield evt
            if evt["type"] == "item_done":
                u = (evt.get("item") or {}).get("usage") or {}
                total_in_tokens  += int(u.get("input_tokens", 0) or 0)
                total_out_tokens += int(u.get("output_tokens", 0) or 0)

    grand_cost = (total_in_tokens/1e6)*pricing_per_million[0] + (total_out_tokens/1e6)*pricing_per_million[1]
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
            "pricing_per_million": {"input_usd": pricing_per_million[0], "output_usd": pricing_per_million[1]},
        },
    }

# Cache the loaded graph so we don't rebuild on every request
_RUNTIME_CACHE = None

def _get_runtime():
    global _RUNTIME_CACHE
    if _RUNTIME_CACHE is None:
        mg = ManifestGraph()   # defaults to folder of utils.py
        mg.load()              # loads manifest + nodes/edges and builds mg.G
        ops = GraphOps(mg.G)
        _RUNTIME_CACHE = (mg, ops)
    return _RUNTIME_CACHE


# --- add this small mapper helper above `find_relevant_sections_llm` ---
# Map stream_all_traces events → namespaced UI types
# ---- event type mapping (unchanged, but kept explicit) -----------------
def _frs_wrap(evt: Dict[str, Any]) -> Dict[str, Any]:
    t = evt.get("type")
    mapping = {
        "run_start":      "findRelevantSections.runStart",
        "batch_header":   "findRelevantSections.batchHeader",
        "batch_start":    "findRelevantSections.batchStart",
        "item_done":      "findRelevantSections.itemDone",
        "batch_progress": "findRelevantSections.batchProgress",
        "batch_end":      "findRelevantSections.batchEnd",
        "run_end":        "findRelevantSections.runEnd",
        "error":          "findRelevantSections.error",
    }
    return {**evt, "type": mapping.get(t, f"findRelevantSections.{t or 'event'}")}

# ---- node --------------------------------------------------------------
async def find_relevant_sections_llm(
    state,              # AgentState (no forward-ref needed)
    store,              # BaseStore
    **kwargs            # accept extra kwargs from LangGraph safely
):
    tab_id = state.get("tab_id", "") or ""

    # fetch latest tab-scoped context (your selection ids)
    item = await store.aget(("cs25_context", tab_id), "latest")
    ctx = item.value if item and hasattr(item, "value") else {}
    selected_ids: List[str] = ctx.get("selected_ids", []) or []
    selected_count = len(selected_ids)

    mg, ops = _get_runtime()

    # helper: emit via bus; stream layer will add tab_id if missing
    async def emit(evt: Dict[str, Any]) -> None:
        await bus_emit(tab_id, evt)

    # announce node start
    await emit({
        "type": "findRelevantSections.nodeStart",
        "node": "find_relevant_sections_llm",
        "ts": time.time(),
        "data": {"selectedCount": selected_count},
    })

    # optional throttling for chatty progress
    last_progress_ts = 0.0

    try:
        async for evt in stream_all_traces(
            mg.G,
            ops,
            query=state.get("topic", "") or "",
            model="gpt-5-nano",
            batch_size=200,
            limit=None,
            pricing_per_million=(0.05, 0.40),
            selected_trace_ids=selected_ids,
        ):
            wrapped = _frs_wrap(evt)

            # throttle only the progress ticks if needed
            if wrapped["type"] == "findRelevantSections.batchProgress":
                now = time.time()
                if now - last_progress_ts < 0.05:  # ~20/s max
                    continue
                last_progress_ts = now

            await emit(wrapped)

    except asyncio.CancelledError:
        await emit({
            "type": "findRelevantSections.aborted",
            "node": "find_relevant_sections_llm",
            "ts": time.time(),
        })
        raise
    except Exception as e:
        await emit({
            "type": "findRelevantSections.error",
            "node": "find_relevant_sections_llm",
            "ts": time.time(),
            "data": {"message": str(e)},
        })
        summary = f"FindRelevantSections failed for {selected_count} traces: {e}"
        return {"messages": [AIMessage(content=summary)]}

    # node done ping
    await emit({
        "type": "findRelevantSections.nodeDone",
        "node": "find_relevant_sections_llm",
        "ts": time.time(),
    })



    summary = f"Finished running the job for {selected_count} traces"


    return {"messages": [AIMessage(content=summary)]}

