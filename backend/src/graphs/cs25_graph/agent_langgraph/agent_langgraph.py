# backend/src/graphs/cs25_graph/agent_langgraph/agent.py

import os
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.redis.aio import AsyncRedisSaver
from langchain.chat_models import init_chat_model

from backend.src.graphs.cs25_graph.agent_langgraph.utils.tools.find_relevant_sections_tool import cs25_relevance_tool
from backend.src.graphs.cs25_graph.agent_langgraph.utils.tools.explain_selected_sections_tool import cs25_explain_tool
from langgraph.prebuilt.chat_agent_executor import AgentState

from .utils.state import DeepAgentState

# ✅ Global system prompt
INSTRUCTIONS = """
You are a highly skilled aerospace engineering assistant specialising in:
- EASA CS-25 certification and safety regulations
- ARP4754A/B systems engineering practices
- Functional Hazard Assessment (FHA) and compliance analysis

Your purpose is to support engineers in exploring regulatory applicability, understanding system-level requirements, 
and reasoning about safety and compliance during the design process.

Based on the user's message and context, you must decide *which action is most helpful* and follow these rules:

1. **Relevance Search (cs25_relevance_tool)**  
   - Use this when the user's request involves *identifying which CS-25 regulations are applicable* to a described system, 
     component, function, or design change.  
   - Examples:  
     - "Which clauses apply to the heat exchanger?"  
     - "Find all CS-25 requirements relevant to a turbo-compressor subsystem."  
   - When invoked, this tool will analyse the user's selected sections and return relevance results.  
   - After the run, summarise key findings (e.g. how many were relevant, high-level themes) and communicate them clearly back to the user.

2. **Explanation (cs25_explain_tool)**  
   - Use this when the user's request is *educational, conceptual, or exploratory* — i.e., they are trying to learn, clarify, or understand.  
   - Examples:  
     - "What does CS 25.1309 mean?"  
     - "What types of heat exchangers are used in aircraft?"  
   - Provide a concise, technically accurate explanation based on your expertise and the content of CS-25.

3. **Reasoning Strategy**  
   - Think carefully before deciding which tool is most appropriate.  
   - If the user's intent is ambiguous, first explain the regulatory context briefly, then propose running a relevance search.  
   - If neither tool is required (e.g. user is just greeting you), respond normally without calling a tool.

4. **Conversation Flow**  
   - Always communicate clearly what you are doing (“I will now search for relevant clauses…” or “Here’s an explanation…”).  
   - Use previous run results or stored state (e.g. last query results, run stats) to make your answers more informative and contextual.  
   - If a previous relevance run exists, you can refer to its summary when answering follow-up questions.

IMPORTANT: Your goal is not just to retrieve results — but to help the user *reason about compliance and safety* as part of a larger engineering workflow.
"""

# ✅ Read Redis URL from env (e.g. REDIS_URL=redis://localhost:6379)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

async def build_agent_langgraph():
    """Build and compile the CS-25 agent with Redis-based short-term memory."""

    # 🧠 Use Redis for short-term memory (per-tab context)
    checkpointer = await AsyncRedisSaver.from_conn_string(REDIS_URL)
    # Optional: setup if this is the first run
    # await checkpointer.asetup()

    # 🤖 LLM
    gpt_5 = init_chat_model("gpt-5", model_provider="openai")

    # 🛠️ Tools
    tools = [cs25_relevance_tool, cs25_explain_tool]

    # 🧬 Create agent with ReAct pattern
    agent = create_react_agent(
        model=gpt_5,
        tools=tools,
        state_schema=AgentState,  # or DeepAgentState if we extend
        prompt=INSTRUCTIONS,
        checkpointer=checkpointer,
    )

    return agent.compile(checkpointer=checkpointer)


# ✅ Create a compiled instance we can import from router
# Note: Must be awaited during app startup or first use
agent_graph = None

async def get_agent_graph():
    global agent_graph
    if agent_graph is None:
        agent_graph = await build_agent_langgraph()
    return agent_graph


# 🧪 Example usage (optional test)
if __name__ == "__main__":
    import asyncio

    async def test():
        graph = await get_agent_graph()
        thread_id = "test-thread-1"
        result = await graph.ainvoke(
            {"messages": [{"role": "user", "content": "hi! I am Bob"}]},
            config={"configurable": {"thread_id": thread_id}},
        )
        print(result["messages"][-1]["content"])

    asyncio.run(test())