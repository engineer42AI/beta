// src/components/console/bus/useAiChannel.ts
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useConsoleStore } from "@/stores/console-store";
import type { Envelope } from "./types";

const makeId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

export function useAiChannel() {
  const route = usePathname() ?? "/";
  const pageRef = useRef<string>(makeId());
  const pageId = pageRef.current;

  // store (existing)
  const setCurrentPageId = useConsoleStore(s => s.setCurrentPageId);
  const activeAiTabId    = useConsoleStore(s => s.activeTabId.ai as string | undefined);
  const aiBindings       = useConsoleStore(s => s.aiBindings as Record<string, {route:string,pageId?:string}>);
  const rebindTabToPage  = useConsoleStore(s => s.rebindTabToPage as (tabId:string, pageId:string)=>void);
  const sendRaw          = useConsoleStore(s => s.sendToConsole as (tabId:string, type:string, payload:any)=>void);
  const lastMessage      = useConsoleStore(s => s.lastMessage as { tabId:string; type:string; ts:number; payload:any } | undefined);

  // register page
  useEffect(() => {
    setCurrentPageId(pageId);
    return () => setCurrentPageId(undefined);
  }, [pageId, setCurrentPageId]);

  // auto-link active tab on this route
  useEffect(() => {
    if (!activeAiTabId) return;
    const b = aiBindings[activeAiTabId];
    if (!b || b.route !== route) return;
    if (b.pageId === pageId) return;
    rebindTabToPage(activeAiTabId, pageId);
  }, [activeAiTabId, aiBindings, route, pageId, rebindTabToPage]);

  // resolve bound tab
  const boundTabId = useMemo(() => {
    if (activeAiTabId) {
      const ab = aiBindings[activeAiTabId];
      if (ab && ab.route === route && ab.pageId === pageId) return activeAiTabId;
    }
    for (const [tid, b] of Object.entries(aiBindings)) {
      if (b.route === route && b.pageId === pageId) return tid;
    }
    return undefined;
  }, [activeAiTabId, aiBindings, route, pageId]);

  // generic send (message is just an Envelope)
  const send = useCallback((msg: Partial<Envelope>) => {
    const base: Envelope = {
      v: 1,
      id: makeId(),
      ts: Date.now(),
      scope: "ai",
      dir: "page→console",
      route,
      pageId,
      ...msg,
    };
    const target = boundTabId ?? activeAiTabId;
    if (!target) return;

    // use one wire type in the store, e.g. "bus_message"
    sendRaw(target, "bus_message", base);
  }, [route, pageId, boundTabId, activeAiTabId, sendRaw]);

  // receive: de-dup + expose a feed of Envelopes
  const [feed, setFeed] = useState<Envelope[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type !== "bus_message") return;
    if (!boundTabId || lastMessage.tabId !== boundTabId) return;

    const env = lastMessage.payload as Envelope;
    if (env?.scope !== "ai" || env?.dir !== "console→page") return;

    if (seen.current.has(env.id)) return;
    seen.current.add(env.id);
    setFeed(f => [...f, env]);
  }, [lastMessage, boundTabId]);

  return {
    route,
    pageId,
    boundTabId,
    activeAiTabId,
    send,       // (msg: Partial<Envelope>) => void
    feed,       // Envelope[]
  };
}