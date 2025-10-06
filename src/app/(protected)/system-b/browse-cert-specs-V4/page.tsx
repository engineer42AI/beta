// src/app/(protected)/system-b/browse-cert-specs-V4/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { logSystem, logAction, logWarn } from "@/lib/logger";
import { useConsoleStore, validateConsoleBindings } from "@/stores/console-store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function BrowseCertSpecV4Page() {
  const pathname = usePathname() || "/";

  // ---- store hooks
  const setCurrentPageId = useConsoleStore((s) => s.setCurrentPageId);
  const activeAiTabId    = useConsoleStore((s) => s.activeTabId.ai);
  const getBinding       = useConsoleStore((s) => s.getBinding);
  const findTabsByRoute  = useConsoleStore((s) => s.findTabsByRoute);

  const sendToConsole    = useConsoleStore((s) => s.sendToConsole);
  const lastMessage      = useConsoleStore((s) => s.lastMessage);

  // Snapshot (for validator)
  const storeSnapshot    = useConsoleStore((s) => s);

  // ---- which tabs are for this route?
  const routeTabs = useMemo(() => findTabsByRoute(pathname), [findTabsByRoute, pathname]);

  // Prefer the current active AI tab if it belongs to this route; else first tab on this route
  const preferredTabForRoute = useMemo(() => {
    if (activeAiTabId) {
      const b = getBinding(activeAiTabId);
      if (b?.route === pathname) return activeAiTabId;
    }
    return routeTabs[0];
  }, [activeAiTabId, getBinding, pathname, routeTabs]);

  // The pageId we want THIS page instance to represent now
  const activePageId = useMemo(() => {
    if (!preferredTabForRoute) return undefined;
    const b = getBinding(preferredTabForRoute);
    return b?.route === pathname ? b.pageId : undefined;
  }, [preferredTabForRoute, getBinding, pathname]);

  // Tell the store which page is active (enables console→page routing)
  useEffect(() => {
    setCurrentPageId(activePageId);
    return () => setCurrentPageId(undefined);
  }, [activePageId, setCurrentPageId]);

  // Which tab is bound to OUR current pageId?
  const boundTabId = useMemo(() => {
    if (!activePageId) return undefined;
    for (const tid of routeTabs) {
      const b = getBinding(tid);
      if (b?.route === pathname && b.pageId === activePageId) return tid;
    }
    return undefined;
  }, [activePageId, routeTabs, getBinding, pathname]);

  // Current flowId (if any) from the manifest of the bound tab
  const currentFlowId = useMemo(() => {
    if (!boundTabId) return undefined;
    return getBinding(boundTabId)?.manifest?.flowId;
  }, [boundTabId, getBinding]);

  // ---- Log only meaningful contract transitions (established / switched)
  const prevContractRef = useRef<{ tabId?: string; pageId?: string } | null>(null);
  useEffect(() => {
    const prev = prevContractRef.current;
    const now = { tabId: boundTabId, pageId: activePageId };

    if (!now.tabId || !now.pageId) return; // nothing to report yet

    const changed = prev?.tabId !== now.tabId || prev?.pageId !== now.pageId;
    if (changed) {
      const manifest = getBinding(now.tabId)?.manifest;
      const title = manifest?.title ?? "Untitled";
      const kind = prev?.tabId ? "contract:switched" : "contract:established";

      logSystem(
        kind,
        { route: pathname, tabId: now.tabId, pageId: now.pageId, title, flowId: manifest?.flowId },
        "page/v4",
        prev?.tabId
          ? "System: switched which page this tab is linked to"
          : "System: created the link between this tab and this page"
      );

      prevContractRef.current = now;

      // Validate bindings only when contract changes
      const report = validateConsoleBindings(storeSnapshot as any);
      if (!report.ok) {
        logWarn(
          "bindings:issues",
          { route: pathname, issues: report.issues },
          "console/validate",
          "Warning: tab ↔ page links have problems"
        );
      }
    }
  }, [boundTabId, activePageId, pathname, getBinding, storeSnapshot]);

  // ---- Console → Page feed (strictly tab-scoped)
  const [feed, setFeed] = useState<{ ts: number; text: string }[]>([]);
  useEffect(() => {
    if (!lastMessage) return;
    if (!boundTabId || lastMessage.tabId !== boundTabId) return;
    if (lastMessage.type !== "ai_message") return;

    // Proof of delivery to the page (one-line, human)
    logSystem(
      "bus:arrived@page",
      { tabId: boundTabId, hasText: !!lastMessage.payload?.text, flowId: lastMessage.payload?.__flowId },
      "console/bus",
      "System: message from the console arrived at this page"
    );

    setFeed((prev) => [...prev, { ts: lastMessage.ts, text: lastMessage.payload?.text ?? "" }]);
  }, [lastMessage, boundTabId]);

  // ---- Page → Console helper
  const safeSend = (type: string, payload: any) => {
    if (!boundTabId) {
      logWarn(
        "send:blocked",
        { type },
        "page/v4",
        "Warning: cannot send to console because no tab is linked to this page yet"
      );
      return;
    }
    // Tag with flowId (if present) for clearer workflows in Logs
    const payloadWithFlow =
      currentFlowId && payload && typeof payload === "object"
        ? { ...payload, __flowId: currentFlowId }
        : payload;

    logAction(
      "page->console",
      { type, tabId: boundTabId, hasPayload: payload != null, flowId: currentFlowId },
      "page/v4",
      "Page: sent a message to its tab in the console"
    );
    sendToConsole(boundTabId, type, payloadWithFlow);
  };

  const short = (s?: string) => (s ? s.slice(0, 8) : "—");

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">CS-25 — Two-way Console Test</h1>
        <p className="text-sm text-muted-foreground">
          route: <code className="text-xs">{pathname}</code> · tab:{" "}
          <code className="text-xs">{short(boundTabId)}</code> · page:{" "}
          <code className="text-xs">{short(activePageId)}</code>
        </p>
        <p className="text-xs text-muted-foreground">
          Each new AI tab creates a fresh manifest with a unique pageId. Switching tabs switches which pageId this view listens to.
        </p>
      </header>

      <Card className="p-3">
        <div className="font-medium mb-2">Console → Page feed</div>
        {feed.length === 0 ? (
          <div className="text-sm text-muted-foreground">(no messages yet)</div>
        ) : (
          <ul className="space-y-2">
            {feed.map((f, i) => (
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

      <Card className="p-3 space-y-3">
        <div className="font-medium">Page → Console controls</div>

        <div className="flex gap-2">
          <Input
            placeholder="Type text to prefill input in console…"
            onChange={(e) => safeSend("prefill_input", { text: e.target.value })}
          />
          <Button onClick={() => safeSend("prefill_input", { text: "Hello!" })}>
            Prefill input
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => safeSend("assistant_msg", { text: "Hello from the page 👋" })}
          >
            Push assistant bubble
          </Button>
          <Button
            variant="outline"
            onClick={() => safeSend("user_msg", { text: "User said hi (from page)" })}
          >
            Push user bubble
          </Button>
          <Button variant="destructive" onClick={() => safeSend("reset_chat", {})}>
            Reset chat
          </Button>
        </div>
      </Card>
    </div>
  );
}