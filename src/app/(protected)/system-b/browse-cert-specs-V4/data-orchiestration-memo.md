# 🧩 page.tsx — the feature page
	•	This is the main user interface where the engineer interacts with data — for example, viewing outlines, ticking checkboxes, or inspecting tables.
	•	The page tracks what the user selects and stores it — typically in a Zustand store (so it persists across reloads, tab switches, and login changes).
	•	The page may also send selections directly to the orchestrator if the flow is simpler or doesn’t need persistence.
	•	The page never talks directly to the backend AI — it delegates that work to the orchestrator.
	•	As the orchestrator streams results, the page applies updates live, showing progress or adding rows as data arrives.

In plain terms:

“The page is where the user interacts. It knows what’s selected, saves it in a shared store (or sends it straight to the orchestrator), and updates its visuals as results stream in.”

⸻

# 💬 console_ai_view.tsx — the console’s AI tab for this page
	•	This is the AI interaction panel in the bottom console — the place where the user types prompts or clicks “Run.”
	•	It reads what’s selected (through the orchestrator or the shared store) so it always shows how many items are currently selected on the page.
	•	It starts and cancels runs by calling orchestrator methods like startRun() or cancelRun().
	•	It displays progress, token usage, and results summaries — but it doesn’t handle networking or data merging itself.
	•	The console’s layout can vary per page (e.g., a chat view, table view, or logs), but it always connects through the orchestrator.

In plain terms:

“The console is the control room for AI. It lets the user start or stop an AI run and shows progress, but all the heavy lifting happens elsewhere.”

⸻

# ⚙️ orchestrator.ts — the headless controller
	•	The orchestrator acts as the bridge between the UI and the backend AI agent.
	•	It manages all backend communication — starting runs, streaming responses, handling cancel signals, and error recovery.
	•	It listens for changes in selection, either:
	•	by subscribing to the Zustand store, or
	•	by receiving updates directly from the page.
	•	It maintains its own internal state for:
	•	which page/tab is active,
	•	what’s currently selected (with a hash to detect changes),
	•	the current AI run (status, progress, tokens, etc.),
	•	and a log of past runs.
	•	It dispatches streamed data to whoever needs it — typically the page for visual updates, and the console for progress feedback.

In plain terms:

“The orchestrator is the traffic controller. It listens for what’s selected, runs the AI in the background, streams the results, and tells both the page and console what’s happening.”

⸻

🔁 How it all flows
	1.	User makes selections on the page.
	•	The page saves those selections to the Zustand store.
	•	The orchestrator listens for these changes and updates its own snapshot automatically.
	•	(Or, in simpler pages, the page calls the orchestrator directly.)
	2.	User switches to the console’s AI tab.
	•	The console reads what’s currently selected and shows “X items selected.”
	•	It’s always in sync because it shares the same store or orchestrator data.
	3.	User hits “Run.”
	•	The console calls orchestrator.startRun({ prompt, model }).
	•	The orchestrator sends the request to the backend agent with the current selection snapshot.
	4.	Backend streams results.
	•	The orchestrator receives streaming messages (e.g., trace updates, token usage).
	•	It forwards them to the page (for visuals) and updates progress for the console.
	5.	User watches live updates.
	•	The page UI updates in real time.
	•	The console shows progress, costs, and completion status.
	6.	Run completes or is canceled.
	•	The orchestrator closes the stream and updates status.
	•	The page shows final data; the console shows run summary.

⸻

✅ Why this setup works
	•	Loose coupling: Each piece can evolve independently — new pages, new consoles, or new AI agents can plug in without rewriting the core logic.
	•	Flexible communication: The orchestrator can read from Zustand or the page — whichever suits the use case.
	•	Persistence: Zustand ensures selections and progress survive navigation or reloads.
	•	Streaming-friendly: Orchestrator is optimized for real-time updates to multiple listeners.
	•	Scalable: Adding new pages just means adding a new trio — page.tsx, console_ai_view.tsx, and orchestrator.ts — tailored to that page’s AI agent.