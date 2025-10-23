# backend/src/graphs/cs25_graph/agent_langgraph/utils/nodes.py

from langgraph.graph import MessagesState
from src.graphs.cs25_graph.agent_langgraph.utils.tools.find_relevant_sections_tool import find_relevant_sections
from src.graphs.cs25_graph.agent_langgraph.utils.tools.explain_selected_sections_tool import explain_selected_sections
from src.graphs.cs25_graph.agent_langgraph.utils.tools.recommend_sections_tool import recommend_sections
from src.graphs.cs25_graph.agent_langgraph.utils.tools.think_tool import think_tool

from langgraph.types import Command

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_core.messages.utils import get_buffer_string
from src.graphs.cs25_graph.agent_langgraph.utils.state import AgentState

from langchain_openai import ChatOpenAI
import os
from langgraph.prebuilt import InjectedState, InjectedStore
from langgraph.store.base import BaseStore
from typing import Annotated
from io import StringIO
from contextlib import redirect_stdout
from typing import List
from langchain_core.messages import BaseMessage
def _filter_chat_only(msgs):
    return [m for m in msgs if isinstance(m, (HumanMessage, AIMessage, SystemMessage))]

def format_history_pretty(messages: List[BaseMessage]) -> str:
    """
    Use LangChain's built-in pretty_print() to render a clean, annotated
    transcript including tool calls/results, then return as a string.
    """
    buf = StringIO()
    with redirect_stdout(buf):
        for m in messages:
            m.pretty_print()  # prints Human/Ai/Tool blocks with args, call ids, etc.
    return buf.getvalue().strip()

def format_history_compact(messages: List[BaseMessage], include_tools: bool = True) -> str:
    lines = []
    for m in messages:
        if isinstance(m, HumanMessage):
            lines.append("=== Human ===")
            lines.append(m.content)

        elif isinstance(m, AIMessage):
            # Tool calls (only if include_tools=True)
            if include_tools and m.tool_calls:
                lines.append("=== AI (Tool Calls) ===")
                for tc in m.tool_calls:
                    lines.append(f"- {tc['name']} (id: {tc['id']})")
                    if args := tc.get("args"):
                        for k, v in args.items():
                            lines.append(f"  {k}: {v}")

            # AI message content
            if m.content:
                lines.append("=== AI ===")
                lines.append(str(m.content))

        elif isinstance(m, ToolMessage):
            if include_tools:
                lines.append(f"=== Tool: {getattr(m, 'name', 'tool')} ===")
                if getattr(m, "tool_call_id", None):
                    lines.append(f"(call_id: {m.tool_call_id})")
                lines.append(str(m.content))

        else:
            # System or other message types
            lines.append(f"=== {m.type.upper()} ===")
            lines.append(str(m.content))

    return "\n".join(lines)

async def tool_calling_llm(
        state: AgentState,
        store: BaseStore,
        ):

    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set")

    llm = ChatOpenAI(model="gpt-4o", api_key=OPENAI_API_KEY)

    llm_with_tools = llm.bind_tools([explain_selected_sections, find_relevant_sections])
    # ✅ Clean, nicely formatted message history
    history_text = get_buffer_string(
        _filter_chat_only(state["messages"]),
        human_prefix="User",
        ai_prefix="Assistant",
    )

    message_history = format_history_pretty(state["messages"])

    tab_id = state.get("tab_id", "") or ""
    # Async store read (requires graph compiled with an AsyncRedisStore)
    item = await store.aget(("cs25_context", tab_id), "latest")
    ctx = item.value if item and hasattr(item, "value") else {}
    selected_ids = ctx.get("selected_ids", [])
    selected_count = len(selected_ids)

    prompt = f"""
You are E42, an expert helper for CS-25 certification.

CONTEXT:
- The user has a current selection of CS-25 sections on the page above (current count: {selected_count}).  
- Your capabilities operate on that selection and stream full results to the page above. In chat, you provide only short confirmations, summaries, or guidance — never the full results.

SELECTION GUARD:
- If current selection count is 0 (current count: {selected_count}): you must immediately stop. Do not attempt to answer the question. \
Do not continue the conversation. Do not call any tools. Only reply with one short sentence: “Please check the page above and select the CS-25 sections you want to work with before we continue.”

CONDUCT:
- Be brief (≤3 short sentences).
- Use the full HISTORY to keep the latest user goal. If the last user message is only an acknowledgment (“ok”, “done”, “made my selection”), continue the most recent unresolved goal from HISTORY.
- Call at most one tool per turn. Speak as if you are doing the action; never name tools.
- Full results stream on the page above. In chat, give only a short confirmation, summary, or next step.

TOOL POLICY (binary, exclusive):
- find_relevant_sections (FIND): Use when the user wants to find/locate/list/identify which CS-25 sections are relevant to a topic (discovery).
- explain_selected_sections (EXPLAIN): Use when the user wants to explain/clarify/compare/derive requirements/intent/checklists for sections or a narrowed topic (explanation).

CONFLICT RULES:
- If intent is ambiguous, default to FIND.
- After an acknowledgment following a FIND request, run FIND again using the earlier topic from HISTORY.
- Never use EXPLAIN to discover relevant sections.

OUTPUT STYLE (conversational, not prescriptive):
- Acknowledge the user’s goal in plain language, then point to results “on the page above.”
- After you run a tool, optionally suggest one helpful refinement. Keep it friendly and optional.

Examples (non-prescriptive):
- After FIND tool: “I’ve pulled the most relevant CS-25 sections for **topic**—you’ll see the ranked list on the page above.”
- After FIND tool: “Okay, I ran the search for **topic**. Check the page above for the ranked sections.”
- After EXPLAIN tool: “Here’s the interpretation for **topic**—details are on the page above.”
- After EXPLAIN tool: “I’ve outlined what **topic** implies for compliance. Review the breakdown on the page above.”

HISTORY:
{message_history}
"""


    return {"messages": [llm_with_tools.invoke(prompt)]}


import random
from typing import Literal


async def UI_decide_node(state: AgentState, store: BaseStore) -> Literal["main", "recommend"]:

    tab_id = state.get("tab_id", "") or ""
    # Async store read (requires graph compiled with an AsyncRedisStore)
    item = await store.aget(("cs25_context", tab_id), "latest")
    ctx = item.value if item and hasattr(item, "value") else {}
    selected_ids = ctx.get("selected_ids", [])
    selected_count = len(selected_ids)

    if selected_count > 0:
        return "main"

    return "recommend"



async def recommend_sections_llm(
        state: AgentState,
        store: BaseStore,
        ):

    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set")

    llm = ChatOpenAI(model="gpt-4o", api_key=OPENAI_API_KEY)

    llm_with_tools = llm.bind_tools([recommend_sections, think_tool])
    # ✅ Clean, nicely formatted message history
    history_text = get_buffer_string(
        _filter_chat_only(state["messages"]),
        human_prefix="User",
        ai_prefix="Assistant",
    )

    # message_history = format_history_pretty(state["messages"])
    message_history = format_history_compact(state["messages"], include_tools=True)

    tab_id = state.get("tab_id", "") or ""
    # Async store read (requires graph compiled with an AsyncRedisStore)
    item = await store.aget(("cs25_context", tab_id), "latest")
    ctx = item.value if item and hasattr(item, "value") else {}
    selected_ids = ctx.get("selected_ids", [])
    selected_count = {len(selected_ids)}

    topic = state["topic"]

    prompt_for_llm_with_tools = f"""
You are a CS-25 aircraft certification engineer chatting with the user about the current topic.

Tools:
- recommend_sections(topic): returns likely CS-25 sections/subparts.
- think_tool(note): private reflection after any tool call (never reveal).

Core rules:
1) Answer-first, briefly. Default to 1–2 sentences unless the user asks for detail.
2) Never invent CS-25 sections. Only mention sections that appear in the current conversation and that came from recommend_sections for this topic.
3) Tool gating:
   - If history already contains recommended sections for this topic, DO NOT call recommend_sections again.
   - Otherwise call recommend_sections once for this topic, then think_tool, and use those results going forward.
4) Acknowledgments/back-channels (e.g., “ok”, “I see”, “got it”, “thanks”, “👍”):
   - Do NOT restate or re-list sections.
   - Reply with a single line such as: “Noted. Please select the relevant CS-25 sections on the page—chat suggestions are approximate until you confirm.”
5) Nudge frequency:
   - Include the one-line nudge above after the FIRST time you present recommendations.
   - If that exact nudge already appears in your last 3 assistant messages, don’t repeat it.
6) Listing:
   - When the user explicitly asks “which sections” (or similar), list at most the top 3–5 sections already in history for this topic.
7) Topic change:
   - If the topic materially changes from what is shown at the top of history, say “New topic—updating recommendations…” and call recommend_sections once, then proceed.

TOPIC:
{topic}

HISTORY
{message_history}
"""
    prompt_for_llm = f"""
Your name is E42.
You are a CS-25 aircraft certification engineer chatting with the user about the current topic.

APP CONTEXT
- You’re chatting inside a web app where the user must select CS-25 items on the page above.
- The reason you are being engaged right now is becasue the user made zero selections. 

TASK
- Engage briefly and keep redirecting the user to make selections on the page above.
- Do not recommend specific sections or paragraphs. Do not analyze CS-25 content here.

BEHAVIOR
- Use the HISTORY to reason about the user’s topic.
- Reply in ≤2 short sentences (max 3 if the user resists).
- Always include a clear call to action to make selections on the page above.
- If the user resists (e.g., “just tell me,” “why do I need selections?”), give 1 sentence on benefits (accuracy, focus, auditability) and offer help (“Want a 20-second walkthrough?”).
- If the user is confused, give one-line UI guidance (e.g., “expand a subpart and tick the sections relevant to your topic”).
- Never mention tools, never output section IDs, and never summarize regulations.

STYLE
- Friendly, concise, action-oriented. No long explanations.

INPUTS
TOPIC:
{topic}

HISTORY:
{message_history}
"""


    return {"messages": [llm.invoke(prompt_for_llm)]}



async def topic_llm(
        state: AgentState,
        store: BaseStore,
        ):

    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set")

    llm = ChatOpenAI(model="gpt-4o", api_key=OPENAI_API_KEY)

    # ✅ Clean, nicely formatted message history
    history_text = get_buffer_string(
        _filter_chat_only(state["messages"]),
        human_prefix="User",
        ai_prefix="Assistant",
    )

    message_history = format_history_pretty(state["messages"])

    tab_id = state.get("tab_id", "") or ""
    # Async store read (requires graph compiled with an AsyncRedisStore)
    item = await store.aget(("cs25_context", tab_id), "latest")
    ctx = item.value if item and hasattr(item, "value") else {}
    selected_ids = ctx.get("selected_ids", [])
    selected_count = {len(selected_ids)}

    # TODO - what may work nicely here is if we didnt pass full message history here. Instead we would
    #  pass only user messages. But have an AI earlier before this node to infere whether user message is linked to
    #  any earlier AI or tool response. That way we would extract the specific user action and what prompted the
    #  user to act. This precision would greatly help in our Topic AI understanding the user intent.

    # TODO - another improvement is that we would want the Topic AI to also follow up with 'questions' -
    #  so based on the understanding of the topic return a question that may improve quality of the topic itself.

    prompt = f"""
You are a EASA expert in CS-25 aircraft certification and regulatory interpretation.  
Your task is to build a self contained topic from the user conversation history that will be used to analyse the CS25 document later. 

Purpose
- Read the full conversation HISTORY (user + assistant + tool messages) and produce ONE compact, enriched topic string that captures the user’s *current* goal.
- This topic will be passed to a separate decision node. Do NOT decide which tool to call and do NOT generate chat text.

How to infer the topic
- Use the entire HISTORY to recover the latest unresolved goal. If the latest user message is only an acknowledgement (“ok”, “done”, “made my selection”, “proceed”, “yes”), keep the most recent coherent topic from earlier messages.
- User is the source of truth: Only USER messages may set or change the topic; ignore assistant suggestions unless the USER explicitly accepts/repeats/acts on them.
- Reg-neutral topic: Do not add regulation IDs, subparts, or regulatory categories - you MUST avoid this bias.  
- Treat tool messages as context (they may indicate what was already searched/explained). Use them to refine the topic, but do not summarize their results.
- If the user refines or narrows the subject (e.g., “leaks” → “header leaks”), prefer the *newest* narrowed focus.

Topic enrichment (CS-25 aware)
- Maximise completeness from HISTORY when available. Include, as applicable:
  • Component/subject (e.g., heat exchanger)  
  • Function/intent (e.g., cooling LTPEM stack)  
  • Context/domain (e.g., ATA/system, installation vs operation vs maintenance, location on aircraft)  
  • Operating conditions (e.g., icing, vibration, flammable fluid proximity)  
  • Safety/compliance angle (e.g., 25.1309, 25.863, fire protection, continued airworthiness)  
  • Lifecycle activity (e.g., design, test, inspection, reliability/maintenance)
- Prefer specificity over generality if the HISTORY supports it.

Formatting rules for "topic"
- Keep ≤160 characters.
- Use a clear head term + qualifiers, e.g.: "heat exchanger header leaks — fire protection (25.863), flammable fluid lines, inspection/continued airworthiness"
- Use an em dash (—) or colon to separate head term from qualifiers; commas between qualifiers.
- Do not include quotes, sentences, or filler words.

Failure handling
- If HISTORY is too vague to form a meaningful topic, produce the best-available subject with high-level qualifiers (e.g., “heat exchanger — general applicability”).
- Never output empty topic.

HISTORY OF CONVERSATION:  
{message_history}  
"""
    llm_response = llm.invoke(prompt)

    #return {"messages": [llm_response], "topic": llm_response.content}

    return Command(update={"topic": llm_response.content})