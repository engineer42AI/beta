backend/src/graphs/cs25_graph/
├─ utils.py                         # your existing ManifestGraph / GraphOps (keep here)
└─ agent_langgraph/
   ├─ __init__.py
   ├─ agent.py                      # public facade (get_graph, invoke/stream helpers)
   └─ utils/
      ├─ state.py                   # state schemas (MessagesState + small extras)
      ├─ tools.py                   # @tool functions (cs25_relevance, etc.)
      ├─ nodes.py                   # assistant node, ToolNode wiring (ReAct loop)
      ├─ runtime.py                 # Redis checkpointer/store setup, singletons
      ├─ bus.py                     # SSE/WebSocket event bus
      └─ selection_store.py         # thin wrapper around store.put/get (tab_id-based)



# 🧠 Recommended API split going forward (backend API ENDPOINTS)

1. agents.py – Agent metadata & utilities

This file stays mostly as you have it now. It’s responsible for:
	•	/api/agents/{name}/outline – ✅ stays - this loads the CS25 outline on the page
	•	/api/agents/{name}/run – (optional: keep if you still want a non-streaming run)
	•	/api/agents/{name}/stream – (optional: keep if you want direct graph streaming)

👉 These are agent utilities: they don’t depend on per-user session state or selections.

⸻

2. space.py – Session / workflow–oriented endpoints (new)

This is where we’ll add new endpoints for interactive, per-tab, per-user workflows:
	•	POST /api/{space}/context – Save user context (selected IDs, filters, metadata…)
	•	GET /api/{space}/context – Retrieve current context
	•	DELETE /api/{space}/context – Clear context
	•	POST /api/{space}/agents/react – Start a chat turn with the agent using that context
	•	GET /api/{space}/agents/stream – (optional) SSE/NDJSON stream version


💡 A common pattern is:
	1.	GET /api/agents/cs25/outline → to render table of contents
	2.	POST /api/cs25/context → to save user selections for a tab
	3.	POST /api/cs25/agents/react → to run relevance tool with that context
	4.	GET /api/cs25/context → to restore selections if the page reloads




# 1. Outline (unchanged)
Fetch static CS-25 outline (table of contents, structure, indices, etc.)

```
GET /api/cs25/outline
```

# 2. Save context 
Frontend sends all relevant info here before asking the agent to run:
```
POST /api/cs25/agent_langgraph/context
{
  "tab_id": "tab-42",
  "selected_ids": ["CS25.1309", "CS25.863"],
  "metadata": { "aircraft": "20PAX", "version": "PDR" }
}
```
Backend can store this context in:
	•	a short-term cache (Redis with TTL)
	•	or a simple in-memory dict keyed by tab_id (fine for MVP)

# 3. Run (non-streaming)

```
POST /api/cs25/agent_langgraph/run
{
  "tab_id": "tab-42",
  "query": "Which sections are relevant for lightning?",
  "model": "gpt-5-nano"
}
```
- Backend loads the context associated with tab_id (or uses data in this payload directly).
- Executes the LangGraph agent.
- Returns the full result as JSON.

# 4. Stream (streaming)
```
POST /api/cs25/agent_langgraph/stream
{
  "tab_id": "tab-42",
  "query": "Find relevance for cooling system hazards",
  "model": "gpt-5-nano"
}
```
- Same flow, but returns NDJSON chunks as they’re generated.
- Perfect for frontend consoles that render messages as they arrive.


💡 Why this is the best pattern:
	•	Everything related to your LangGraph-powered agent is namespaced together: agent_langgraph.
	•	You’ll later be able to add other capabilities like:
	•	/api/cs25/agent_langgraph/memory
	•	/api/cs25/agent_langgraph/tools
	•	/api/cs25/agent_langgraph/inspect
	•	It remains page-specific (cs25) and agent-specific (agent_langgraph).

💡 Key Design Principles
	•	Namespace grouping: All endpoints related to the agent are under /agent_langgraph/ for clarity and scalability.
	•	Page-specific: The cs25 prefix makes it clear these APIs belong to the CS-25 page.
	•	Future-proof: You can add other pages like /api/cs26/agent_langgraph/... without changing backend logic.
	•	Context-aware: context endpoint decouples selection data from chat requests — ideal for scaling and parallel tab handling.


# ################

