# backend/src/graphs/cs25_graph/agent_langgraph/needs_panel_langgraph_v1.py


from typing import Any, AsyncGenerator, Dict, Optional, Tuple
import os
import uuid
import asyncio
import contextlib

from dotenv import load_dotenv, find_dotenv

from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langgraph.graph import StateGraph, START, END
from langgraph.store.redis.aio import AsyncRedisStore
from langgraph.checkpoint.redis.aio import AsyncRedisSaver

from src.graphs.cs25_graph.agent_langgraph.utils.progress_bus import (
    register as pb_register,
    unregister as pb_unregister,
)
from src.graphs.cs25_graph.agent_langgraph.utils.state import NeedsPanelScanState
from src.graphs.cs25_graph.agent_langgraph.utils.nodes.scan_needs_panel import scan_needs_panel


# ---- env -------------------------------------------------------------------
load_dotenv(find_dotenv(".env"))
if not os.getenv("OPENAI_API_KEY"):
    # Node will raise if actually invoked; keeping module import safe.
    pass


# ---- runtime (separate from agent_langgraph_v2) -----------------------------
_store: Optional[AsyncRedisStore] = None
_checkpointer: Optional[AsyncRedisSaver] = None
_graph = None


def _thread_id(tab_id: str) -> str:
    # One panel conversation per tab (history persists via checkpointer)
    return f"{tab_id}::needs_panel_scan"


# ---- graph build -----------------------------------------------------------
async def init_runtime(store: AsyncRedisStore, checkpointer: AsyncRedisSaver):
    """
    Called once at app startup (from main lifespan), using the SAME live Redis
    contexts, but this runtime is logically separate from agent_langgraph_v2.
    """
    global _store, _checkpointer, _graph
    _store = store
    _checkpointer = checkpointer
    _graph = None
    await build_needs_panel_graph()


async def build_needs_panel_graph():
    global _store, _checkpointer, _graph
    if _graph is not None:
        return _graph
    assert _store is not None and _checkpointer is not None, "needs_panel init_runtime() not called"

    builder = StateGraph(NeedsPanelScanState)
    builder.add_node("scan_needs_panel", scan_needs_panel)
    builder.add_edge(START, "scan_needs_panel")
    builder.add_edge("scan_needs_panel", END)

    _graph = builder.compile(checkpointer=_checkpointer, store=_store)
    return _graph


async def get_needs_panel_graph():
    return await build_needs_panel_graph()


async def get_store():
    global _store
    if _store is None:
        raise RuntimeError("Needs panel runtime not initialized. Call init_runtime() at app startup.")
    return _store


# ---- merge helper (graph updates + progress bus events) ---------------------
async def _merge_graph_and_progress(graph_async_iter, progress_q: "asyncio.Queue[Dict[str, Any]]"):
    ait = graph_async_iter.__aiter__()
    t_graph = asyncio.create_task(ait.__anext__())
    t_prog = asyncio.create_task(progress_q.get())
    try:
        while True:
            done, _ = await asyncio.wait({t_graph, t_prog}, return_when=asyncio.FIRST_COMPLETED)

            if t_graph in done:
                try:
                    update = t_graph.result()
                except StopAsyncIteration:
                    # drain any leftover progress events
                    while True:
                        try:
                            evt = progress_q.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                        else:
                            yield ("progress", evt)
                    break
                else:
                    yield ("graph", update)
                    t_graph = asyncio.create_task(ait.__anext__())

            if t_prog in done:
                evt = t_prog.result()
                yield ("progress", evt)
                t_prog = asyncio.create_task(progress_q.get())

    finally:
        for t in (t_graph, t_prog):
            if not t.done():
                t.cancel()
                with contextlib.suppress(Exception):
                    await t


# ---- streaming entrypoint (router will call this) ---------------------------
async def stream_needs_panel_scan_response(
    *,
    tab_id: str,
    query: str,
    payload: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    node_kwargs: Optional[Dict[str, Any]] = None,  # optional overrides for scan node
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Stream contract (envelope-first):
      {type, payload, metadata}

    Most important streamed events come from the scan node via progress_bus:
      - needsPanel.runStart
      - needsPanel.item
      - needsPanel.progress
      - needsPanel.runEnd
    """
    graph = await get_needs_panel_graph()

    run_id = uuid.uuid4().hex
    sink = "needs_panel"

    base_meta = {
        "tabId": tab_id,
        "sink": sink,
        "runId": run_id,
    }

    # stream start
    yield {
        "type": "needsPanel.streamStart",
        "payload": {"query": query, **(payload or {})},
        "metadata": {**base_meta, **(metadata or {})},
    }

    # progress bus listener -> queue
    progress_q: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()

    async def _emit(evt: Dict[str, Any]) -> None:
        # evt already should be {type,payload,metadata} from node.
        # ensure tagging + runId
        if not isinstance(evt, dict):
            return
        md = evt.get("metadata") if isinstance(evt.get("metadata"), dict) else {}
        md = {**md, **base_meta}  # runId+sink+tabId always present
        await progress_q.put({**evt, "metadata": md})

    registered = False
    await pb_register(tab_id, _emit)
    registered = True

    # init state: query becomes the user message (MessagesState)
    init_state: Dict[str, Any] = {
        "tab_id": tab_id,
        "messages": [{"role": "user", "content": query}],
    }

    config = {"configurable": {"thread_id": _thread_id(tab_id)}}

    merged_iter = _merge_graph_and_progress(
        graph.astream(
            init_state,
            config={**config, "configurable": {**config["configurable"], **(node_kwargs or {})}},
            stream_mode="updates",
        ),
        progress_q,
    )

    try:
        async for source, obj in merged_iter:
            if source == "progress":
                # forward node-emitted event as-is
                yield obj
                continue

            # optional: forward graph messages (usually just the final ✅ message)
            update = obj or {}
            for node_name, delta in update.items():
                if not isinstance(delta, dict):
                    continue
                msgs = delta.get("messages") or []
                for m in msgs:
                    if isinstance(m, AIMessageChunk):
                        part = m.content or ""
                        if part:
                            yield {
                                "type": "needsPanel.delta",
                                "payload": {"content": part, "node": node_name},
                                "metadata": base_meta,
                            }
                    elif isinstance(m, AIMessage):
                        text = (m.content or "").strip()
                        if text:
                            yield {
                                "type": "needsPanel.message",
                                "payload": {"content": text, "node": node_name},
                                "metadata": base_meta,
                            }
                    elif isinstance(m, ToolMessage):
                        yield {
                            "type": "needsPanel.toolResult",
                            "payload": {
                                "name": getattr(m, "name", None),
                                "tool_call_id": getattr(m, "tool_call_id", None),
                                "content": m.content,
                                "node": node_name,
                            },
                            "metadata": base_meta,
                        }

    finally:
        if registered:
            await pb_unregister(tab_id)

        yield {
            "type": "needsPanel.streamEnd",
            "payload": {},
            "metadata": base_meta,
        }