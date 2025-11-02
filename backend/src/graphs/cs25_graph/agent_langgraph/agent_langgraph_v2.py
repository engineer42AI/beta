# backend/src/graphs/cs25_graph/agent_langgraph/agent_langgraph_v2.py

from dotenv import load_dotenv, find_dotenv
import os
import uuid

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

from src.graphs.cs25_graph.agent_langgraph.utils.nodes.nodes import tool_calling_llm, UI_selections_decide_node, recommend_sections_llm, topic_llm, maybe_freeze_intro, UI_freeze_decide_node, should_run_node, page_config_llm, decide_node
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

    builder.add_node("page_config_llm", page_config_llm)
    builder.add_node("maybe_freeze_intro", maybe_freeze_intro)
    builder.add_node("should_run_node", should_run_node)

    builder.add_node("topic_llm", topic_llm)
    builder.add_node("recommend_sections_llm", recommend_sections_llm)
    #builder.add_node("tool_calling_llm", tool_calling_llm)
    builder.add_node("find_relevant_sections_llm", find_relevant_sections_llm)

    #builder.add_node("tools_recommend", ToolNode(tools_for_recommend_sections_llm))
    #builder.add_node("tools_main", ToolNode(tools_for_tool_calling_llm))

    # Start → topic
    builder.add_edge(START, "page_config_llm")

    builder.add_conditional_edges("page_config_llm", decide_node, {
        "outline": "topic_llm",
        "needs": "maybe_freeze_intro",
        "end": END,
    })



    builder.add_edge("topic_llm", "find_relevant_sections_llm")
    builder.add_edge("find_relevant_sections_llm", END)

    builder.add_edge("maybe_freeze_intro", END)

    # freeze → decide
    #builder.add_conditional_edges(START, UI_freeze_decide_node, {
    #    "frozen": "maybe_freeze_intro",
    #    "not_frozen": "topic_llm",
    #})


    # topic → decide (should return 'recommend' or 'main', etc.)
    #builder.add_conditional_edges("topic_llm", UI_selections_decide_node, {
    #    "no_selections": "recommend_sections_llm",
    #    "with_selections": "find_relevant_sections_llm",
    #})

    # run selection scan → decide
    #builder.add_conditional_edges("should_run_node", should_run_node, {
    #    "yes": "find_relevant_sections_llm",
    #    "no": END,
    #})

    # ReAct loop for recommend Sections
    #=builder.add_conditional_edges("recommend_sections_llm", tools_condition, {
    #    "tools": "tools_recommend",  # call tools for recommend
    #    "retry": "recommend_sections_llm",  # optional
    #    "end": END,
    #    "__end__": END,  # add for compatibility with older returns
    #})
    #builder.add_edge("tools_recommend", "recommend_sections_llm")  # loop back
    #builder.add_edge("maybe_freeze_intro", END)
    #builder.add_edge("recommend_sections_llm", END)
    #builder.add_edge("find_relevant_sections_llm", END)

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


async def upsert_tab_context(store, tab_id: str, new_ctx: Dict[str, Any]) -> Dict[str, Any]:
    """
    Read existing context for this tab, shallow-merge with new_ctx, write back.
    Return the merged ctx.
    """
    existing_item = await store.aget(("cs25_context", tab_id), "latest")

    # unwrap whatever AsyncRedisStore gave us
    if existing_item is None:
        existing_val = {}
    elif isinstance(existing_item, dict):
        # some backends might already give you raw dicts if you're in memory
        existing_val = existing_item
    else:
        # LangGraph's redis store returns an Item-like object with .value
        existing_val = getattr(existing_item, "value", {}) or {}

    # shallow merge (new_ctx wins)
    merged = {**existing_val, **new_ctx}

    await store.aput(("cs25_context", tab_id), "latest", merged)
    return merged


# ✅ Only these state keys will be emitted to the frontend as {"type":"state", "key":..., "value":...}
EMIT_STATE_KEYS: set[str] = {
    "topic",
    "system_status",         # NEW
    "selection_count",
    "relevance_count",
    "selections_frozen",
    "selections_frozen_at",
}  # add more keys from AgentState as you introduce them

async def stream_agent_response(
    tab_id: str,
    query: str,
    context: Dict[str, Any] | None = None,
) -> AsyncGenerator[Dict[str, Any], None]:

    graph = await get_agent_graph()
    store = await get_store()

    # --- merge tab context BUT do not persist 'sink' -------------------------
    if context:
        ctx_to_store = dict(context)
        ctx_to_store.pop("sink", None)               # <- don't persist sink
        merged_ctx = await upsert_tab_context(store, tab_id, ctx_to_store)
    else:
        merged_ctx = await store.aget(("cs25_context", tab_id), "latest") or {}

    # --- decide sink (keep agent_langgraph as the "chat" owner) --------------
    sink_raw = (context or {}).get("sink")
    sink = sink_raw if sink_raw else ("needs" if str(query or "").startswith("__needs_") else "agent_langgraph")
    if sink_raw:
        sink = sink_raw
    else:
        sink = "needs" if str(query or "").startswith("__needs_") else "agent_langgraph"

    run_id = uuid.uuid4().hex

    config = {"configurable": {"thread_id": tab_id}}

    # Tell FE which sink/run this stream belongs to
    yield {
        "type": "run_start",
        "tab_id": tab_id,
        "sink": sink,
        "run_id": run_id,
        "source": "graph",
    }

    # Local queue for progress bus events
    progress_q: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()

    # Only AGENT runs listen to the bus to avoid relays
    listen_to_progress = (sink == "agent_langgraph")

    async def _emit(evt: Dict[str, Any]) -> None:
        # Nodes emit into the bus → forward to this run
        if "tab_id" not in evt:
            evt = {"tab_id": tab_id, **evt}
        if "type" not in evt:
            evt = {"type": "analysis.progress", **evt}
        # Tag with sink + run_id so FE can filter
        await progress_q.put({**evt, "sink": sink, "run_id": run_id})

    registered = False
    if listen_to_progress:
        await pb_register(tab_id, _emit)
        registered = True

    init_state = {
        "messages": [{"role": "user", "content": query}],
        "tab_id": tab_id,
        "selections_frozen": merged_ctx.get("selections_frozen"),
        "selections_frozen_at": merged_ctx.get("selections_frozen_at"),
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
                # debug: forwarded progress event from the bus
                print("[STREAM][progress]", {"sink": sink, "run_id": run_id, "tab_id": tab_id, "keys": list((payload or {}).keys())}, flush=True)
                yield {"source": "progress", **(payload or {})}
                continue

            update = payload or {}
            for node_name, delta in update.items():
                if not isinstance(delta, dict):
                    continue

                # --- messages (AIMessageChunk / AIMessage / ToolMessage) ---
                if "messages" in delta and delta["messages"]:
                    for m in delta["messages"]:

                        if isinstance(m, AIMessageChunk):
                            part = m.content or ""
                            if part:
                                emitted_any = True
                                if sink == "agent_langgraph":  # stream only for agent_langgraph
                                    assembled.append(part)
                                    print("[STREAM][delta]", {"len": len(part), "node": node_name, "sink": sink, "run_id": run_id}, flush=True)
                                    yield {
                                        "type": "delta",
                                        "role": "assistant",
                                        "content": part,
                                        "source": "graph",
                                        "sink": sink,
                                        "run_id": run_id,
                                    }
                            fin = getattr(m, "response_metadata", {}) or {}
                            if fin.get("finish_reason") in {"stop", "length", "tool_calls"}:
                                final = "".join(assembled).strip()
                                if final and sink == "agent_langgraph":
                                    #print("[STREAM][message]", {"len": len(final), "node": node_name, "sink": sink, "run_id": run_id}, flush=True)
                                    yield {
                                        "type": "message",
                                        "role": "assistant",
                                        "content": final,
                                        "source": "graph",
                                        "sink": sink,
                                        "run_id": run_id,
                                    }
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
                                        "source": "graph",
                                        "sink": sink,
                                        "run_id": run_id,
                                    }

                            if text:
                                emitted_any = True
                                if sink == "agent_langgraph":
                                    print("[STREAM][message]", {"len": len(text), "node": node_name, "sink": sink, "run_id": run_id}, flush=True)
                                    yield {
                                        "type": "message",
                                        "role": "assistant",
                                        "content": text,
                                        "source": "graph",
                                        "sink": sink,
                                        "run_id": run_id,
                                    }

                        elif isinstance(m, ToolMessage):
                            #print("[STREAM][tool_result]", {"name": getattr(m, "name", None), "node": node_name, "sink": sink, "run_id": run_id}, flush=True)
                            yield {
                                "type": "tool_result",
                                "name": getattr(m, "name", None),
                                "tool_call_id": getattr(m, "tool_call_id", None),
                                "content": m.content,
                                "node": node_name,
                                "source": "graph",
                                "sink": sink,
                                "run_id": run_id,
                            }

                # --- state deltas (emit to both sinks) ----------------------
                for k, v in delta.items():
                    if k == "messages":
                        continue
                    if k in EMIT_STATE_KEYS:
                        val_preview = str(v)
                        print("[STREAM][state]", {"key": k, "val": val_preview[:120], "node": node_name, "sink": sink, "run_id": run_id}, flush=True)
                        yield {
                            "type": "state",
                            "key": k,
                            "value": v,
                            "node": node_name,
                            "source": "graph",
                            "sink": sink,
                            "run_id": run_id,
                        }

        # trailing flush
        if assembled:
            final_text = "".join(assembled).strip()
            if final_text and sink == "agent_langgraph":
                print("[STREAM][message]", {"len": len(final_text), "note": "flush", "sink": sink, "run_id": run_id}, flush=True)
                yield {
                    "type": "message",
                    "role": "assistant",
                    "content": final_text,
                    "source": "graph",
                    "sink": sink,
                    "run_id": run_id,
                }
            assembled.clear()

        if not emitted_any:
            print("[STREAM][message]", {"len": 0, "note": "no assistant message", "sink": sink, "run_id": run_id}, flush=True)
            yield {
                "type": "message",
                "role": "system",
                "content": "No assistant message was emitted by the graph.",
                "source": "graph",
                "sink": sink,
                "run_id": run_id,
            }

    finally:
        if registered:
            await pb_unregister(tab_id)
        print("[STREAM][run_end]", {"sink": sink, "run_id": run_id, "tab_id": tab_id}, flush=True)
        yield {
            "type": "run_end",
            "tab_id": tab_id,
            "source": "graph",
            "sink": sink,
            "run_id": run_id,
        }

