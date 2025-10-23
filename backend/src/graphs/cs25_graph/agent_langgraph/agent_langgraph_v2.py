# backend/src/graphs/cs25_graph/agent_langgraph/agent_langgraph_v2.py

from dotenv import load_dotenv, find_dotenv
import os
# ---- env / client -----------------------------------------------------------
load_dotenv(find_dotenv(".env"))  # finds .env anywhere up the tree
api_key = os.getenv("OPENAI_API_KEY")

os.environ["LANGSMITH_TRACING"] = "true"
os.environ["LANGSMITH_ENDPOINT"] = "https://api.smith.langchain.com"
os.environ["LANGSMITH_API_KEY"] = "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"
os.environ["LANGSMITH_PROJECT"] = "agent-langgraph V3"

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

from typing import Any, AsyncGenerator, Dict, Optional

from src.graphs.cs25_graph.agent_langgraph.utils.tools.find_relevant_sections_tool import find_relevant_sections
from src.graphs.cs25_graph.agent_langgraph.utils.tools.explain_selected_sections_tool import explain_selected_sections
from src.graphs.cs25_graph.agent_langgraph.utils.tools.recommend_sections_tool import recommend_sections
from src.graphs.cs25_graph.agent_langgraph.utils.tools.think_tool import think_tool
from src.graphs.cs25_graph.agent_langgraph.utils.nodes.find_relevant_sections import find_relevant_sections_llm

from src.graphs.cs25_graph.agent_langgraph.utils.nodes.nodes import tool_calling_llm, UI_decide_node, recommend_sections_llm, topic_llm
from src.graphs.cs25_graph.agent_langgraph.utils.state import AgentState
from langgraph.checkpoint.redis.aio import AsyncRedisSaver
from langgraph.store.redis.aio import AsyncRedisStore
from langchain_core.messages import BaseMessage, AIMessage, AIMessageChunk, ToolMessage

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from src.graphs.cs25_graph.agent_langgraph.utils.progress_bus import register as pb_register, unregister as pb_unregister


from langgraph.graph import StateGraph, START, END
from langgraph.graph import MessagesState
from langgraph.prebuilt import ToolNode
from langgraph.prebuilt import tools_condition

import asyncio
import contextlib
from typing import Callable, Awaitable, Dict, Any, Tuple

_store: Optional[AsyncRedisStore] = None
_checkpointer: Optional[AsyncRedisSaver] = None
_graph = None

async def init_runtime(store: AsyncRedisStore, checkpointer: AsyncRedisSaver):
    """Called once at app startup (after entering async contexts)."""
    global _store, _checkpointer, _graph
    _store = store
    _checkpointer = checkpointer
    _graph = None
    await build_agent_graph()

async def build_agent_graph():

    global _store, _checkpointer, _graph
    if _graph is not None:
        return _graph
    assert _store is not None and _checkpointer is not None, "init_runtime() not called"

    tools_for_recommend_sections_llm = [recommend_sections, think_tool]

    tools_for_tool_calling_llm = [explain_selected_sections, find_relevant_sections]


    builder = StateGraph(AgentState)

    builder.add_node("topic_llm", topic_llm)
    builder.add_node("recommend_sections_llm", recommend_sections_llm)
    #builder.add_node("tool_calling_llm", tool_calling_llm)
    builder.add_node("find_relevant_sections_llm", find_relevant_sections_llm)

    #builder.add_node("tools_recommend", ToolNode(tools_for_recommend_sections_llm))
    #builder.add_node("tools_main", ToolNode(tools_for_tool_calling_llm))

    # Start → topic
    builder.add_edge(START, "topic_llm")

    # topic → decide (should return 'recommend' or 'main', etc.)
    builder.add_conditional_edges("topic_llm", UI_decide_node, {
        "recommend": "recommend_sections_llm",
        "main": "find_relevant_sections_llm",
    })

    # ReAct loop for recommend Sections
    #=builder.add_conditional_edges("recommend_sections_llm", tools_condition, {
    #    "tools": "tools_recommend",  # call tools for recommend
    #    "retry": "recommend_sections_llm",  # optional
    #    "end": END,
    #    "__end__": END,  # add for compatibility with older returns
    #})
    #builder.add_edge("tools_recommend", "recommend_sections_llm")  # loop back
    builder.add_edge("recommend_sections_llm", END)
    builder.add_edge("find_relevant_sections_llm", END)

    # ReAct loop for main tool-calling LLM
    #builder.add_conditional_edges("tool_calling_llm", tools_condition, {
    #    "tools": "tools_main",  # call tools for main
    #    "retry": "tool_calling_llm",
    #    "end": END,
    #})
    #builder.add_edge("tools_main", "tool_calling_llm")  # loop back

    #builder.add_edge("recommend_sections_llm", END)
    # builder.add_edge("tools", END) # router architecture

    _graph = builder.compile(checkpointer=_checkpointer, store=_store)
    return _graph

async def get_agent_graph():
    return await build_agent_graph()

async def get_store():
    global _store
    if _store is None:
        await build_agent_graph()
    return _store



# Merge LangGraph updates with progress events coming from nodes via an asyncio.Queue
async def _merge_graph_and_progress(graph_async_iter, progress_q: "asyncio.Queue[Dict[str, Any]]"):
    ait = graph_async_iter.__aiter__()
    t_graph = asyncio.create_task(ait.__anext__())
    t_prog  = asyncio.create_task(progress_q.get())
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
        # cancel pending tasks cleanly
        for t in (t_graph, t_prog):
            if not t.done():
                t.cancel()
                with contextlib.suppress(Exception):
                    await t

# ✅ Only these state keys will be emitted to the frontend as {"type":"state", "key":..., "value":...}
EMIT_STATE_KEYS: set[str] = {"topic"}  # add more keys from AgentState as you introduce them

async def stream_agent_response(
    tab_id: str,
    query: str,
    context: Dict[str, Any] | None = None,
) -> AsyncGenerator[Dict[str, Any], None]:

    graph = await get_agent_graph()
    store = await get_store()

    if context:
        await store.aput(("cs25_context", tab_id), "latest", context)

    config = {"configurable": {"thread_id": tab_id}}
    yield {"type": "run_start", "tab_id": tab_id}

    # Local queue for this HTTP stream
    progress_q: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()

    # Emitter function registered in the bus; nodes call progress_bus.emit(tab_id, evt)
    async def _emit(evt: Dict[str, Any]) -> None:
        if "tab_id" not in evt:
            evt = {"tab_id": tab_id, **evt}
        if "type" not in evt:
            evt = {"type": "analysis.progress", **evt}
        await progress_q.put(evt)

    # Register this run's emitter; unregister on any exit path
    await pb_register(tab_id, _emit)

    init_state = {
        "messages": [{"role": "user", "content": query}],
        "tab_id": tab_id,
        # ❌ do not place functions (emit) in state
    }

    assembled: list[str] = []
    emitted_any = False

    merged_iter = _merge_graph_and_progress(
        graph.astream(init_state, config=config, stream_mode="updates"),
        progress_q,
    )

    try:
        async for source, payload in merged_iter:
            if source == "progress":
                # already NDJSON-friendly
                yield payload or {}
                continue

            # LangGraph updates (unchanged)
            update = payload or {}
            for node_name, delta in update.items():
                if not isinstance(delta, dict):
                    continue

                if "messages" in delta and delta["messages"]:
                    for m in delta["messages"]:
                        if isinstance(m, AIMessageChunk):
                            part = m.content or ""
                            if part:
                                emitted_any = True
                                assembled.append(part)
                                yield {"type": "delta", "role": "assistant", "content": part}
                            fin = getattr(m, "response_metadata", {}) or {}
                            if fin.get("finish_reason") in {"stop", "length", "tool_calls"}:
                                final = "".join(assembled).strip()
                                if final:
                                    yield {"type": "message", "role": "assistant", "content": final}
                                assembled.clear()

                        elif isinstance(m, AIMessage):
                            text = (m.content or "").strip()
                            tool_calls = getattr(m, "tool_calls", None)
                            if tool_calls:
                                for tc in tool_calls:
                                    yield {
                                        "type": "tool_call",
                                        "name": tc.get("name"),
                                        "args": tc.get("args", {}),
                                        "tool_call_id": tc.get("id"),
                                        "node": node_name,
                                    }
                            if text:
                                emitted_any = True
                                yield {"type": "message", "role": "assistant", "content": text}

                        elif isinstance(m, ToolMessage):
                            yield {
                                "type": "tool_result",
                                "name": getattr(m, "name", None),
                                "tool_call_id": getattr(m, "tool_call_id", None),
                                "content": m.content,
                                "node": node_name,
                            }

                for k, v in delta.items():
                    if k == "messages":
                        continue
                    if k in EMIT_STATE_KEYS:
                        yield {"type": "state", "key": k, "value": v, "node": node_name}

        # trailing flush
        if assembled:
            final_text = "".join(assembled).strip()
            if final_text:
                yield {"type": "message", "role": "assistant", "content": final_text}
            assembled.clear()

        if not emitted_any:
            yield {"type": "message", "role": "system", "content": "No assistant message was emitted by the graph."}
    finally:
        # always unregister so nodes stop emitting into a dead stream
        await pb_unregister(tab_id)
        yield {"type": "run_end", "tab_id": tab_id}



# ============================================================
# 🔍 ENGINEER42 STREAMING EVENT SCHEMA (NDJSON over HTTP)
# ============================================================
# Every line sent to the frontend is a compact JSON object
# with a required field `"type"`.  This comment defines all
# event types that can be emitted by `stream_agent_response()`.
#
# ─────────────────────────────────────────────────────────────
# 🧭 Lifecycle
# ─────────────────────────────────────────────────────────────
# { "type": "run_start", "tab_id": "<session_id>" }
# { "type": "run_end",   "tab_id": "<session_id>" }
#
# Emitted at the beginning and end of each agent run.
# Used by the frontend to open/close a live stream session.
#
# ─────────────────────────────────────────────────────────────
# 💬 Assistant Text (LLM Streaming)
# ─────────────────────────────────────────────────────────────
# { "type": "delta", "role": "assistant", "content": "<partial text>" }
# { "type": "message", "role": "assistant", "content": "<final or full text>" }
#
# - "delta"   = small streamed token chunks (for typing animation)
# - "message" = final assembled assistant message (complete thought)
#
# ─────────────────────────────────────────────────────────────
# 🧰 Tool Calls & Results (LLM ↔ Backend Interaction)
# ─────────────────────────────────────────────────────────────
# { "type": "tool_call",
#   "name": "<tool_name>",
#   "args": { ... },
#   "tool_call_id": "<id>",
#   "node": "<graph_node_name>" }
#
# { "type": "tool_result",
#   "name": "<tool_name>",
#   "tool_call_id": "<id>",
#   "content": "<short summary or status>",
#   "node": "<graph_node_name>" }
#
# - Emitted when the LLM invokes or completes a backend tool.
# - Used by the frontend for developer/debug panels and visual status.
#
# ─────────────────────────────────────────────────────────────
# 🧩 State Updates (Controlled by EMIT_STATE_KEYS)
# ─────────────────────────────────────────────────────────────
# { "type": "state",
#   "key": "<state_key>",      # e.g. "topic"
#   "value": "<state_value>",  # e.g. "heat exchangers — design, compliance..."
#   "node": "<graph_node_name>" }
#
# - Sent whenever a whitelisted AgentState key changes.
# - Allows the frontend to dynamically render contextual state (topic, etc.).
#
# ─────────────────────────────────────────────────────────────
# ⚙️ Node Progress & Analysis Events  ← NEW
# ─────────────────────────────────────────────────────────────
# These events are emitted directly by long-running LangGraph nodes
# through the `progress_emit()` async callback.
#
# Each event follows a compact form:
# { "type": "<namespace>.<event>", "tab_id": "<session_id>", ...<payload> }
#
# Example namespace for heavy analysis node:
#
# • findRelevantSections.run_start
# • findRelevantSections.batch_start
# • findRelevantSections.batch_progress
# • findRelevantSections.item_done
# • findRelevantSections.batch_end
# • findRelevantSections.run_end
#
# Example event payloads:
# { "type": "findRelevantSections.batch_progress",
#   "done": 42,
#   "total": 200,
#   "elapsed_s": 3.41,
#   "batch_cost": 0.0023 }
#
# { "type": "findRelevantSections.item_done",
#   "item": { "trace_uuid": "...", "response": { ... }, "usage": { ... } } }
#
# - These are streamed *as they happen* from the backend node.
# - The orchestrator routes them to both:
#   • console view (live logs, stats, costs)
#   • page view (batch metrics, results table, etc.)
# - Any node can adopt its own namespace (e.g., `analysis.*`, `verify.*`).
#
# ─────────────────────────────────────────────────────────────
# ⚠️ Error Handling
# ─────────────────────────────────────────────────────────────
# { "type": "error", "message": "<human-readable error>" }
#
# - Sent if an exception occurs server-side.
# - Terminates the stream with error context.
#
# ─────────────────────────────────────────────────────────────
# ✅ Example Full Stream Sequence
# ─────────────────────────────────────────────────────────────
# {"type":"run_start","tab_id":"ai-abc123"}
# {"type":"state","key":"topic","value":"heat exchangers — design, compliance, safety","node":"topic_llm"}
# {"type":"delta","role":"assistant","content":"Checking your selected sections..."}
# {"type":"message","role":"assistant","content":"Here’s a brief summary of relevant sections."}
# {"type":"tool_call","name":"find_relevant_sections","args":{"query":"heat exchanger"},"tool_call_id":"call_456","node":"tool_calling_llm"}
# {"type":"findRelevantSections.batch_progress","done":20,"total":200,"elapsed_s":2.4}
# {"type":"findRelevantSections.item_done","item":{"trace_uuid":"uuid123","response":{"relevant":true}}}
# {"type":"findRelevantSections.batch_end","size":200,"batch_cost":0.0012}
# {"type":"tool_result","name":"find_relevant_sections","tool_call_id":"call_456","content":"Relevance analysis complete","node":"tools_main"}
# {"type":"message","role":"assistant","content":"Relevance scan complete. Check the page for detailed results."}
# {"type":"run_end","tab_id":"ai-abc123"}
#
# ─────────────────────────────────────────────────────────────
# 🔧 Summary of Event Types
# ─────────────────────────────────────────────────────────────
# run_start / run_end             → lifecycle markers
# delta / message                 → assistant text (LLM stream)
# tool_call / tool_result         → backend tool interactions
# state                           → AgentState updates (topic, etc.)
# findRelevantSections.*          → node-originated analysis stream
# error                           → server error or stream failure
# ============================================================
