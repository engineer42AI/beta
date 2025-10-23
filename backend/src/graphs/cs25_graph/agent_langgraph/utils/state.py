# backend/src/graphs/cs25_graph/agent_langgraph/utils/state.py

from typing import Annotated, Literal, NotRequired, Optional
from langgraph.prebuilt.chat_agent_executor import AgentState
from typing import Optional


class DeepAgentState(AgentState):
    relevance_run_status: str
    relevance_status: Literal["completed", "warning", "error"]
    explain_message: str

from langgraph.graph import MessagesState

class AgentState(MessagesState):
    tab_id: str
    topic: Optional[str]
