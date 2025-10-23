# backend/src/graphs/cs25_graph/agent_langgraph/utils/tools/find_relevant_sections_tool.py

from typing import Annotated
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool, InjectedToolCallId
from langgraph.types import Command
from langgraph.prebuilt import InjectedState, InjectedStore
from langgraph.store.base import BaseStore
from src.graphs.cs25_graph.agent_langgraph.utils.state import AgentState

@tool
async def find_relevant_sections(
    topic: str,
    state: Annotated[AgentState, InjectedState],
    store: Annotated[BaseStore, InjectedStore],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """
    FIND: Rank which sections in the CURRENT SELECTION are relevant to the self-contained topic.
    Discovery only; not explanations.
    """

    # tab_id must be part of your AgentState

    tab_id = state.get("tab_id", "") or ""
    # Async store read (requires graph compiled with an AsyncRedisStore)
    item = await store.aget(("cs25_context", tab_id), "latest")
    ctx = item.value if item and hasattr(item, "value") else {}
    selected_ids = ctx.get("selected_ids", [])

    # ... kick off / perform your heavy relevance run here ...
    # (stream live progress via your existing orchestrator path)

    summary = f"Relevant sections generated for “{topic}”. Considered {len(selected_ids)} selected regulations. Check the page above for the suggested sections."

    return Command(update={"messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)]})