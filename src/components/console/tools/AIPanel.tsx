// src/components/console/tools/AIPanel.tsx
"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useConsoleStore, type ChatMsg } from "@/stores/console-store";
import { cn } from "@/lib/utils";

export default function AIPanel() {
  // --- store selectors (tab-scoped) ---
  const activeTabId       = useConsoleStore(s => s.activeTabId.ai);
  const messages          = useConsoleStore(s => (activeTabId ? (s.aiMessages[activeTabId] ?? []) : []));
  const draft             = useConsoleStore(s => (activeTabId ? (s.aiDrafts[activeTabId] ?? "") : ""));
  const setDraft          = useConsoleStore(s => s.setDraft);
  const appendUser        = useConsoleStore(s => s.appendUser);
  const appendAssistant   = useConsoleStore(s => s.appendAssistant);
  const resetChat         = useConsoleStore(s => s.resetChat);
  const sendToPage        = useConsoleStore(s => s.sendToPage);
  const lastConsoleEvent  = useConsoleStore(s => s.lastConsoleEvent);
  const getBinding        = useConsoleStore(s => s.getBinding);

  // --- refs for layout/scroll ---
  const rootRef   = useRef<HTMLDivElement | null>(null);
  const listRef   = useRef<HTMLDivElement | null>(null);
  const inputRef  = useRef<HTMLDivElement | null>(null);

  // track last processed event timestamp per tab to avoid duplicates on tab switch
  const lastHandledByTab = useRef<Record<string, number>>({});

  // measure input height -> CSS var (--ai-input-h)
  useEffect(() => {
    const root = rootRef.current;
    const bar  = inputRef.current;
    if (!root || !bar) return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(bar.getBoundingClientRect().height);
      root.style.setProperty("--ai-input-h", `${h}px`);
    });
    ro.observe(bar);
    const h = Math.ceil(bar.getBoundingClientRect().height);
    root.style.setProperty("--ai-input-h", `${h}px`);
    return () => ro.disconnect();
  }, []);

  // auto-scroll whenever messages change
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages]);

  // page -> console (tab-scoped) into current tab
  useEffect(() => {
    if (!activeTabId || !lastConsoleEvent) return;
    if (lastConsoleEvent.tabId !== activeTabId) return;

    // ⬇️ de-dupe on timestamp per tab
    const prevTs = lastHandledByTab.current[activeTabId] ?? 0;
    if (lastConsoleEvent.ts <= prevTs) return;
    lastHandledByTab.current[activeTabId] = lastConsoleEvent.ts;

    const { type, payload } = lastConsoleEvent;

    if (type === "prefill_input" && typeof payload?.text === "string") {
      setDraft(activeTabId, payload.text);
      return;
    }
    if (type === "assistant_msg" && typeof payload?.text === "string") {
      appendAssistant(activeTabId, payload.text);
      return;
    }
    if (type === "user_msg" && typeof payload?.text === "string") {
      appendUser(activeTabId, payload.text);
      return;
    }
    if (type === "reset_chat") {
      resetChat(activeTabId);
      return;
    }
  }, [activeTabId, lastConsoleEvent, setDraft, appendAssistant, appendUser, resetChat]);

  const send = () => {
    if (!activeTabId) return;
    const q = (draft || "").trim();
    if (!q) return;

    appendUser(activeTabId, q);
    appendAssistant(activeTabId, "(MVP echo) " + q);
    setDraft(activeTabId, "");

    const binding = getBinding(activeTabId);
    if (binding) {
      sendToPage(activeTabId, { text: q });
    }
  };

  const binding = activeTabId ? getBinding(activeTabId) : undefined;

  return (
    <div
      ref={rootRef}
      className="relative h-full"
      style={{ ["--ai-input-h" as any]: "56px" }}
    >
      {/* Tiny header w/ binding hint */}
      <div className="absolute left-3 right-3 top-3 z-10 text-[11px] text-muted-foreground flex justify-between">
        <div className="truncate">
          tab: <code>{activeTabId ?? "—"}</code> · page: <code>{binding?.pageId?.slice(0,8) ?? "—"}</code> · route: <code>{binding?.route ?? "—"}</code>
        </div>
      </div>

      {/* Messages pane */}
      <div
        ref={listRef}
        className="absolute left-3 right-3 rounded border overflow-auto p-2"
        style={{
          top: "28px",
          bottom: `calc(var(--ai-input-h) + 12px + env(safe-area-inset-bottom, 0px))`,
          scrollbarGutter: "stable",
        }}
      >
        <div className="space-y-2">
          {(messages ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">Start a chat…</div>
          ) : (
            messages.map((m: ChatMsg, i: number) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={cn(
                    "inline-block max-w-[85%] break-words px-2 py-1 rounded",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  {m.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Input bar */}
      <div
        ref={inputRef}
        className="absolute left-3 right-3 bottom-3 flex gap-2"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <input
          className="flex-1 border rounded-md px-2 h-9 text-sm"
          placeholder="Type a prompt…"
          value={draft}
          onChange={(e) => activeTabId && setDraft(activeTabId, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <Button size="sm" onClick={send}>Send</Button>
      </div>
    </div>
  );
}