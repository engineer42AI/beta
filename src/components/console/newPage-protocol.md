🧭 Goal

Every new page in your app should automatically:
	•	connect to the console,
	•	link to its AI tab (so the right tab shows the right feed), and
	•	send/receive messages through the bus (envelopes).

You don’t want to rewrite logic every time — you just want a small, standard setup.

⸻
# Use a helper template for new pages

You can make a simple template ConsoleAwarePage.tsx:
```
"use client";

import { useAiChannel } from "@/components/console/bus";

export default function ConsoleAwarePage() {
  const {
    sendToAiConsole,
    feedFromAiConsole,
    boundAiTabId,
    isBoundToAiConsole,
    canSendToAiConsole,
  } = useAiChannel();

  return (
    <div className="p-6 space-y-3">
      <h1 className="text-lg font-semibold">Console-Aware Test Page</h1>
      <p>
        Status: {isBoundToAiConsole ? "✅ Bound" : "❌ Not bound"} <br />
        Target tab: <code>{boundAiTabId ?? "none"}</code>
      </p>

      <button
        disabled={!canSendToAiConsole}
        onClick={() => sendToAiConsole({ topic: "chat.user", payload: { text: "Hi" } })}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        Send to AI tab
      </button>

      <div className="text-sm mt-4">
        {feedFromAiConsole.map((m, i) => (
          <div key={m.id ?? i}>
            <code>{m.topic ?? "—"}</code>: {JSON.stringify(m.payload)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

🧠 What this gives you

✅ Two-way communication ready on every page
✅ Automatic tab ↔ page binding
✅ No manual setCurrentPageId calls
✅ One consistent message format (envelopes)
✅ Future-proof for Traces, Logs, or other console tools
