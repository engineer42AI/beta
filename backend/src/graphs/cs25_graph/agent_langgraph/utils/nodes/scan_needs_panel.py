# backend/src/graphs/cs25_graph/agent_langgraph/utils/nodes/scan_needs_panel.py
import os
import time
import json
import asyncio
import random
from typing import Any, Dict, List, Optional, AsyncGenerator, Tuple

from pydantic import BaseModel, Field
from openai import AsyncOpenAI, APIStatusError
from langchain_core.messages import AIMessage

from src.graphs.cs25_graph.agent_langgraph.utils.progress_bus import emit as bus_emit


# ------------------ OpenAI client ------------------

_OPENAI_CLIENT: Optional[AsyncOpenAI] = None

def get_openai_client() -> AsyncOpenAI:
    global _OPENAI_CLIENT
    if _OPENAI_CLIENT is None:
        _OPENAI_CLIENT = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _OPENAI_CLIENT


# ------------------ Store helpers ------------------

def _unwrap_item(item: Any) -> Dict[str, Any]:
    if item is None:
        return {}
    if isinstance(item, dict):
        return item
    return getattr(item, "value", {}) or {}


async def _get_sandbox_draft(store, tab_id: str) -> Dict[str, Any]:
    item = await store.aget(("cs25_needs_sandbox", tab_id), "latest")
    obj = _unwrap_item(item)

    # ✅ tolerate store wrappers
    if isinstance(obj, dict):
        if isinstance(obj.get("draft"), dict):
            return obj["draft"]
        if isinstance(obj.get("payload"), dict):
            return obj["payload"]

    return obj if isinstance(obj, dict) else {}

def _extract_needs_list(draft: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    We intentionally avoid constraining UI views (flat/grouped/drivers).
    Expect draft to contain a canonical list of need items at draft["items"].
    """
    items = draft.get("items") or []
    return items if isinstance(items, list) else []


# ------------------ Agent schema ------------------

class NeedEvalInput(BaseModel):
    user_query: str
    need_headline: str
    need_statement: str
    need_rationale: str
    paragraph_name: Optional[str] = None
    intents_block_trace: Optional[str] = None


class NeedEvalOutput(BaseModel):
    trigger: bool = Field(description="True if this need applies to the user scenario/question.")
    confidence: float = Field(ge=0, le=1, description="0..1 confidence in trigger decision.")
    message: str = Field(description="<= 40 words. Concrete explanation why/why not.")


def _enrich_usage(usage: Dict[str, Any], pricing_per_million: Tuple[float, float]) -> Dict[str, Any]:
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


async def _call_with_retry(
    client: AsyncOpenAI,
    *,
    model: str,
    system: str,
    user: str,
    max_retries: int = 5,
) -> Dict[str, Any]:
    delay = 0.6
    for attempt in range(max_retries):
        try:
            print("="*80)
            print(f"[E42][needsPanel][system message]\n {system} \n\n")
            print(f"[E42][needsPanel][user message]\n {user} \n\n")
            print("-" * 80)
            resp = await client.responses.parse(
                model=model,
                input=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                text_format=NeedEvalOutput,
            )

            parsed_obj = resp.output_parsed
            parsed = parsed_obj.model_dump(mode="json") if hasattr(parsed_obj, "model_dump") else parsed_obj.dict()

            usage = {
                "input_tokens": getattr(resp.usage, "input_tokens", 0) if getattr(resp, "usage", None) else 0,
                "output_tokens": getattr(resp.usage, "output_tokens", 0) if getattr(resp, "usage", None) else 0,
                "total_tokens": getattr(resp.usage, "total_tokens", 0) if getattr(resp, "usage", None) else 0,
            }

            return {"ok": True, "parsed": parsed, "usage": usage}

        except APIStatusError as e:
            code = getattr(e, "status_code", 0)
            retryable = code in (429, 500, 502, 503, 504)
            if retryable and attempt < max_retries - 1:
                await asyncio.sleep(delay + random.uniform(0, 0.4))
                delay = min(delay * 2, 6)
                continue
            return {"ok": False, "error": f"APIStatusError({code})", "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}}

        except Exception as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(delay + random.uniform(0, 0.4))
                delay = min(delay * 2, 6)
                continue
            return {"ok": False, "error": f"{type(e).__name__}: {e}", "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}}

    return {"ok": False, "error": "agent_call_failed", "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}}


# ------------------ Node (emits streaming events via progress_bus) ------------------

async def scan_needs_panel(state, store, **kwargs):
    """
    Runs an LLM eval per need (parallel, batched) and streams results as they complete.

    Emits (via progress bus):
      - needsPanel.runStart
      - needsPanel.item
      - needsPanel.progress
      - needsPanel.runEnd / needsPanel.error

    Event envelope: always {type, payload, metadata}.
    """
    tab_id = state.get("tab_id", "") or ""
    messages = state.get("messages", []) or []
    user_query = ""
    if messages:
        last = messages[-1]
        user_query = getattr(last, "content", "") if not isinstance(last, dict) else (last.get("content") or "")
    user_query = (user_query or "").strip()

    # ---- node-owned “setup” (NOT in state) ---------------------------------
    model = kwargs.get("model") or os.getenv("NEEDS_PANEL_MODEL", "gpt-5.2")
    batch_size = int(kwargs.get("batch_size") or 25)
    concurrency = int(kwargs.get("concurrency") or 12)
    pricing_per_million = kwargs.get("pricing_per_million") or (0.05, 0.40)

    async def emit(evt_type: str, payload: Dict[str, Any], **meta_extra: Any) -> None:
        metadata = {
            "ts": time.time(),
            "tabId": tab_id,
            "sink": "needs_panel",
            **(meta_extra or {}),
        }
        await bus_emit(tab_id, {"type": evt_type, "payload": payload or {}, "metadata": metadata})

    if not user_query:
        await emit("needsPanel.error", {"message": "Empty query."})
        return {"messages": [AIMessage(content="Empty query; skipping needs panel scan.")]}

    draft = await _get_sandbox_draft(store, tab_id)
    items = _extract_needs_list(draft)

    if not items:
        await emit("needsPanel.error", {"message": "No needs found in sandbox draft (draft.items missing/empty)."})
        return {"messages": [AIMessage(content="No sandbox needs found; re-sync the needs sandbox first.")]}

    # keep only items with minimal info
    needs = []
    for it in items:
        if not isinstance(it, dict):
            continue
        nid = str(it.get("need_id") or "").strip()
        st  = str(it.get("statement") or "").strip()
        if nid and st:
            needs.append(it)

    total = len(needs)
    await emit("needsPanel.runStart", {"total": total, "model": model, "query": user_query})

    client = get_openai_client()
    sem = asyncio.Semaphore(max(1, concurrency))

    system = """
You are an expert aircraft certification engineer.

Task:
Given a USER SCENARIO/QUESTION and ONE engineering NEED (derived from CS-25),
decide whether the NEED applies to the scenario.

Rules:
- Output strictly matches schema.
- Do not invent design details.
- Use NEED_STATEMENT as the authoritative requirement translation.
- If the scenario is too vague, set trigger=false with low confidence and ask for the missing detail in message (still <=40 words).
""".strip()

    done = 0
    total_in = 0
    total_out = 0
    pin, pout = pricing_per_million

    # Persist last results (optional but useful for refresh)
    results_map: Dict[str, Any] = {}

    async def eval_one(it: Dict[str, Any]) -> Dict[str, Any]:
        nid = str(it.get("need_id") or "")
        need_code = str(it.get("need_code") or "")
        headline = str(it.get("headline") or "")
        statement = str(it.get("statement") or "")
        rationale = str(it.get("rationale") or "")
        paragraph_name = (it.get("paragraph_name") or None)
        intents_block = (it.get("intents_block_trace") or None)

        inp = NeedEvalInput(
            user_query=user_query,
            need_headline=headline,
            need_statement=statement,
            need_rationale=rationale,
            paragraph_name=paragraph_name,
            intents_block_trace=intents_block,
        )

        user = f"""
<USER_QUERY>
{inp.user_query}
</USER_QUERY>

<NEED_HEADLINE>
{inp.need_headline}
</NEED_HEADLINE>

<NEED_STATEMENT>
{inp.need_statement}
</NEED_STATEMENT>

<NEED_RATIONALE>
{inp.need_rationale}
</NEED_RATIONALE>

<BOTTOM_PARAGRAPH>
{inp.paragraph_name or ""}
</BOTTOM_PARAGRAPH>

<TRACE_INTENTS>
{inp.intents_block_trace or ""}
</TRACE_INTENTS>
""".strip()

        async with sem:
            res = await _call_with_retry(client, model=model, system=system, user=user)

        usage = _enrich_usage(res.get("usage") or {}, pricing_per_million)

        if not res.get("ok"):
            return {
                "need_id": nid,
                "need_code": need_code,
                "ok": False,
                "error": res.get("error") or "eval_failed",
                "usage": usage,
            }

        parsed = res.get("parsed") or {}
        return {
            "need_id": nid,
            "need_code": need_code,
            "ok": True,
            "trigger": bool(parsed.get("trigger")),
            "confidence": float(parsed.get("confidence", 0.0) or 0.0),
            "message": (parsed.get("message") or "").strip(),
            "usage": usage,
        }

    # batch the needs, but stream per-need completion
    for i in range(0, total, batch_size):
        chunk = needs[i : i + batch_size]
        tasks = [asyncio.create_task(eval_one(it)) for it in chunk]

        for fut in asyncio.as_completed(tasks):
            obj = await fut
            done += 1

            u = obj.get("usage") or {}
            total_in += int(u.get("input_tokens", 0) or 0)
            total_out += int(u.get("output_tokens", 0) or 0)

            # store result for refresh
            if obj.get("need_id"):
                results_map[obj["need_id"]] = {
                    "ok": obj.get("ok", False),
                    "trigger": obj.get("trigger", False),
                    "confidence": obj.get("confidence", 0.0),
                    "message": obj.get("message", ""),
                    "error": obj.get("error"),
                }

            await emit(
                "needsPanel.item",
                {
                    "need_id": obj.get("need_id"),
                    "need_code": obj.get("need_code"),
                    "ok": obj.get("ok", False),
                    "trigger": obj.get("trigger", False),
                    "confidence": obj.get("confidence", 0.0),
                    "message": obj.get("message", ""),
                    "error": obj.get("error"),
                    # optional: per-need usage (UI can ignore)
                    "usage": obj.get("usage"),
                },
            )

            # lightweight progress
            await emit(
                "needsPanel.progress",
                {
                    "done": done,
                    "total": total,
                    "tokens_in": total_in,
                    "tokens_out": total_out,
                    "estimated_cost": (total_in / 1e6) * pin + (total_out / 1e6) * pout,
                },
            )

    # persist latest scan summary + map
    try:
        await store.aput(
            ("cs25_needs_panel_scan", tab_id),
            "latest",
            {
                "ts": time.time(),
                "query": user_query,
                "model": model,
                "results": results_map,
                "summary": {
                    "total": total,
                    "tokens_in": total_in,
                    "tokens_out": total_out,
                    "estimated_cost": (total_in / 1e6) * pin + (total_out / 1e6) * pout,
                    "pricing_per_million": {"input_usd": pin, "output_usd": pout},
                },
            },
        )
    except Exception:
        # non-fatal
        pass

    await emit(
        "needsPanel.runEnd",
        {
            "total": total,
            "done": done,
            "tokens_in": total_in,
            "tokens_out": total_out,
            "estimated_cost": (total_in / 1e6) * pin + (total_out / 1e6) * pout,
        },
    )

    return {"messages": [AIMessage(content=f"✅ Needs panel scan complete: {done}/{total}.")]}