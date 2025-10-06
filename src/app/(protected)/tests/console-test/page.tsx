// src/app/(protected)/tests/console-test/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useConsoleStore } from "@/stores/console-store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const makeId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

export default function BrowseCertSpecSpecV4BindingTestPage() {
  const pathname = usePathname() || "/";

  // Store selectors
  const setCurrentPageId = useConsoleStore((s) => s.setCurrentPageId);
  const activeAiTabId    = useConsoleStore((s) => s.activeTabId.ai);
  const aiBindings       = useConsoleStore((s) => s.aiBindings);
  const rebindTabToPage  = useConsoleStore((s) => s.rebindTabToPage);
  const sendToConsole    = useConsoleStore((s) => s.sendToConsole);
  const lastMessage      = useConsoleStore((s) => s.lastMessage);

  // Stable page instance id for this page component
  const pageInstanceIdRef = useRef<string>(makeId());
  const pageId = pageInstanceIdRef.current;

  // Register this page id with the store so buses know where to deliver
  useEffect(() => {
    setCurrentPageId(pageId);
    return () => setCurrentPageId(undefined);
  }, [pageId, setCurrentPageId]);

  // Current active tab's binding (if any)
  const activeBinding = activeAiTabId ? aiBindings[activeAiTabId] : undefined;

  // Simple status flags for clarity
  const isActiveTabForThisRoute = activeBinding?.route === pathname;
  const isActiveTabLinkedHere   = isActiveTabForThisRoute && activeBinding?.pageId === pageId;

  // Auto-link: whenever the active tab belongs to this route but isn't linked to THIS page, fix it
  useEffect(() => {
    if (!activeAiTabId) return;
    const b = aiBindings[activeAiTabId];
    if (!b) return;
    if (b.route !== pathname) return;   // active tab is for a different route
    if (b.pageId === pageId) return;    // already linked to THIS page
    rebindTabToPage(activeAiTabId, pageId);
  }, [activeAiTabId, aiBindings, pathname, pageId, rebindTabToPage]);

  // Derive the *currently bound* tab for THIS page (not just "active tab")
  const boundTabId = useMemo(() => {
    // 1) Prefer the active tab if it’s for this route AND already linked to THIS page
    if (activeAiTabId) {
      const ab = aiBindings[activeAiTabId];
      if (ab && ab.route === pathname && ab.pageId === pageId) {
        return activeAiTabId;
      }
    }
    // 2) Otherwise, pick any tab that’s linked to THIS page for THIS route
    for (const [tid, bind] of Object.entries(aiBindings)) {
      if (bind.route === pathname && bind.pageId === pageId) return tid;
    }
    return undefined;
  }, [activeAiTabId, aiBindings, pathname, pageId]);

  // Manual force-link (handy for testing)
  const forceLink = () => {
    if (!activeAiTabId) return;
    const b = aiBindings[activeAiTabId];
    if (!b || b.route !== pathname) return;
    rebindTabToPage(activeAiTabId, pageId);
  };

  // ------- Page -> Console push test (unchanged) -------
  const [prefillText, setPrefillText] = useState("");

  // Sends to the *currently bound* tab; if not bound but active tab is for this route, bind then send (once).
  const safeSend = (type: string, payload: any) => {
    const targetNow = boundTabId;
    if (targetNow) {
      sendToConsole(targetNow, type, payload);
      return;
    }
    // If there is an active tab for this route but it's not yet linked to THIS page, link then send once.
    if (activeAiTabId && isActiveTabForThisRoute) {
      rebindTabToPage(activeAiTabId, pageId);
      // microtask ensures React state settles; then send to the newly-bound tab id
      queueMicrotask(() => {
        // Re-read bound tab after rebind
        const latest = Object.entries(aiBindings).find(([, b]) => b.pageId === pageId && b.route === pathname)?.[0];
        const target = latest ?? activeAiTabId;
        if (target) sendToConsole(target, type, payload);
      });
      return;
    }
    // Otherwise, nothing to send to (no tab for this route yet)
  };

  // ---------------- Pull test: Console -> Page (UPDATED) ----------------
  type PullEntry = { ts: number; text: string };

  // Keep a separate feed per tab so messages don't bleed across tabs
  const [pullByTab, setPullByTab] = useState<Record<string, PullEntry[]>>({});
  // De-dup across tab switches: remember which (ts,tabId) we've appended
  const processedKeysRef = useRef<Set<string>>(new Set());

  // Only append messages for the *currently bound* tab, and only once.
  useEffect(() => {
    if (!lastMessage) return;
    if (!boundTabId) return;
    if (lastMessage.tabId !== boundTabId) return;
    if (lastMessage.type !== "ai_message") return;

    const key = `${lastMessage.ts}:${lastMessage.tabId}`;
    if (processedKeysRef.current.has(key)) return; // already shown
    processedKeysRef.current.add(key);

    const text =
      typeof lastMessage.payload?.text === "string"
        ? lastMessage.payload.text
        : JSON.stringify(lastMessage.payload ?? {});

    setPullByTab((prev) => {
      const prevForTab = prev[boundTabId] ?? [];
      return { ...prev, [boundTabId]: [...prevForTab, { ts: lastMessage.ts, text }] };
    });
  }, [lastMessage, boundTabId]);

  const currentPullFeed: PullEntry[] = boundTabId ? (pullByTab[boundTabId] ?? []) : [];

  const short = (s?: string) => (s ? s.slice(0, 8) : "—");

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Binding + Push/Pull Test — V4</h1>
        <p className="text-sm text-muted-foreground">
          route: <code className="text-xs">{pathname}</code> · page:{" "}
          <code className="text-xs">{short(pageId)}</code>
        </p>
        <p className="text-xs text-muted-foreground">
          This page auto-links itself to the <em>active</em> AI tab for this route. Use the button below to force it manually if needed.
        </p>
      </header>

      {/* Binding diagnostics (unchanged) */}
      <Card className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <div className="font-medium">Active AI tab</div>
            <div>tabId: <code>{activeAiTabId ?? "—"}</code></div>
            <div>tab route: <code>{activeBinding?.route ?? "—"}</code></div>
            <div>tab→pageId: <code>{short(activeBinding?.pageId)}</code></div>
            <div>
              route match?{" "}
              <span className={isActiveTabForThisRoute ? "text-green-600" : "text-red-600"}>
                {isActiveTabForThisRoute ? "yes" : "no"}
              </span>
            </div>
            <div>
              linked to THIS page?{" "}
              <span className={isActiveTabLinkedHere ? "text-green-600" : "text-red-600"}>
                {isActiveTabLinkedHere ? "yes" : "no"}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="font-medium">Currently bound tab for THIS page</div>
            <div>tabId: <code>{boundTabId ?? "—"}</code></div>
            <div>
              status:{" "}
              <span className={boundTabId ? "text-green-600" : "text-red-600"}>
                {boundTabId ? "bound" : "none"}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={forceLink}
            disabled={!activeAiTabId || !isActiveTabForThisRoute}
            title={!activeAiTabId ? "No active AI tab" : !isActiveTabForThisRoute ? "Active tab is for a different page" : "Link active tab to this page"}
          >
            Link active AI tab to THIS page
          </Button>
        </div>
      </Card>

      {/* Pull test (scoped per tab, de-duped) */}
      <Card className="p-3">
        <div className="font-medium mb-2">Console → Page (bound tab)</div>
        {!boundTabId ? (
          <div className="text-sm text-muted-foreground">No bound tab yet. Select a tab for this route.</div>
        ) : currentPullFeed.length === 0 ? (
          <div className="text-sm text-muted-foreground">(no messages yet)</div>
        ) : (
          <ul className="space-y-2">
            {currentPullFeed.map((f, i) => (
              <li key={f.ts + "-" + i} className="text-sm">
                <span className="text-muted-foreground mr-2 tabular-nums">
                  {new Date(f.ts).toLocaleTimeString()}
                </span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Push test (unchanged) */}
      <Card className="p-3 space-y-3">
        <div className="font-medium">Page → Console (bound tab)</div>

        <div className="flex gap-2">
          <Input
            placeholder="Type text to prefill input in console…"
            value={prefillText}
            onChange={(e) => setPrefillText(e.target.value)}
          />
          <Button
            onClick={() => safeSend("prefill_input", { text: prefillText })}
            disabled={!boundTabId && !(activeAiTabId && isActiveTabForThisRoute)}
          >
            Prefill input
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => safeSend("assistant_msg", { text: "Hello from the page 👋" })}
            disabled={!boundTabId && !(activeAiTabId && isActiveTabForThisRoute)}
          >
            Push assistant bubble
          </Button>
          <Button
            variant="outline"
            onClick={() => safeSend("user_msg", { text: "User said hi (from page)" })}
            disabled={!boundTabId && !(activeAiTabId && isActiveTabForThisRoute)}
          >
            Push user bubble
          </Button>
          <Button
            variant="destructive"
            onClick={() => safeSend("reset_chat", {})}
            disabled={!boundTabId && !(activeAiTabId && isActiveTabForThisRoute)}
          >
            Reset chat
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Target tab: <code>{boundTabId ?? (isActiveTabForThisRoute ? `${activeAiTabId} (will auto-link)` : "—")}</code>
        </p>
      </Card>
    </div>
  );
}