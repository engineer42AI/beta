# sandbox_runner.py
import os, uuid, asyncio

from pydantic import BaseModel
from typing import Optional


# ---- agent_langgraph types ------------------------------------------------------------
class AgentInputs(BaseModel):
    trace_block: str
    cites_block: str
    intents_block: str

class Agent:
    def __init__(self, model: str = "gpt-5-mini"):
        self.model = model

    async def run(self, query: str, inputs: AgentInputs) -> dict:
        run_id = f"inl-{uuid.uuid4().hex[:8]}"

        system_prompt = (
            "You are an aerospace CS-25 expert and a systems engineer. "
            "Decide if the provided CS-25 regulatory trace is relevant to the user query, "
            "explain why in one sentence."
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

        resp = client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
        markdown_out = resp.output_text.strip()

        input_tokens = resp.usage.input_tokens
        output_tokens = resp.usage.output_tokens
        input_cost = 0.15 / 1000000 * input_tokens
        output_cost = 0.6 / 1000000 * output_tokens
        total_cost = input_cost + output_cost
        return {"run_id": run_id, "markdown": markdown_out, "raw": resp, "usage": resp.usage, "input cost": input_cost, "output cost": output_cost, "total cost": total_cost}

class WorkflowAgentTester:
    def __init__(self, query: str, trace_block: str, cites_block: str, intents_block: str):
        self.query = query
        self.payload = {
            "trace_block": trace_block,
            "cites_block": cites_block,
            "intents_block": intents_block,
        }

    async def run(self):
        agent = Agent()
        inputs = AgentInputs(**self.payload)
        result = await agent.run(self.query, inputs)
        print("=== Simulated API Call ===")
        print("Query:", self.query)
        print("Run ID:", result["run_id"])
        print("\n--- Markdown ---\n")
        print(result["markdown"])
        # print("\n--- Raw ---\n", result["raw"])  # noisy; uncomment if needed
        return result

# WRAPPER for batch parallel calls
#
#
#
#
# parallel_llm_runner.py
# parallel_runner.py
# streaming_runner.py
import os, uuid, asyncio, time, random
from typing import Dict, Any, List, Optional, Tuple, Callable
from pydantic import BaseModel, Field
from openai import AsyncOpenAI, APIStatusError

# ------------------ Agent (async, structured output) ------------------
class AgentInputs(BaseModel):
    trace_block: str
    cites_block: str
    intents_block: str

class RelevanceResult(BaseModel):
    relevant: bool
    rationale: Optional[str] = Field(description="BLUF style rationale in one sentence.")

class AsyncAgent:
    def __init__(self, model: str = "gpt-4o-mini", api_key: Optional[str] = None):
        self.model = model
        self.client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))

    async def run(self, query: str, inputs: AgentInputs) -> Dict[str, Any]:
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
        usage = {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
            "total_tokens": resp.usage.total_tokens,
        }
        return {
            "run_id": f"filter-{uuid.uuid4().hex[:8]}",
            "response": resp.output_parsed,  # RelevanceResult instance
            "usage": usage,
            "raw": resp,  # keep for debugging (optional)
            "prompt": system + "\n\n" + user_content
        }

# ------------------ Graph helpers ------------------
def iter_trace_nodes(G) -> List[Dict[str, Any]]:
    """Return [{trace_uuid,bottom_uuid,bottom_clause}, ...] for ntype=='Trace'."""
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

# ------------------ Retry wrapper ------------------
async def _call_with_retry(agent: AsyncAgent, query: str, payload: AgentInputs, *, max_retries=5):
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
            return {"ok": False, "error": str(e), "status_code": code}
        except Exception as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(delay + random.uniform(0, 0.4))
                delay = min(delay * 2, 6)
                continue
            return {"ok": False, "error": repr(e), "status_code": None}

# ------------------ Core: one parallel batch with live events ------------------
async def _run_batch_parallel(
    batch_items: List[Dict[str, Any]],
    *,
    agent: AsyncAgent,
    ops,
    query: str,
    pricing_per_million: Tuple[float, float],
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> List[Dict[str, Any]]:
    """
    Runs ONE batch fully in parallel (len(batch_items) concurrent).
    Emits events: batch_start, item_done (for each finished item), batch_progress, batch_end.
    """
    t0 = time.time()
    total = len(batch_items)
    done = 0
    batch_in_tokens = 0
    batch_out_tokens = 0
    results: List[Dict[str, Any]] = []

    def emit(evt: Dict[str, Any]):
        if on_event:
            try:
                on_event(evt)
            except Exception:
                pass  # never break the runner because UI listener failed

    emit({"type": "batch_start", "size": total, "ts": time.time()})

    async def one(item: Dict[str, Any]) -> Dict[str, Any]:
        if not item.get("bottom_uuid"):
            return {**item, "response": {"ok": False, "error": "missing bottom_uuid"}}

        # Build input blocks
        bundle = ops.build_records_for_bottom(item["bottom_uuid"])
        tb = ops.format_trace_block(bundle["trace"], include_uuids=False, include_text=False)
        cb = ops.format_citations_block(bundle["trace"], bundle["cites"], include_uuids=False)
        ib = ops.format_intents_block(bundle["trace"], bundle["intents"], fields=["intent", "section_intent"], include_uuids=False)
        payload = AgentInputs(trace_block=tb, cites_block=cb, intents_block=ib)

        resp = await _call_with_retry(agent, query, payload)
        usage = (resp or {}).get("usage", {}) if isinstance(resp, dict) else {}
        return {
            "trace_uuid": item.get("trace_uuid"),
            "bottom_uuid": item.get("bottom_uuid"),
            "bottom_clause": item.get("bottom_clause"),
            "response": resp,
            "usage": usage,
        }

    tasks = [asyncio.create_task(one(it)) for it in batch_items]

    input_price, output_price = pricing_per_million

    # Stream results as they finish
    for fut in asyncio.as_completed(tasks):
        res = await fut
        results.append(res)

        usage = res.get("usage") or {}
        batch_in_tokens  += usage.get("input_tokens", 0) or 0
        batch_out_tokens += usage.get("output_tokens", 0) or 0
        done += 1
        batch_cost = (batch_in_tokens/1e6) * input_price + (batch_out_tokens/1e6) * output_price

        # Per-item event (for SSE/WebSocket)
        emit({
            "type": "item_done",
            "ts": time.time(),
            "done": done,
            "total": total,
            "trace_uuid": res.get("trace_uuid"),
            "bottom_uuid": res.get("bottom_uuid"),
            "bottom_clause": res.get("bottom_clause"),
            "usage": usage,
            "response": res.get("response"),
            "batch_cost": batch_cost,
        })

        # Lightweight progress tick
        emit({
            "type": "batch_progress",
            "ts": time.time(),
            "done": done,
            "total": total,
            "tokens_in": batch_in_tokens,
            "tokens_out": batch_out_tokens,
            "batch_cost": batch_cost,
            "elapsed_s": time.time() - t0,
        })

    elapsed = time.time() - t0
    final_cost = (batch_in_tokens/1e6) * input_price + (batch_out_tokens/1e6) * output_price
    emit({
        "type": "batch_end",
        "ts": time.time(),
        "elapsed_s": elapsed,
        "tokens_in": batch_in_tokens,
        "tokens_out": batch_out_tokens,
        "batch_cost": final_cost,
        "size": total,
    })
    return results

# ------------------ Orchestration: whole run (batches = parallelism) ------------------
async def run_all_traces_with_progress(
    G,
    ops,
    *,
    query: str,
    model: str = "gpt-4o-mini",
    batch_size: int = 200,   # also the parallelism
    limit: Optional[int] = None,
    pricing_per_million: Tuple[float, float] = (0.15, 0.60),
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """
    Full run with live streaming events. Batches are waves of size = parallelism.
    Emits: run_start, batch_* ..., run_end.
    Returns a final report object.
    """
    all_traces = iter_trace_nodes(G)
    if limit:
        all_traces = all_traces[:limit]

    total_traces = len(all_traces)
    batches = chunked(all_traces, batch_size)
    num_batches = len(batches)

    def emit(evt: Dict[str, Any]):
        if on_event:
            try:
                on_event(evt)
            except Exception:
                pass

    emit({
        "type": "run_start",
        "ts": time.time(),
        "model": model,
        "query": query,
        "total_traces": total_traces,
        "batch_size": batch_size,
        "num_batches": num_batches,
        "pricing_per_million": {"input_usd": pricing_per_million[0], "output_usd": pricing_per_million[1]},
    })

    agent = AsyncAgent(model=model)
    total_in_tokens = 0
    total_out_tokens = 0
    total_results: List[Dict[str, Any]] = []

    for i, batch in enumerate(batches, start=1):
        emit({"type": "batch_header", "index": i, "of": num_batches, "size": len(batch), "ts": time.time()})
        batch_results = await _run_batch_parallel(
            batch,
            agent=agent,
            ops=ops,
            query=query,
            pricing_per_million=pricing_per_million,
            on_event=on_event,
        )
        # accumulate totals
        b_in = sum(((r.get("usage") or {}).get("input_tokens") or 0) for r in batch_results)
        b_out = sum(((r.get("usage") or {}).get("output_tokens") or 0) for r in batch_results)
        total_in_tokens += b_in
        total_out_tokens += b_out
        total_results.extend(batch_results)

    grand_cost = (total_in_tokens/1e6)*pricing_per_million[0] + (total_out_tokens/1e6)*pricing_per_million[1]
    summary = {
        "model": model,
        "query": query,
        "total_traces": total_traces,
        "batch_size_parallelism": batch_size,
        "num_batches": num_batches,
        "tokens_in": total_in_tokens,
        "tokens_out": total_out_tokens,
        "estimated_cost": grand_cost,
        "pricing_per_million": {"input_usd": pricing_per_million[0], "output_usd": pricing_per_million[1]},
    }
    emit({"type": "run_end", "ts": time.time(), "summary": summary})

    return {"summary": summary, "results": total_results}

# ------------------ Example: simple console event handler ------------------
def console_events(evt: Dict[str, Any]):
    t = evt.get("type")
    if t == "run_start":
        print("=== PLAN ===")
        print(f"Model: {evt['model']}")
        print(f"Query: {evt['query']}")
        print(f"Total traces: {evt['total_traces']}")
        print(f"Batch size (parallelism): {evt['batch_size']}")
        print(f"Total batches: {evt['num_batches']}")
        print("============")
    elif t == "batch_header":
        print(f"--- Batch {evt['index']}/{evt['of']} | size={evt['size']} (running {evt['size']} in parallel) ---")
    elif t == "batch_progress":
        done, total = evt["done"], evt["total"]
        pct = (done/total*100) if total else 100
        print(f"\r  progress: {done}/{total} ({pct:5.1f}%)  in={evt['tokens_in']:,} out={evt['tokens_out']:,} "
              f"cost=${evt['batch_cost']:,.4f}", end="")
        if done == total:
            print()
    elif t == "batch_end":
        print(f"  batch done in {evt['elapsed_s']:0.1f}s | "
              f"in={evt['tokens_in']:,} out={evt['tokens_out']:,} cost=${evt['batch_cost']:,.4f}")
    elif t == "run_end":
        s = evt["summary"]
        print("\n=== SUMMARY ===")
        print(f"Traces processed: {s['total_traces']}")
        print(f"Total tokens in:  {s['tokens_in']:,}")
        print(f"Total tokens out: {s['tokens_out']:,}")
        print(f"Estimated cost:   ${s['estimated_cost']:,.4f}")
        print("===============")

# ---- glue to your graph -----------------------------------------------------
if __name__ == "__main__":
    # Import after env is ready to avoid path surprises
    from src.graphs.cs25_graph.utils import ManifestGraph, GraphOps
    from dotenv import load_dotenv, find_dotenv
    from openai import OpenAI

    # ---- env / client -----------------------------------------------------------
    load_dotenv(find_dotenv(".env"))  # finds .env anywhere up the tree
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not found in .env")
    client = OpenAI(api_key=api_key)

    # 1) Load graph (will return status JSON and set .G)
    mg = ManifestGraph()                      # defaults to folder of utils.py in cs25_graph
    load_status = mg.load()                   # returns a dict; mg.G has the graph
    print("LOAD STATUS:", load_status)

    ops = GraphOps(mg.G)

    query = "What requirements are impacted by the 'least favourable centre of gravity' location?"

    # 2) Build records for a specific bottom paragraph (replace with any bottom UUID you have)
    bottom_uuid = "05b430f7-fae4-47ac-baa0-fc4dc0ff48b7"
    bottom_uuid = "4ca9b233-a70c-4d3a-907c-cc93041aaa28"
    bundle = ops.build_records_for_bottom(bottom_uuid=bottom_uuid)

    # 3) Turn records into Markdown blocks (Markdown-safe, no hard wraps)
    trace_block   = ops.format_trace_block(bundle["trace"], include_uuids=False, include_text=True)
    cites_block   = ops.format_citations_block(bundle["trace"], bundle["cites"], include_uuids=False)
    intents_block = ops.format_intents_block(bundle["trace"], bundle["intents"], include_uuids=False)

    # 4) Run the “sandbox” agent_langgraph with a concrete query

    tester = WorkflowAgentTester(query, trace_block, cites_block, intents_block)
    asyncio.run(tester.run())

    ######
    report = asyncio.run(
             run_all_traces_with_progress(
                 mg.G, ops,
                 query=query,
                 model="gpt-5-nano",
                 batch_size=50,                    # == parallelism
                 limit=100,                        # or 500 while testing
                 pricing_per_million=(0.05, 0.40),  # adjust to model
                 on_event=console_events,           # swap with SSE/WebSocket broadcaster later
             )
         )



true_count = 0
false_count = 0
true_rationales = []
false_rationales = []

for entry in report["results"]:
    resp = entry.get("response", {})
    parsed = resp.get("response")  # RelevanceResult object
    if not parsed:
        continue

    clause = entry.get("bottom_clause", "<unknown>")

    if parsed.relevant:
        true_count += 1
        true_rationales.append(f"{clause} — {parsed.rationale}")
    else:
        false_count += 1
        false_rationales.append(f"{clause} — {parsed.rationale}")

print(f"Relevant=True:  {true_count}")
print(f"Relevant=False: {false_count}")

print("\n--- Sample True Rationales ---")
for r in true_rationales[:20]:
    print("-", r)

print("\n--- Sample False Rationales ---")
for r in false_rationales[:20]:
    print("-", r)


#######
####
#
#
#

