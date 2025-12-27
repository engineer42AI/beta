# backend/src/graphs/cs25_graph/agent_langgraph/utils/nodes/build_needs_tables_dummy.py

import time, uuid
from typing import Any, Dict, List
from langchain_core.messages import AIMessage
from src.graphs.cs25_graph.agent_langgraph.utils.progress_bus import emit as bus_emit

CATS = [
  {"id": "performance", "label": "Performance"},
  {"id": "integrity",   "label": "Integrity"},
  {"id": "installation", "label": "Installation"},
]

def _wrap(evt: Dict[str, Any]) -> Dict[str, Any]:
  t = evt.get("type")
  mapping = {
    "run_start":      "needsTables.runStart",
    "category_start": "needsTables.categoryStart",
    "item":           "needsTables.item",
    "progress":       "needsTables.progress",
    "run_end":        "needsTables.runEnd",
    "error":          "needsTables.error",
  }
  return {**evt, "type": mapping.get(t, f"needsTables.{t or 'event'}")}

def _is_relevant(row: Dict[str, Any]) -> bool:
  # snapshotRows should already be relevant-only, but be defensive
  v = row.get("relevant", None)
  if v is True: return True
  # also tolerate row.latest.response.relevant shapes if you ever pass them
  latest = (row.get("latest") or {}).get("response") if isinstance(row.get("latest"), dict) else None
  if isinstance(latest, dict) and latest.get("relevant") is True: return True
  return False

def _dummy_statement(row: Dict[str, Any], cat_label: str) -> str:
  # use something stable from row (path_labels is great)
  labels = row.get("path_labels") or []
  leaf = labels[-1] if labels else (row.get("trace_uuid") or "clause")
  return f"{cat_label}: Demonstrate compliance for {leaf}."

async def build_needs_tables_dummy(state, store, **kwargs):
  tab_id = state.get("tab_id", "") or ""

  item = await store.aget(("cs25_context", tab_id), "latest")
  ctx = item.value if item and hasattr(item, "value") else {}

  frozen = bool(ctx.get("selections_frozen"))
  rows: List[Dict[str, Any]] = ctx.get("snapshotRows") or []

  async def emit(evt: Dict[str, Any]) -> None:
    await bus_emit(tab_id, _wrap(evt))

  if not frozen:
    await emit({"type": "error", "ts": time.time(), "data": {"message": "not_frozen"}})
    return {"messages": [AIMessage(content="Not frozen; skipping needs tables.")]}

  # keep relevant + dedupe by trace_uuid
  seen = set()
  kept = []
  for r in rows:
    tid = r.get("trace_uuid")
    if not tid or tid in seen:
      continue
    if not _is_relevant(r):
      continue
    seen.add(tid)
    kept.append(r)

  total = len(kept)
  await emit({"type": "run_start", "ts": time.time(), "data": {"total": total, "categories": CATS}})

  # stream: assign rows round-robin into 3 categories
  done = 0
  for i, r in enumerate(kept):
    cat = CATS[i % len(CATS)]

    # emit category_start on first item of each category (simple demo)
    if i < len(CATS):
      await emit({"type": "category_start", "ts": time.time(), "category": cat})

    need_item = {
      "need_id": f"need-{uuid.uuid4().hex[:10]}",
      "category_id": cat["id"],
      "category_label": cat["label"],
      "trace_uuid": r.get("trace_uuid"),
      "statement": _dummy_statement(r, cat["label"]),
      "rationale": r.get("rationale") or "",
    }
    await emit({"type": "item", "ts": time.time(), "item": need_item})

    done += 1
    await emit({"type": "progress", "ts": time.time(), "done": done, "total": total})

  await emit({"type": "run_end", "ts": time.time(), "data": {"total": total}})
  return {"messages": [AIMessage(content=f"Needs tables streamed ({total} rows).")]}

