# backend/src/graphs/cs25_graph/agent_langgraph/utils/state.py

from typing import Annotated, Literal, NotRequired, Optional
from langgraph.prebuilt.chat_agent_executor import AgentState
from typing import Optional
from langgraph.graph import MessagesState

class DeepAgentState(AgentState):
    relevance_run_status: str
    relevance_status: Literal["completed", "warning", "error"]
    explain_message: str


class AgentState(MessagesState):
    tab_id: str
    topic: Optional[str]

    selection_count: int
    relevance_count: int

    selections_frozen: bool
    selections_frozen_at: Optional[str]

    system_status: Optional[str] = None  # NEW
    needs_trigger: Optional[str] = None