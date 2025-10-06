// src/stores/console-store.ts
"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logAction, logSystem, logWarn } from "@/lib/logger";
import {
  planNewTabBinding,
  ensureLinked as linkerEnsureLinked,
  findTabsByRoute as linkerFindTabsByRoute,
  validateBindings as linkerValidateBindings,
  removeBinding as linkerRemoveBinding,
  type AIBindings,
} from "@/lib/consoleLinker";

/* ===================== Types ===================== */

export type ToolId = "logs" | "ai" | "traces" | "tasks";

export type ConsoleTab = {
  id: string;
  tool: ToolId;
  title: string;
};

export type ChatMsg = { role: "user" | "assistant"; text: string };

export type TabManifest = {
  tabId: string;
  route: string;
  pageId: string;
  title?: string;
  // page-local config/state
  cs25?: { selectedTraceIds?: string[]; lastQuery?: string };
  session?: { threadId?: string; runId?: string; checkpointId?: string };
  flowId?: string;
};

// console -> page (tab-scoped)
type ToPageMsg = { tabId: string; type: string; payload: any; ts: number };
// page -> console (tab-scoped)
type ToConsoleMsg = { tabId: string; type: string; payload: any; ts: number };

type ConsoleState = {
  /* ----- Chrome ----- */
  open: boolean;
  consoleSize: number; // %
  railCollapsed: boolean;
  activeTool: ToolId;
  tabs: Record<ToolId, ConsoleTab[]>;
  activeTabId: Record<ToolId, string | null>;

  /* ----- Route title for default AI tab names ----- */
  contextTitle?: string;
  setContext: (title?: string) => void;

  /* ----- Current page instance (set by the page) ----- */
  currentPageId?: string;
  setCurrentPageId: (id: string | undefined) => void;

  /* ----- Per-AI-tab chat state (NOT persisted) ----- */
  aiMessages: Record<string, ChatMsg[]>;
  aiDrafts: Record<string, string>;

  /* ----- Tab <-> Page binding + manifest (PERSISTED) ----- */
  aiBindings: AIBindings;
  bindTabToCurrentPage: (tabId: string, route: string) => void;
  rebindTabToPage: (tabId: string, newPageId: string) => void;

  // lookups/helpers
  getBinding: (
    tabId: string
  ) => { route: string; pageId: string; manifest?: TabManifest } | undefined;
  getManifest: (tabId: string) => TabManifest | undefined;
  updateManifest: (tabId: string, patch: Partial<TabManifest>) => void;
  findTabsByRoute: (route: string) => string[]; // tabIds for this route

  /* ----- Tiny tab-scoped bus ----- */
  lastMessage?: ToPageMsg; // console -> page
  sendToPage: (tabId: string, payload: any) => void;

  lastConsoleEvent?: ToConsoleMsg; // page -> console
  sendToConsole: (tabId: string, type: string, payload: any) => void;

  /* ----- Chat actions ----- */
  setDraft(tabId: string, value: string): void;
  appendUser(tabId: string, text: string): void;
  appendAssistant(tabId: string, text: string): void;
  resetChat(tabId: string): void;

  /* ----- Chrome actions ----- */
  toggle: () => void;
  setConsoleSize: (n: number) => void;
  toggleRail: () => void;

  openTool: (tool: ToolId) => void;
  newTab: (tool: ToolId, title?: string, routeHint?: string) => void;
  closeTab: (tool: ToolId, tabId: string) => void;
  setActiveTab: (tool: ToolId, tabId: string) => void;
};

/* ===================== Helpers ===================== */

const clamp = (n: number) => Math.max(20, Math.min(70, n));

const initialTabs: Record<ToolId, ConsoleTab[]> = {
  logs: [{ id: "run-1", tool: "logs", title: "Run #1" }],
  ai: [{ id: "chat-1", tool: "ai", title: "Chat 1" }],
  traces: [],
  tasks: [],
};

const makeId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

/* ===================== Validator (exported wrapper) ===================== */
export function validateConsoleBindings(s: ConsoleState) {
  return linkerValidateBindings(
    { tabs: { ai: s.tabs.ai }, aiBindings: s.aiBindings, activeTabId: s.activeTabId },
    undefined
  );
}

/* ===================== Store ===================== */

export const useConsoleStore = create<ConsoleState>()(
  persist(
    (set, get) => ({
      /* ----- Chrome ----- */
      open: true,
      consoleSize: 35,
      railCollapsed: true,
      activeTool: "ai",
      tabs: initialTabs,
      activeTabId: { logs: "run-1", ai: "chat-1", traces: null, tasks: null },

      /* ----- Context (page title used for default AI tab names) ----- */
      contextTitle: "Chat",
      setContext: (title) => set({ contextTitle: title ?? "Chat" }),

      /* ----- Page instance (currently visible page) ----- */
      currentPageId: undefined,
      setCurrentPageId: (id) => {
        // Just record it. Do NOT auto-create or auto-link tabs.
        set({ currentPageId: id });
      },

      /* ----- Chat (ephemeral) ----- */
      aiMessages: { "chat-1": [] },
      aiDrafts: { "chat-1": "" },

      /* ----- Bindings + manifest (persisted) ----- */
      aiBindings: {},

      bindTabToCurrentPage: (tabId, route) => {
        const pid = get().currentPageId;
        if (!pid) {
          logWarn(
            "bind:missing-page",
            { tabId, route },
            "console/bind",
            "Warning: cannot link tab to page because no page is active"
          );
          return;
        }
        set((s) => {
          const { next } = linkerEnsureLinked(s.aiBindings, tabId, route, pid); // linker logs the change
          return { aiBindings: next };
        });
      },

      rebindTabToPage: (tabId, newPageId) =>
        set((s) => {
          const current = s.aiBindings[tabId];
          if (!current) {
            logWarn(
              "rebind:no-binding",
              { tabId, newPageId },
              "console/bind",
              "Warning: cannot re-link because this tab has no binding"
            );
            return s;
          }
          const { next } = linkerEnsureLinked(s.aiBindings, tabId, current.route, newPageId); // linker logs
          return { aiBindings: next };
        }),

      getBinding: (tabId) => get().aiBindings[tabId],
      getManifest: (tabId) => {
        const b = get().aiBindings[tabId];
        return b?.manifest ? { ...b.manifest } : undefined;
      },
      updateManifest: (tabId, patch) =>
        set((s) => {
          const b = s.aiBindings[tabId];
          if (!b) return s;
          const merged: TabManifest = {
            ...(b.manifest ?? { tabId, route: b.route, pageId: b.pageId }),
            ...patch,
            tabId,
          };
          const aiBindings = { ...s.aiBindings, [tabId]: { ...b, manifest: merged } };
          logSystem("manifest:saved", { tabId }, "console/manifest", "Saved this tab’s configuration");
          return { aiBindings };
        }),

      findTabsByRoute: (route) => linkerFindTabsByRoute(get().aiBindings, route),

      /* ----- Buses (proof of delivery only) ----- */
      lastMessage: undefined,
      sendToPage: (tabId, payload) => {
        const flowId = payload?.__flowId ?? get().aiBindings[tabId]?.manifest?.flowId;
        set({ lastMessage: { tabId, type: "ai_message", payload, ts: Date.now() } });
        logSystem("bus:to-page", { tabId, hasPayload: payload != null, flowId }, "console/bus", "Sent a message from console to page");
      },

      lastConsoleEvent: undefined,
      sendToConsole: (tabId, type, payload) => {
        const flowId = payload?.__flowId ?? get().aiBindings[tabId]?.manifest?.flowId;
        set({ lastConsoleEvent: { tabId, type, payload, ts: Date.now() } });
        logSystem("bus:to-console", { tabId, type, hasPayload: payload != null, flowId }, "console/bus", "Received a message from page to console");
      },

      /* ----- Chat actions ----- */
      setDraft: (tabId, value) => set((s) => ({ aiDrafts: { ...s.aiDrafts, [tabId]: value } })),
      appendUser: (tabId, text) =>
        set((s) => ({ aiMessages: { ...s.aiMessages, [tabId]: [...(s.aiMessages[tabId] ?? []), { role: "user", text }] } })),
      appendAssistant: (tabId, text) =>
        set((s) => ({ aiMessages: { ...s.aiMessages, [tabId]: [...(s.aiMessages[tabId] ?? []), { role: "assistant", text }] } })),
      resetChat: (tabId) =>
        set((s) => ({ aiMessages: { ...s.aiMessages, [tabId]: [] }, aiDrafts: { ...s.aiDrafts, [tabId]: "" } })),

      /* ----- Chrome actions ----- */
      toggle: () => set((s) => ({ open: !s.open })),
      setConsoleSize: (n) => set({ consoleSize: clamp(n) }),
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),

      openTool: (tool) => set({ activeTool: tool, open: true }),

      newTab: (tool, title, routeHint) => {
        set((s) => {
          const id = `${tool}-${Math.random().toString(36).slice(2, 8)}`;
          const base = title ?? (tool === "ai" ? s.contextTitle ?? "Chat" : `New ${tool}`);
          const tabs = { ...s.tabs, [tool]: [...s.tabs[tool], { id, tool, title: base }] };
          const activeTabId = { ...s.activeTabId, [tool]: id };
          const extras =
            tool === "ai"
              ? { aiMessages: { ...s.aiMessages, [id]: [] }, aiDrafts: { ...s.aiDrafts, [id]: "" } }
              : {};

          if (tool !== "ai") {
            logAction("tab:new", { tabId: id, tool, title: base }, "console/tab", `User: created a new ${tool} tab "${base}"`);
            return { tabs, activeTabId, activeTool: tool, open: true, ...extras };
          }

          const route = routeHint ?? (typeof window !== "undefined" ? window.location.pathname : "/");
          const { pageId } = planNewTabBinding({ route, currentPageId: get().currentPageId, existing: s.aiBindings, makeId });

          // Let the linker create the binding (and log it). Then add manifest bits.
          const { next } = linkerEnsureLinked(s.aiBindings, id, route, pageId);
          const flowId = makeId();
          next[id] = {
            ...next[id],
            manifest: { ...(next[id].manifest ?? { tabId: id, route, pageId }), title: base, flowId },
          };

          logAction("flow:create-ai-tab:step1", { flowId, tabId: id, title: base, route }, "console/tab", `User: created a new AI tab "${base}"`);

          return { tabs, activeTabId, activeTool: tool, open: true, ...extras, aiBindings: next };
        });
      },

      closeTab: (tool, tabId) =>
        set((s) => {
          const remaining = s.tabs[tool].filter((t) => t.id !== tabId);
          const nextActive = s.activeTabId[tool] === tabId ? remaining[0]?.id ?? null : s.activeTabId[tool];

          const base: any = {
            tabs: { ...s.tabs, [tool]: remaining },
            activeTabId: { ...s.activeTabId, [tool]: nextActive },
          };

          if (tool === "ai") {
            const flowId = s.aiBindings[tabId]?.manifest?.flowId;

            const { [tabId]: _m, ...restMsgs } = s.aiMessages;
            const { [tabId]: _d, ...restDrafts } = s.aiDrafts;

            // Remove the binding cleanly (linker logs inside)
            const { next: restBind } = linkerRemoveBinding(s.aiBindings, tabId);

            base.aiMessages = restMsgs;
            base.aiDrafts = restDrafts;
            base.aiBindings = restBind;

            logAction("flow:close-ai-tab:step1", { flowId, tabId }, "console/tab", "User: closed an AI tab");
          }

          return base;
        }),

      setActiveTab: (tool, tabId) =>
        set((s) => ({ activeTool: tool, activeTabId: { ...s.activeTabId, [tool]: tabId } })),
    }),
    {
      name: "console-v1",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persisted: any, fromVersion: number) => {
        const s = { ...(persisted ?? {}) };
        if (fromVersion < 2) {
          s.currentPageId = s.currentPageId ?? undefined;
          s.aiBindings = s.aiBindings ?? {};
          const tb = s.tabs ?? {};
          s.tabs = { logs: tb.logs ?? [], ai: tb.ai ?? [], traces: tb.traces ?? [], tasks: tb.tasks ?? [] };
          const ati = s.activeTabId ?? {};
          s.activeTabId = { logs: ati.logs ?? null, ai: ati.ai ?? null, traces: ati.traces ?? null, tasks: ati.tasks ?? null };
          s.contextTitle = s.contextTitle ?? "Chat";
          s.open = s.open ?? true;
          s.consoleSize = typeof s.consoleSize === "number" ? s.consoleSize : 35;
          s.railCollapsed = !!s.railCollapsed;
          s.activeTool = (["logs", "ai", "traces", "tasks"] as ToolId[]).includes(s.activeTool) ? s.activeTool : "ai";
        }
        return s as ConsoleState;
      },
      // Persist chrome + bindings + titles (not chat data)
      partialize: (s) => ({
        open: s.open,
        consoleSize: s.consoleSize,
        railCollapsed: s.railCollapsed,
        activeTool: s.activeTool,
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        contextTitle: s.contextTitle,
        aiBindings: s.aiBindings,
      }),
    }
  )
);