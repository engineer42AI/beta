// src/components/console/bus/useBusChannel.ts
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useConsoleStore } from "@/stores/console-store";


export type Scope = "ai" | "traces" | "logs";
export type Envelope = {
  v: number; id: string; ts: number;
  scope: Scope;
  dir: "page→console" | "console→page";
  route: string;
  pageId?: string; tabId?: string;
  topic?: string; payload?: any;
};

// ---- module-scoped, shared across remounts ----
const CONSOLE_FEED = new Map<string, Envelope[]>();      // tabId -> Envelope[]
const CONSOLE_SEEN = new Map<string, Set<string>>();     // tabId -> ids

const makeId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

/* -------------------- PAGE SIDE -------------------- */
/** Former useBusChannel – rename to usePageBusChannel */
export function usePageBusChannel(scope: Scope) {
  const route = usePathname() ?? "/";
  const pageRef = useRef<string>(makeId());
  const pageId = pageRef.current;

  const setCurrentPageId = useConsoleStore(s => s.setCurrentPageId);
  const activeTabIdMap   = useConsoleStore(s => s.activeTabId);
  const bindingsAll      = useConsoleStore(s => s.aiBindings as Record<string, { route: string; pageId?: string }>);
  const rebindTabToPage  = useConsoleStore(s => s.rebindTabToPage);
  const sendRaw          = useConsoleStore(s => s.sendToConsole);
  const lastMessage      = useConsoleStore(s => s.lastMessage);

  useEffect(() => {
    setCurrentPageId(pageId);
    return () => setCurrentPageId(undefined);
  }, [pageId, setCurrentPageId]);

  const activeScopedTabId =
    scope === "ai" ? (activeTabIdMap.ai ?? undefined) : undefined;

  useEffect(() => {
    if (!activeScopedTabId) return;
    const b = bindingsAll[activeScopedTabId];
    if (!b || b.route !== route) return;
    if (b.pageId === pageId) return;
    rebindTabToPage(activeScopedTabId, pageId);
  }, [activeScopedTabId, bindingsAll, route, pageId, rebindTabToPage]);

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

  const isActiveTabForThisRoute = !!(activeScopedTabId && bindingsAll[activeScopedTabId]?.route === route);
  const isActiveTabLinkedHere   = !!(activeScopedTabId && bindingsAll[activeScopedTabId]?.route === route && bindingsAll[activeScopedTabId]?.pageId === pageId);
  const isBound                 = !!boundTabId;
  const canSend                 = !!(boundTabId || (activeScopedTabId && isActiveTabForThisRoute));

  const send = useCallback((partial: Pick<Envelope, "topic" | "payload">) => {
    const target = boundTabId ?? activeScopedTabId;
    if (!target) return;
    const env: Envelope = {
      v: 1, id: makeId(), ts: Date.now(),
      scope, dir: "page→console", route, pageId, tabId: target,
      topic: partial.topic, payload: partial.payload,
    };
    sendRaw(target, "bus_message", env);
  }, [activeScopedTabId, boundTabId, pageId, route, scope, sendRaw]);

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

    setFeedByTab(prev => ({ ...prev, [boundTabId]: [...(prev[boundTabId] ?? []), env] }));
  }, [lastMessage, boundTabId, scope]);

  return { scope, route, pageId, boundTabId, send, feed, isBound, canSend, isActiveTabForThisRoute, isActiveTabLinkedHere };
}

/* -------------------- CONSOLE SIDE -------------------- */
/** New: console-side twin used inside console AI views */
export function useConsoleBusChannel(scope: Scope, options?: { maxFeed?: number }) {
  const cap = options?.maxFeed ?? 200;

  const activeAiTabId   = useConsoleStore(s => s.activeTabId.ai);
  const getBinding      = useConsoleStore(s => s.getBinding);
  const lastConsoleEvent= useConsoleStore(s => s.lastConsoleEvent);
  const sendToPageStore = useConsoleStore(s => s.sendToPage);

  const binding = activeAiTabId ? getBinding(activeAiTabId) : undefined;
  const isLinkedToPage = !!(binding?.route && binding?.pageId);

  // Ephemeral per-tab ring buffer (module scoped)
  const FEED = CONSOLE_FEED;
  const SEEN = CONSOLE_SEEN;

  const [version, setVersion] = useState(0);
  const bump = () => setVersion(v => v + 1);

  const feedFromPage = useMemo(
    () => (activeAiTabId ? (FEED.get(activeAiTabId) ?? []) : []),
    [activeAiTabId, version]
  );

  useEffect(() => {
    if (!lastConsoleEvent || lastConsoleEvent.type !== "bus_message") return;
    if (!activeAiTabId || lastConsoleEvent.tabId !== activeAiTabId) return;

    const env = lastConsoleEvent.payload as Envelope;
    if (!env || env.scope !== scope || env.dir !== "page→console") return;

    const seen = SEEN.get(activeAiTabId) ?? new Set<string>();
    const key = env.id ?? `${env.ts}:${env.topic}`;
    if (seen.has(key)) return;
    seen.add(key);
    SEEN.set(activeAiTabId, seen);

    const arr = FEED.get(activeAiTabId) ?? [];
    arr.push(env);
    if (arr.length > cap) arr.splice(0, arr.length - cap);
    FEED.set(activeAiTabId, arr);

    bump();
  }, [lastConsoleEvent, activeAiTabId, cap, scope]);

  const sendToPage = useCallback((topic: string, payload?: any) => {
    if (!activeAiTabId || !binding) return;
    const env: Envelope = {
      v: 1, id: makeId(), ts: Date.now(),
      scope, dir: "console→page",
      route: binding.route, pageId: binding.pageId, tabId: activeAiTabId,
      topic, payload,
    };
    sendToPageStore(activeAiTabId, env);
  }, [activeAiTabId, binding, scope, sendToPageStore]);

  const clearFeedForCurrentTab = useCallback(() => {
    if (!activeAiTabId) return;
    FEED.set(activeAiTabId, []);
    SEEN.set(activeAiTabId, new Set());
    bump();
  }, [activeAiTabId]);

  return { activeAiTabId, binding, isLinkedToPage, feedFromPage, sendToPage, clearFeedForCurrentTab };
}