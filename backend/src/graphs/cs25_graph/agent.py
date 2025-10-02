# agent.py
import os, uuid, asyncio, time, random, json
from typing import Dict, Any, List, Optional, Tuple, Callable, AsyncGenerator
from pydantic import BaseModel, Field
from openai import AsyncOpenAI, APIStatusError

# ------------------ Agent (async, structured output) ------------------
class AgentInputs(BaseModel):
    trace_block: str
    cites_block: str
    intents_block: str

class RelevanceResult(BaseModel):
    # You can change these fields any time. We won't hard-code them elsewhere.
    relevant: bool
    rationale: Optional[str] = Field(description="BLUF style rationale in one sentence.")

class AsyncAgent:
    def __init__(self, model: str = "gpt-4o-mini", api_key: Optional[str] = None):
        self.model = model
        self.client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))

    async def run(self, query: str, inputs: AgentInputs) -> Dict[str, Any]:
        """
        Returns a stable envelope:
          { run_id: str, response: <dict>, usage: {input_tokens, output_tokens, total_tokens} }
        'response' mirrors your Pydantic schema (no hard-coded keys).
        """
        system = (
            "You are an aerospace CS-25 expert and systems engineer. "
            "Decide if the provided CS-25 regulatory trace contains any useful information "
            "to address the user query. Reply ONLY via the JSON schema."
        )
        user_content = f"""# User Query
{query}

# Trace
{inputs.trace_block or ""}

# Intents
{inputs.intents_block or ""}

# Citations
{inputs.cites_block or ""}
"""
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
            fields=["intent", "section_intent"],  # customize; we don't inspect these later
            include_uuids=False
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
    batch_size: int = 200,   # also the parallelism
    limit: Optional[int] = None,
    pricing_per_million: Tuple[float, float] = (0.15, 0.60),
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Yields events for the entire run:
      run_start, batch_header, (batch_*...), run_end
    """
    all_traces = iter_trace_nodes(G)
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
        "total_traces": total_traces,
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

# ------------------ (Optional) Collector for tests/CLI -----------------------
async def collect_report_from_stream(stream: AsyncGenerator[Dict[str, Any], None]) -> Dict[str, Any]:
    """Consume the stream and build a final report object; useful in tests."""
    results: List[Dict[str, Any]] = []
    summary: Dict[str, Any] = {}
    async for evt in stream:
        if evt.get("type") == "item_done":
            results.append(evt["item"])
        elif evt.get("type") == "run_end":
            summary = evt.get("summary", {})
    return {"summary": summary, "results": results}
