Console System – Architecture Memo

Last updated: Oct 2025

# What the console does

The bottom console is a persistent UI that:
	•	Hosts tools (AI chat, Logs, Traces, Tasks).
	•	Manages tabs per tool.
	•	Maintains a manifest “contract” linking each AI tab to exactly one page instance (by pageId) so messages can flow both ways (console → page and page → console).
	•	Emits concise logs about contracts and bus traffic (see the separate logging memo).

⸻

# File map (console-related)

src/
├─ stores/
│  └─ console-store.ts            ← Core state & logic for console, tabs, manifests, and buses
│
├─ components/
│  ├─ app-shell.tsx               ← Wires the console into the main layout, handles resizing & open/close
│  └─ console/
│     ├─ bottom-console.tsx       ← Visual shell (resizable bottom panel), renders tool surfaces
│     ├─ ConsolePanels.tsx        ← Chooses which tool panel to render based on active tool/tab
│     └─ tools/
│        └─ AIPanel.tsx           ← AI chat UI (per-tab messages/drafts, scrolling, send handler)
│
├─ components/log/
│  └─ LogPanel.tsx                ← The logs tool UI (table, filters, copy, autoscroll)
│
└─ app/(protected)/system-b/browse-cert-specs-V4/page.tsx
                                 ← Example page that participates in the contract & bus


# Console System — What each file is for (and how they fit)

# Big picture
	•	The console is a bottom panel that can show different tools (AI chat, Logs, etc.) and lets you open tabs for each tool.
	•	Every AI tab has a private “contract” (a manifest) that links that tab to one specific page instance via a pageId. That’s what makes reliable two-way messaging possible between the console and the page you’re looking at.
	•	We keep logs minimal and meaningful so you can prove the wiring is correct without drowning in noise.

⸻

# Files & roles (plain English)

## src/stores/console-store.ts

Role: The “brain” of the console.
What it owns:
	•	Which tool is open, which tabs exist, which tab is active.
	•	A per-AI-tab manifest (the “contract”) that says: “this AI tab is for route X and is linked to pageId Y.”
	•	Two tiny message buses:
	•	Console → Page (for sending chat input, etc.)
	•	Page → Console (for prefill, rendering bubbles, resets)
	•	A validator that spots broken contracts (e.g., tab bound to a different route than the page you’re on).

How it connects:
Everything else talks to this store. Tool UIs read from it; pages read and update the contract here; both sides use its buses to send messages.

⸻

## src/components/app-shell.tsx

Role: The frame of the app.
What it does:
	•	Places the bottom console under the main page using a split layout.
	•	Wires up resizing and the “console open/close” state.
	•	Passes the page title into the store (used as the default name for new AI tabs on that route).

How it connects:
It doesn’t know business logic — it’s just the container that shows the console and the current page at the same time.

⸻

## src/components/console/bottom-console.tsx

Role: The console’s chrome (tabs + surface).
What it does:
	•	Renders the tool bar and the tab strip.
	•	Shows the active tool panel in a content surface.
	•	Handles creating/closing/switching tabs visually.

How it connects:
Reads/writes tab state from console-store. Chooses which tool panel to show.

⸻

## src/components/console/ConsolePanels.tsx

Role: Simple router for tool panels.
What it does:
Given the active tool, renders the right panel (AIPanel, LogPanel, etc.). Nothing more.

How it connects:
Tiny switchboard that keeps the console clean.

⸻

## src/components/console/tools/AIPanel.tsx

Role: The AI chat experience inside the console.
What it does:
	•	Shows the chat messages for the currently active AI tab.
	•	Sends user input down to the page via the console→page bus.
	•	Listens for page→console events to prefill input or push bubbles.
	•	Uses a strict, absolute layout so messages always scroll inside the panel (they never overflow the console).

How it connects:
Reads per-tab chat slices and the active tab from console-store. Sends/receives bus messages via the store.

⸻

## src/components/log/LogPanel.tsx

Role: A simple, readable log viewer.
What it does:
	•	Displays the global logs as compact rows with level filters, search, and copy-row.
	•	Highlights the key workflows: contract created/switched and message delivered.

How it connects:
Reads entries from the logger store (src/lib/logger.ts). No business logic — just rendering and filters.

⸻

## src/lib/logger.ts (and optional src/stores/logger-store.ts if you split it)

Role: Centralized logging that the whole app can use.
What it does:
	•	Provides lightweight functions like logAction, logSystem, logWarn, logError.
	•	Coalesces duplicate events and stores them for the LogPanel.
	•	We log only what helps verify the contract and messaging (not every click).

How it connects:
console-store, pages, and panels call these helpers. The LogPanel reads from this store to visualize.

⸻

## src/app/(protected)/system-b/browse-cert-specs-V4/page.tsx

Role: A page that participates in the contract with AI tabs.
What it does:
	•	Figures out which AI tab “belongs” to this route (prefer the one you have selected if it matches the route; otherwise use the first for this route).
	•	Reads the tab’s manifest to get the pageId and tells the store “this pageId is currently on screen” so the console→page bus can route messages here.
	•	Only logs meaningful transitions:
	•	“Contract created” (tab first linked to this page).
	•	“Contract switched” (tab now linked to a different page instance).
	•	“Message arrived” (proof the bus delivered).
	•	Validates bindings and logs a single warning if something looks off.

How it connects:
This is the other end of the wire: it consumes the contract from console-store and participates in the two-way messaging.

⸻

The key workflow (tab → manifest → page)
	1.	Create AI tab
The console store creates a fresh pageId and seeds a manifest: the tab is now contractually linked to that page instance.
	2.	Navigate to the page (or focus it)
The page looks up “its tabs for this route,” picks the right tab, reads its pageId, and tells the store “I’m the active page for this pageId.”
Now console→page messages will land here.
	3.	Two-way messaging
	•	Console (AIPanel) → Page: sends input or commands to this tab’s page via the bus.
	•	Page → Console (AIPanel): sends UI events back (prefill, add bubbles, reset).
	4.	Switch tabs
The page notices the (tabId, pageId) pair changed and logs “contract switched.” The validator runs and warns if the tab is bound to another route than the current page.

⸻

Reading the logs (what to expect)
	•	User: “Created a new AI tab ‘X’ (linked to this page)” — when you add a tab.
	•	System: “Created the tab ↔ page link” — the manifest was seeded.
	•	System: “Switched which page this tab is linked to” — when you change the active tab or rebind.
	•	System: “Message from the console arrived at this page” — proof that console→page delivery is working.
	•	Warning: “Tab ↔ page links have problems” — run validator output to fix mismatches.

⸻

Why this shape works
	•	The manifest makes the relationship explicit (no guessing by route alone).
	•	The buses are tiny and scoped by tabId, so your messages don’t “leak” to the wrong page.
	•	The logs focus on a few truthy events that answer: “Are we linked?” and “Did messages arrive?” — nothing more.


