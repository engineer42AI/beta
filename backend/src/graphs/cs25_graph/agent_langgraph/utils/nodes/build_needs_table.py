# backend/src/graphs/cs25_graph/agent_langgraph/utils/nodes/build_needs_table.py
import time, uuid
from typing import List, Dict, Any
from langchain_core.messages import AIMessage
from src.graphs.cs25_graph.agent_langgraph.utils.progress_bus import emit as bus_emit

def _wrap(evt: Dict[str, Any]) -> Dict[str, Any]:
    t = evt.get("type")
    mapping = {
        "run_start": "needsTable.runStart",
        "item":      "needsTable.item",
        "run_end":   "needsTable.runEnd",
        "error":     "needsTable.error",
    }
    return {**evt, "type": mapping.get(t, f"needsTable.{t or 'event'}")}

async def build_needs_table_node(state, store, **kwargs):
    tab_id = state.get("tab_id", "") or ""

    item = await store.aget(("cs25_context", tab_id), "latest")
    ctx = item.value if item and hasattr(item, "value") else {}

    frozen = bool(ctx.get("selections_frozen"))
    frozen_at = ctx.get("selections_frozen_at") or ""
    rows = ctx.get("snapshotRows") or []

    async def emit(evt: Dict[str, Any]) -> None:
        await bus_emit(tab_id, _wrap(evt))

    if not frozen:
        await emit({"type": "error", "ts": time.time(), "data": {"message": "not_frozen"}})
        return {"messages": [AIMessage(content="Not frozen; skipping needs table build.")]}

    # keep only relevant + dedupe
    seen = set()
    kept = []
    for r in rows:
        tid = r.get("trace_uuid")
        if not tid or tid in seen:
            continue
        if r.get("relevant") is not True:
            continue
        seen.add(tid)
        kept.append(r)

    await emit({
        "type": "run_start",
        "ts": time.time(),
        "data": {"frozen_at": frozen_at, "count": len(kept)},
    })

    # stream items
    for idx, r in enumerate(kept, start=1):
        out = {
            "need_id": f"need-{uuid.uuid4().hex[:10]}",
            "trace_uuid": r.get("trace_uuid"),
            "path_labels": r.get("path_labels") or [],
            "rationale": r.get("rationale") or "",
            "index": idx,
            "total": len(kept),
        }
        await emit({"type": "item", "ts": time.time(), "item": out})

    await emit({"type": "run_end", "ts": time.time(), "data": {"count": len(kept)}})

    return {"messages": [AIMessage(content=f"✅ Needs table prepared ({len(kept)} items).")]}
