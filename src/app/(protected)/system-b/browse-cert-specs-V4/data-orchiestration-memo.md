🧩 page.tsx — the feature page (UI & state origin)
	•	This is the main user interface where engineers interact — selecting data, ticking checkboxes, viewing tables, or inspecting results.
	•	The page no longer needs to know how the AI run works — it only cares about what’s selected and what state the UI should reflect.
	•	User selections are stored in a Zustand store or passed directly to the orchestrator. This ensures selections persist across tab switches, reloads, or login changes.
	•	The page does not talk to the backend or AI directly. Instead, it communicates with the orchestrator through defined contracts.
	•	As the orchestrator streams results, the page listens and updates itself incrementally — e.g. adding rows, updating outlines, or refreshing visual components.

👉 In plain terms:
“The page is where the user interacts. It records selections, listens for orchestrator updates, and updates visuals in real time — but never deals with AI calls directly.”

⸻

💬 console_ai_view.tsx — the AI tab (control surface)
	•	The console is the control room for a page’s AI workflows. It’s where the user clicks Run, cancels a process, or inspects live logs and results.
	•	It reads selection state from the orchestrator or shared store so it always knows the current context (e.g., how many items are selected).
	•	It never handles network calls or streaming directly — all orchestration is delegated to the backend controller.
	•	Its job is to initiate, monitor, and display: it starts runs, shows status, token usage, and summaries, and allows cancellations.
	•	The UI can vary per page (chat, table, tree, etc.), but all consoles use the same orchestrator contract to stay consistent.

👉 In plain terms:
“The console is the command center. It starts or stops AI workflows and shows progress, but never does the heavy lifting itself.”

⸻

⚙️ lib/pageOrchestrator.ts — the headless controller
	•	The orchestrator is now a shared library module that acts as the traffic controller for all pages.
	•	It owns all backend communication: starting runs, streaming results, sending cancellations, retrying, and handling errors.
	•	It subscribes to the page’s selections and context (from Zustand or direct calls) and builds a “snapshot” of the current state before execution.
	•	It manages internal state for:
	•	Which page and tab are active
	•	Current selection hash (to detect changes)
	•	Run status, progress, token usage
	•	Logs, errors, and wire messages
	•	It emits structured updates (called page contracts) that define what data the page or console should expect. These are typed interfaces that make sure the UI, orchestrator, and backend all speak the same language.

👉 In plain terms:
“The orchestrator is the brain. It runs AI workflows in the background, manages state, and streams updates to the page and console in a structured way.”

⸻

📜 Page Contracts — shared language between UI & orchestrator
	•	Page contracts define the shape of data exchanged between the page, orchestrator, and backend.
	•	Each contract declares:
	•	What input the orchestrator expects from the page (e.g. selected items, filters, context)
	•	What events and payloads it will emit (e.g. progress updates, partial results, errors)
	•	What final results look like once the run completes
	•	These contracts mean every page follows a predictable pattern — reducing coupling and ensuring new workflows can be added without breaking others.
	•	They also make debugging easier: wire logs and dev tools use these contracts to group and display events clearly.

👉 In plain terms:
“Contracts are the shared vocabulary between the UI and orchestrator. They guarantee that both sides know what to expect and how to interpret streamed data.”

⸻

🔁 How the flow works
	1.	User interacts with the page
	•	Selections and context are stored in Zustand or passed directly.
	•	The orchestrator subscribes to these changes and updates its internal snapshot.
	2.	Console initiates a run
	•	The user clicks Run.
	•	The console calls orchestrator.startRun() with the current selection and prompt.
	3.	Orchestrator executes the workflow
	•	It sends a request to the backend, following the page contract specification.
	•	It listens to the response stream and transforms backend events into structured updates.
	4.	Backend streams results
	•	As results arrive, the orchestrator dispatches them to both the page (for visual updates) and the console (for progress, logs, and usage).
	5.	UI updates live
	•	The page incrementally updates tables, outlines, or visual elements.
	•	The console shows logs, costs, and completion state.
	6.	Run completes or is canceled
	•	The orchestrator updates the final state.
	•	The page renders final data; the console shows a summary and archived log.

⸻

✅ Why this architecture works
	•	Shared vocabulary: Page contracts ensure UI and backend stay aligned and predictable.
	•	Loose coupling: Pages, consoles, and orchestrator evolve independently without breaking each other.
	•	Reusability: The orchestrator in lib/ can support multiple pages without duplication.
	•	Observability: Centralized orchestration makes streaming, debugging, and logging consistent.
	•	Scalability: Adding a new workflow is as simple as creating a page, defining its contract, and wiring it into the orchestrator.

⸻

📁 Relevant Files
	•	src/app/(protected)/system-b/.../page.tsx — UI and selection logic
	•	src/app/(protected)/system-b/.../console_ai_view.tsx — AI tab and run controls
	•	src/lib/pageOrchestrator.ts — headless orchestrator and runtime logic
	•	src/lib/contracts/<page>.ts — page-specific data contracts (input/output/event types)