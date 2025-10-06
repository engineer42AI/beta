// src/components/console/bus/useBusChannel.ts
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useConsoleStore } from "@/stores/console-store";

export type Scope = "ai" | "traces" | "logs";

export type Envelope = {
  v: number;
  id: string;
  ts: number;
  scope: Scope;
  dir: "page→console" | "console→page";
  route: string;
  pageId?: string;
  tabId?: string;
  topic?: string;
  payload?: any;
};

const makeId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

export function useBusChannel(scope: Scope) {
  const route = usePathname() ?? "/";
  const pageRef = useRef<string>(makeId());
  const pageId = pageRef.current;

  // store selectors
  const setCurrentPageId = useConsoleStore((s) => s.setCurrentPageId);
  const activeTabIdMap   = useConsoleStore((s) => s.activeTabId);
  // NOTE: for now we re-use AI bindings; when you add traces/logs, switch on `scope`
  const bindingsAll      = useConsoleStore((s) => s.aiBindings as Record<string, { route: string; pageId?: string }>);
  const rebindTabToPage  = useConsoleStore((s) => s.rebindTabToPage);
  const sendRaw          = useConsoleStore((s) => s.sendToConsole);
  const lastMessage      = useConsoleStore((s) => s.lastMessage);

  // register/unregister this page instance
  useEffect(() => {
    setCurrentPageId(pageId);
    return () => setCurrentPageId(undefined);
  }, [pageId, setCurrentPageId]);

  // resolve the active tab for this scope (ai for now)
  const activeScopedTabId =
    scope === "ai" ? (activeTabIdMap.ai ?? undefined) : undefined; // extend later for traces/logs

  // auto-link if tab is for this route but points to a different page instance
  useEffect(() => {
    if (!activeScopedTabId) return;
    const b = bindingsAll[activeScopedTabId];
    if (!b || b.route !== route) return;
    if (b.pageId === pageId) return;
    rebindTabToPage(activeScopedTabId, pageId);
  }, [activeScopedTabId, bindingsAll, route, pageId, rebindTabToPage]);

  // tab currently bound to THIS page instance on THIS route
  const boundTabId = useMemo(() => {
    if (activeScopedTabId) {
      const ab = bindingsAll[activeScopedTabId];
      if (ab && ab.route === route && ab.pageId === pageId) return activeScopedTabId;
    }
    for (const [tid, b] of Object.entries(bindingsAll)) {
      if (b.route === route && b.pageId === pageId) return tid;
    }
    return undefined;
  }, [activeScopedTabId, bindingsAll, route, pageId]);

  // computed flags
  const isActiveTabForThisRoute = !!(activeScopedTabId && bindingsAll[activeScopedTabId]?.route === route);
  const isActiveTabLinkedHere   = !!(activeScopedTabId && bindingsAll[activeScopedTabId]?.route === route && bindingsAll[activeScopedTabId]?.pageId === pageId);
  const isBound                 = !!boundTabId;                                 // bound to this page instance
  const canSend                 = !!(boundTabId || (activeScopedTabId && isActiveTabForThisRoute)); // send will auto-link if needed

  // send (page → console) — scope baked in
  const send = useCallback((partial: Pick<Envelope, "topic" | "payload">) => {
    const target = boundTabId ?? activeScopedTabId;
    if (!target) return;
    const env: Envelope = {
      v: 1,
      id: makeId(),
      ts: Date.now(),
      scope,
      dir: "page→console",
      route,
      pageId,
      tabId: target,
      topic: partial.topic,
      payload: partial.payload,
    };
    sendRaw(target, "bus_message", env);
  }, [activeScopedTabId, boundTabId, pageId, route, scope, sendRaw]);

  // feed (console → page), per-tab with de-dupe
  const [feedByTab, setFeedByTab] = useState<Record<string, Envelope[]>>({});
  const seenByTab = useRef<Record<string, Set<string>>>({});

  const feed = boundTabId ? (feedByTab[boundTabId] ?? []) : [];

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "bus_message") return;
    if (!boundTabId || lastMessage.tabId !== boundTabId) return;

    const env = lastMessage.payload as Envelope;
    if (!env || env.dir !== "console→page" || env.scope !== scope) return;

    const key = env.id ?? `${env.ts}`;
    if (!seenByTab.current[boundTabId]) seenByTab.current[boundTabId] = new Set();
    if (seenByTab.current[boundTabId].has(key)) return;
    seenByTab.current[boundTabId].add(key);

    setFeedByTab((prev) => ({
      ...prev,
      [boundTabId]: [...(prev[boundTabId] ?? []), env],
    }));
  }, [lastMessage, boundTabId, scope]);

  return {
    scope,
    route,
    pageId,
    boundTabId,
    send,
    feed,
    isBound,
    canSend,
    isActiveTabForThisRoute,
    isActiveTabLinkedHere,
  };
}