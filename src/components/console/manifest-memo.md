The manifest is at the heart of how your console system remembers and manages the connection between a console tab and a page — even across refreshes or different app sessions.

Let’s go step by step in plain English 👇

⸻

🧩 1. What the “manifest” really is

Think of the manifest as a passport for each console tab.

It contains all the official information needed to identify:
	•	Which page that tab is linked to
	•	What route (URL) it belongs to
	•	What it’s called (title)
	•	And any other metadata that helps your system know where this tab belongs and what it’s doing

So in your code, a manifest looks like this:
```ts
{
  tabId: "ai-fxag9j",
  route: "/test/console-test",
  pageId: "page-abc123",
  title: "Chat 1",
  flowId: "b5a7a1c2-154b-4d29-9521-79450b23079c"
}
```
It’s a little document that describes:

“This AI tab belongs to page /test/console-test with ID page-abc123.”

⸻

🧭 2. Why it’s called a “manifest”

The term manifest is borrowed from shipping and software — it means:

“A list of what exists, where it came from, and where it’s going.”

So, just like an airplane cargo manifest lists what’s loaded and its destination,
your console manifest lists which tabs exist, and which page each tab is linked to.

⸻

🔗 3. How the link works (Tab ↔ Page)

When you create a new AI tab or open a page, the system:
	1.	Checks the current route (e.g., /systems/thermal)
	2.	Checks if a tab already exists for that route
	3.	If not, it creates a new one and binds it to that page
	4.	Then it saves a manifest entry in Zustand so it’s remembered

That binding looks like this inside your store:

```
aiBindings = {
  "ai-fxag9j": {
    route: "/systems/thermal",
    pageId: "page-abc123",
    manifest: {
      tabId: "ai-fxag9j",
      route: "/systems/thermal",
      pageId: "page-abc123",
      title: "Chat 1",
      flowId: "b5a7a1c2-154b-4d29-9521-79450b23079c"
    }
  }
}
```
So anytime the page or tab sends a message,
the store knows exactly which pair should communicate.

⸻

💾 4. Why it’s saved in Zustand

Zustand is your app’s memory.
It’s where both temporary and persistent state lives.
	•	Things like chat messages or drafts are temporary — they reset each session.
	•	But manifests are persistent — they must survive across reloads and restarts.

So your code uses:
```
persist(createJSONStorage(() => localStorage))
```

to save manifests to localStorage (browser memory).
That means:
	•	You can reload the app, and it still remembers which tab belongs to which page.
	•	You can close and reopen the tab in your browser, and the links remain intact.

⸻

🔄 5. What happens when you change or close things

When you close a tab:

The manifest entry for that tab is deleted:
```
delete aiBindings["ai-fxag9j"]
```
When you rebind a tab to another page:

The manifest is updated:
```
manifest.pageId = "page-new789"
```
Zustand automatically saves this new version — so the next time you open your app, everything reconnects correctly.

⸻

⚙️ 6. Why it’s so useful

This manifest architecture gives you:
	•	✅ Persistence — your links survive refreshes
	•	✅ Isolation — each page has its own tab(s) and doesn’t mix up feeds
	•	✅ Traceability — you can always tell which tab is linked to which page
	•	✅ Extensibility — later, you can add more data (e.g., session info, thread IDs, active agents, etc.) without changing the core logic

You could, for instance, extend the manifest to include:
```
{
  ...,
  session: { threadId: "th123", runId: "r45" },
  cs25: { lastQuery: "hydrogen system leak" }
}
```
And now each AI tab could resume its last conversation with that page.

