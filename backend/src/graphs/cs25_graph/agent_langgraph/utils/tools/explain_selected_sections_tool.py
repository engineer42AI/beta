# backend/src/graphs/cs25_graph/agent_langgraph/utils/tools/explain_selected_sections_tool.py

from typing_extensions import Annotated
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.messages import ToolMessage
from langgraph.prebuilt import InjectedState, InjectedStore
from langgraph.types import Command

EXPLAIN_TOOL_DESC = """
Explain CS-25 concepts, subsystem basics, or general regulatory context from selections.

Use this when the user asks educational or background questions
(e.g., 'what are typical heat exchanger types?' or 'what does CS 25.1309 cover?')
and no large-scale relevance filtering is required.
"""


@tool
def explain_selected_sections(
    topic: str,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """
    EXPLAIN: Clarify intent/obligations/checklists for sections already identified (or a narrowed topic).
    Not for discovery.
    """

    # ... your real streaming retrieval/interpret engine runs elsewhere ...


    summary = f"Explainations generated for “{topic}”. Check the page above for the suggested sections."

    return Command(
        update={"messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)]}
    )
