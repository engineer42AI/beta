// src/app/(protected)/system-b/browse-cert-specs-v4/console_ai_view.tsx
"use client";

import { useAiConsoleChannel } from "@/components/console/bus";

export default function ConsoleAiView() {
  const {
    // status
    activeAiTabId,
    isLinkedToPage,
    binding,
    // actions
    sendToPage,
    // data
    feedFromPage,
  } = useAiConsoleChannel();

  return (
    <div className="p-6 space-y-3">
      <h1 className="text-lg font-semibold">AI Console View</h1>

      <p className="text-sm">
        Linked: {isLinkedToPage ? "✅ Yes" : "❌ No"} <br />
        Tab: <code>{activeAiTabId ?? "none"}</code> <br />
        Route: <code>{binding?.route ?? "—"}</code>
      </p>

      <button
        disabled={!isLinkedToPage}
        onClick={() => sendToPage("chat.user", { text: "Hi from console view 👋" })}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        Send to page
      </button>

      <div className="text-sm mt-4">
        {feedFromPage.length === 0 ? (
          <div className="text-muted-foreground">(no messages yet)</div>
        ) : (
          feedFromPage.map((m, i) => (
            <div key={m.id ?? i}>
              <code>{m.topic ?? "—"}</code>: {JSON.stringify(m.payload)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}