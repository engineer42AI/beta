// src/app/(protected)/tests/ai-bus-test/page.tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAiChannel } from "@/components/console/bus/useAiChannel";

export default function AiBusTestPage() {
  const [text, setText] = useState("");
  const { pageId, route, boundTabId, activeAiTabId, send, feed } = useAiChannel();

  const short = (s?: string) => (s ? s.slice(0, 8) : "—");

  const handleSend = () => {
    if (!text.trim()) return;
    send({
      topic: "ui.prefill",
      payload: { text },
    });
    setText("");
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">AI Bus Test Page</h1>
        <p className="text-sm text-muted-foreground">
          route: <code>{route}</code> · pageId: <code>{short(pageId)}</code>
        </p>
      </header>

      {/* Console binding diagnostics */}
      <Card className="p-3 space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="font-medium">Active AI tab</div>
            <div>tabId: <code>{activeAiTabId ?? "—"}</code></div>
          </div>
          <div>
            <div className="font-medium">Bound tab (linked to this page)</div>
            <div>
              tabId:{" "}
              <code className={boundTabId ? "text-green-600" : "text-red-600"}>
                {boundTabId ?? "—"}
              </code>
            </div>
          </div>
        </div>
      </Card>

      {/* Page → Console (send message) */}
      <Card className="p-3 space-y-3">
        <div className="font-medium">Page → Console</div>
        <div className="flex gap-2">
          <Input
            placeholder="Enter text to send to AI console..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            onClick={handleSend}
            disabled={!boundTabId && !activeAiTabId}
          >
            Send
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Target tab:{" "}
          <code>{boundTabId ?? activeAiTabId ?? "none"}</code>
        </p>
      </Card>

      {/* Console → Page (feed display) */}
      <Card className="p-3">
        <div className="font-medium mb-2">Console → Page feed</div>
        {feed.length === 0 ? (
          <div className="text-sm text-muted-foreground">(no messages yet)</div>
        ) : (
          <ul className="space-y-2">
            {feed.map((msg) => (
              <li key={msg.id} className="text-sm">
                <span className="text-muted-foreground mr-2 tabular-nums">
                  {new Date(msg.ts).toLocaleTimeString()}
                </span>
                <span className="font-mono text-xs">
                  [{msg.topic ?? "—"}]
                </span>{" "}
                <span>{JSON.stringify(msg.payload)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}