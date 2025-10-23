# backend/src/graphs/cs25_graph/agent_langgraph/utils/tools/recommend_sections_tool.py

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



# -------- agent schema for recommending sections --------------------
class RecInputs(BaseModel):
    topic: str
    section_block: str
    intents_block: str

class RecResult(BaseModel):
    score: float = Field(ge=0.0, le=1.0, description="Score how suitable this section is as a starter selection for the topic from 0 to 1 (0 = unrelated, 0.5 = partially relevant, 1 = highly relevant).")
    rationale: Optional[str] = Field(description="Rationale in one plain-English sentence, BLUF style <20 words. Start with 'Yes;' or 'No;'.")

class SectionRecommender:
    def __init__(self, model: str, api_key: Optional[str] = None):
        self.model = model
        self.client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))

    async def run(self, inputs: RecInputs) -> dict:
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
<TOPIC>
{inputs.topic}
</TOPIC>

<TRACE>
{inputs.section_block or ""}
</TRACE>

<INTENTS>
{inputs.intents_block or ""}
</INTENTS>
"""
        # print(f"user_content: {user_content}")
        resp = await self.client.responses.parse(
            model=self.model,
            input=[{"role": "system", "content": system},
                   {"role": "user", "content": user_content}],
            text_format=RecResult,
        )
        parsed = resp.output_parsed.model_dump()
        usage = {"input_tokens": resp.usage.input_tokens,
                 "output_tokens": resp.usage.output_tokens,
                 "total_tokens": resp.usage.total_tokens}
        return {"response": parsed, "usage": usage}

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

# -------------- batch streaming over Sections -----------------------
async def _stream_sections_batch_parallel(
    batch_items: list[dict],
    *,
    agent: SectionRecommender,
    ops: GraphOps,
    topic: str,
    pricing_per_million: tuple[float, float],
) -> AsyncGenerator[dict, None]:
    t0 = time.time()
    total, done = len(batch_items), 0
    pin, pout = pricing_per_million
    batch_in, batch_out = 0, 0

    yield {"type": "batch_start", "ts": time.time(), "size": total}

    async def one(item: dict) -> dict:
        sid = item.get("section_uuid")
        bundle = ops.build_records_for_section(sid)
        sb = ops.format_section_context_block(bundle["trace"], include_uuids=False)
        ib = ops.format_section_intents_block(sid, bundle["intents"], include_uuids=False)
        rec_inputs = RecInputs(topic=topic, section_block=sb, intents_block=ib)
        res = await agent.run(rec_inputs)
        # annotate
        u = res.get("usage") or {}
        u = _enrich_usage_with_costs(u, pricing_per_million)
        return {
            "type": "item_done",
            "ts": time.time(),
            "done": None,  # filled by outer loop
            "total": total,
            "item": {
                "section_uuid": sid,
                "number": item.get("number"),
                "title": item.get("title"),
                "label": item.get("label"),
                "response": res.get("response"),
                "usage": u,
            }
        }

    tasks = [asyncio.create_task(one(it)) for it in batch_items]
    for fut in asyncio.as_completed(tasks):
        evt = await fut
        done += 1
        evt["done"] = done
        usage = evt["item"]["usage"]
        batch_in  += int(usage.get("input_tokens", 0) or 0)
        batch_out += int(usage.get("output_tokens", 0) or 0)
        yield evt
        yield {
            "type": "batch_progress",
            "ts": time.time(),
            "done": done,
            "total": total,
            "tokens_in": batch_in,
            "tokens_out": batch_out,
            "batch_cost": (batch_in/1e6)*pin + (batch_out/1e6)*pout,
            "elapsed_s": time.time() - t0,
        }

    yield {
        "type": "batch_end",
        "ts": time.time(),
        "elapsed_s": time.time() - t0,
        "tokens_in": batch_in,
        "tokens_out": batch_out,
        "batch_cost": (batch_in/1e6)*pin + (batch_out/1e6)*pout,
        "size": total,
    }

# -------------- whole run over all Sections -------------------------
async def stream_all_sections(
    G,
    ops: GraphOps,
    *,
    topic: str,
    model: str = "gpt-5-nano",
    batch_size: int = 50,
    limit: Optional[int] = None,
    pricing_per_million: tuple[float, float] = (0.05, 0.40),
) -> AsyncGenerator[dict, None]:
    secs = ops.iter_section_nodes()
    if limit:
        secs = secs[:limit]
    batches = [secs[i:i+batch_size] for i in range(0, len(secs), batch_size)]

    yield {"type": "run_start",
           "ts": time.time(),
           "model": model,
           "topic": topic,
           "total_sections": len(secs),
           "batch_size": batch_size,
           "num_batches": len(batches),
           "pricing_per_million": {"input_usd": pricing_per_million[0], "output_usd": pricing_per_million[1]}}

    agent = SectionRecommender(model=model)
    total_in, total_out = 0, 0

    for i, batch in enumerate(batches, 1):
        yield {"type": "batch_header", "index": i, "of": len(batches), "size": len(batch), "ts": time.time()}
        async for evt in _stream_sections_batch_parallel(
            batch, agent=agent, ops=ops, topic=topic, pricing_per_million=pricing_per_million
        ):
            yield evt
            if evt["type"] == "item_done":
                u = evt["item"]["usage"]
                total_in  += int(u.get("input_tokens", 0) or 0)
                total_out += int(u.get("output_tokens", 0) or 0)

    grand_cost = (total_in/1e6)*pricing_per_million[0] + (total_out/1e6)*pricing_per_million[1]
    yield {"type": "run_end",
           "ts": time.time(),
           "summary": {"model": model,
                       "topic": topic,
                       "total_sections": len(secs),
                       "batch_size_parallelism": batch_size,
                       "num_batches": len(batches),
                       "tokens_in": total_in,
                       "tokens_out": total_out,
                       "estimated_cost": grand_cost,
                       "pricing_per_million": {"input_usd": pricing_per_million[0], "output_usd": pricing_per_million[1]}}}



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


@tool
async def recommend_sections(
    state: Annotated[AgentState, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """
    Recommend starter CS-25 sections.
    """

    # load graph runtime (cached)
    mg, ops = _get_runtime()

    topic = state["topic"]

    # stream to your websocket/event sink
    #async for evt in stream_all_sections(
    #        mg.G,
    #        ops,
    #        topic=topic,
    #        model="gpt-5-nano",  # pick your small model for cheap fanout
    #        batch_size=200,  # tune
    #        pricing_per_million=(0.05, 0.40),
    #):
        # forward evt to UI (your infra), e.g., state.event_sink.publish(evt)
        # you already do this in your other tools; re-use that adaptor.
    #    print(evt)  # raw dict for each event

    summary = f"""
Starter recommendations generated for “{topic}”. Each with a score (0 = unrelated, 0.5 = partially relevant, 1 = highly relevant), and reasoning. 

- §25.1309 — Equipment, systems and installations (0.95): General safety and reliability requirements.
- §25.863 — Flammable fluid fire protection (0.88): Addresses leak and fire risks around thermal components.
- §25.1191 — Firewalls (0.74): Relevant when heat exchangers are located in fire zones.
- §25.1529 — Instructions for continued airworthiness (0.68): Covers maintenance and inspection aspects.
- Subpart D — Design and Construction (0.61): General design standards for installation and materials.
"""


    #return Command(update={"messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)]})
    return summary
