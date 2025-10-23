# backend/src/graphs/cs25_graph/agent_langgraph-test.py


from operator import add
from pydantic import BaseModel, Field
from typing import List, Optional
from collections import defaultdict


from langgraph.checkpoint.memory import MemorySaver
import openai
from dotenv import load_dotenv, find_dotenv
import os

from langchain_community.document_loaders import PyPDFLoader
import json
from langgraph.graph import StateGraph, END, START
from typing import TypedDict, Annotated

from langchain_openai import ChatOpenAI
from langgraph.graph.message import add_messages
from langchain_core.messages import SystemMessage, HumanMessage, RemoveMessage


class OverallState(TypedDict):
    messages: Annotated[list, add_messages]
    summary: str

class Agent:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.workflow = StateGraph(OverallState)
        self.workflow.add_node("conversation", self.call_model)
        self.workflow.add_node(self.summarize_conversation)

        # Set the entrypoint as conversation
        self.workflow.add_edge(START, "conversation")
        self.workflow.add_conditional_edges("conversation", self.should_continue)
        self.workflow.add_edge("summarize_conversation", END)

        # Compile
        self.memory = MemorySaver()
        self.graph = self.workflow.compile(checkpointer=self.memory)

        self.config = {"configurable": {"thread_id": "1"}}

    def call_model(self, state: OverallState):
        # Get summary if it exists
        summary = state.get("summary", "")

        client = ChatOpenAI(model="gpt-4o")

        # If there is summary, then we add it
        if summary:

            # Add summary to system message
            system_message = f"Summary of conversation earlier: {summary}"

            # Append summary to any newer messages
            messages = [SystemMessage(content=system_message)] + state["messages"]

        else:
            messages = state["messages"]

        response = client.invoke(messages)

        return {"messages": response}

    def summarize_conversation(self, state: OverallState):
        # First, we get any existing summary
        summary = state.get("summary", "")

        client = ChatOpenAI(model="gpt-4o")

        # Create our summarization prompt
        if summary:

            # A summary already exists
            summary_message = (
                f"This is summary of the conversation to date: {summary}\n\n"
                "Extend the summary by taking into account the new messages above:"
            )

        else:
            summary_message = "Create a summary of the conversation above:"

        # Add prompt to our history
        messages = state["messages"] + [HumanMessage(content=summary_message)]
        response = client.invoke(messages)

        # Delete all but the 2 most recent messages
        delete_messages = [RemoveMessage(id=m.id) for m in state["messages"][:-2]]
        return {"summary": response.content, "messages": delete_messages}

    def should_continue(self, state: OverallState):
        """Return the next node to execute."""

        messages = state["messages"]

        # If there are more than six messages, then we summarize the conversation
        if len(messages) > 6:
            return "summarize_conversation"

        # Otherwise we can just end
        return END

    def start_conversation(self, thread_id: str, input_message: str):
        """Begin or continue a conversation with memory."""
        config = {"configurable": {"thread_id": thread_id}}
        return self.graph.invoke({"messages": [HumanMessage(content=input_message)]}, config)

    def get_summary(self, thread_id: str):
        """Retrieve the current summary for a given conversation thread."""
        config = {"configurable": {"thread_id": thread_id}}
        return self.graph.get_state(config).values.get("summary", "")



agent = Agent()


response = agent.start_conversation(thread_id="2", input_message="Hi! I'm David")
print(response["messages"][-1].content)