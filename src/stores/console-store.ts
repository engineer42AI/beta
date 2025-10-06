// src/stores/console-store.ts
"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logAction, logSystem, logWarn, logError } from "@/lib/logger";

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

  /** Optional workflow correlation id for grouped logs */
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
  aiBindings: Record<string, { route: string; pageId: string; manifest?: TabManifest }>;
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

/* ===================== Validator (exported) ===================== */

export function validateConsoleBindings(s: ConsoleState) {
  const issues: string[] = [];
  const aiTabIds = new Set(s.tabs.ai.map((t) => t.id));
  const seenByRoute = new Map<string, Set<string>>();

  for (const [tabId, b] of Object.entries(s.aiBindings)) {
    if (!aiTabIds.has(tabId)) issues.push(`Binding points to a missing tab (tabId=${tabId}, route=${b.route}).`);
    const set = seenByRoute.get(b.route) ?? new Set<string>();
    set.add(b.pageId);
    seenByRoute.set(b.route, set);
  }

  for (const t of s.tabs.ai) {
    if (!s.aiBindings[t.id]) issues.push(`AI tab "${t.title}" (tabId=${t.id}) has no binding.`);
  }

  try {
    const currentRoute = typeof window !== "undefined" ? window.location.pathname : null;
    const active = s.activeTabId.ai ? s.aiBindings[s.activeTabId.ai] : undefined;
    if (currentRoute && active && active.route !== currentRoute) {
      issues.push(
        `Active AI tab is bound to a different page (tab route="${active.route}" vs current route="${currentRoute}").`
      );
    }
  } catch {
    /* ignore */
  }

  return { ok: issues.length === 0, issues };
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
      setContext: (title) => {
        // No log here — not needed for manifest or bus validation.
        set({ contextTitle: title ?? "Chat" });
      },

      /* ----- Page instance (currently visible page) ----- */
      currentPageId: undefined,
      setCurrentPageId: (id) => set(() => ({ currentPageId: id })),

      /* ----- Chat (ephemeral) ----- */
      aiMessages: { "chat-1": [] },
      aiDrafts: { "chat-1": "" },

      /* ----- Bindings + manifest (persisted) ----- */
      aiBindings: {},

      bindTabToCurrentPage: (tabId, route) => {
        const pid = get().currentPageId;
        if (!pid) {
          // We tried to bind but there is no active page — this is useful warning.
          logWarn(
            "bind:missing-page",
            { tabId, route },
            "console/bind",
            "Warning: cannot link tab to page because no page is active"
          );
          return;
        }
        set((s) => ({
          aiBindings: {
            ...s.aiBindings,
            [tabId]: {
              route,
              pageId: pid,
              manifest: {
                tabId,
                route,
                pageId: pid,
                title: s.tabs.ai.find((t) => t.id === tabId)?.title ?? "Chat",
              },
            },
          },
        }));
        // Clear, single line: tab <-> page contract created.
        logSystem(
          "bind:created",
          { tabId, route, pageId: pid },
          "console/bind",
          "Linked this tab to the active page"
        );
      },

      rebindTabToPage: (tabId, newPageId) =>
        set((s) => {
          const b = s.aiBindings[tabId];
          if (!b) {
            logWarn(
              "rebind:no-binding",
              { tabId, newPageId },
              "console/bind",
              "Warning: cannot re-link because this tab has no binding"
            );
            return s;
          }
          const nextManifest: TabManifest = {
            ...(b.manifest ?? { tabId, route: b.route, pageId: newPageId }),
            pageId: newPageId,
          };
          logSystem(
            "bind:updated",
            { tabId, route: b.route, from: b.pageId, to: newPageId },
            "console/bind",
            "Updated which page this tab is linked to"
          );
          return {
            aiBindings: { ...s.aiBindings, [tabId]: { ...b, pageId: newPageId, manifest: nextManifest } },
          };
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
          // Log only that the manifest was saved (no spammy diffs).
          logSystem(
            "manifest:saved",
            { tabId },
            "console/manifest",
            "Saved this tab’s configuration"
          );
          return { aiBindings: { ...s.aiBindings, [tabId]: { ...b, manifest: merged } } };
        }),

      findTabsByRoute: (route) => {
        const { aiBindings } = get();
        return Object.entries(aiBindings)
          .filter(([, b]) => b.route === route)
          .map(([tid]) => tid);
      },

      /* ----- Buses (only what's needed to prove delivery) ----- */
      lastMessage: undefined,
      sendToPage: (tabId, payload) => {
        const flowId = payload?.__flowId ?? get().aiBindings[tabId]?.manifest?.flowId;
        set({ lastMessage: { tabId, type: "ai_message", payload, ts: Date.now() } });
        logSystem(
          "bus:to-page",
          { tabId, hasPayload: payload != null, flowId },
          "console/bus",
          "Sent a message from console to page"
        );
      },

      lastConsoleEvent: undefined,
      sendToConsole: (tabId, type, payload) => {
        const flowId = payload?.__flowId ?? get().aiBindings[tabId]?.manifest?.flowId;
        set({ lastConsoleEvent: { tabId, type, payload, ts: Date.now() } });
        logSystem(
          "bus:to-console",
          { tabId, type, hasPayload: payload != null, flowId },
          "console/bus",
          "Received a message from page to console"
        );
      },

      /* ----- Chat actions (per-tab, ephemeral) ----- */
      setDraft: (tabId, value) => set((s) => ({ aiDrafts: { ...s.aiDrafts, [tabId]: value } })),
      appendUser: (tabId, text) =>
        set((s) => ({
          aiMessages: {
            ...s.aiMessages,
            [tabId]: [...(s.aiMessages[tabId] ?? []), { role: "user", text }],
          },
        })),
      appendAssistant: (tabId, text) =>
        set((s) => ({
          aiMessages: {
            ...s.aiMessages,
            [tabId]: [...(s.aiMessages[tabId] ?? []), { role: "assistant", text }],
          },
        })),
      resetChat: (tabId) =>
        set((s) => ({
          aiMessages: { ...s.aiMessages, [tabId]: [] },
          aiDrafts: { ...s.aiDrafts, [tabId]: "" },
        })),

      /* ----- Chrome actions ----- */
      toggle: () => set((s) => ({ open: !s.open })),
      setConsoleSize: (n) => set({ consoleSize: clamp(n) }),
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),

      openTool: (tool) => {
        set({ activeTool: tool, open: true });
        // No log: generic clicks are noise for our validation goals.
      },

      newTab: (tool, title, routeHint) => {
        // One atomic update so title/binding are aligned
        set((s) => {
          const id = `${tool}-${Math.random().toString(36).slice(2, 8)}`;
          const base =
            title ?? (tool === "ai" ? s.contextTitle ?? "Chat" : `New ${tool}`);
          const tabs = { ...s.tabs, [tool]: [...s.tabs[tool], { id, tool, title: base }] };
          const activeTabId = { ...s.activeTabId, [tool]: id };
          const extra =
            tool === "ai"
              ? { aiMessages: { ...s.aiMessages, [id]: [] }, aiDrafts: { ...s.aiDrafts, [id]: "" } }
              : {};

          if (tool !== "ai") {
            // No log: non-AI tabs don't participate in manifest flow.
            return { tabs, activeTabId, activeTool: tool, open: true, ...extra };
          }

          const route =
            routeHint ??
            (typeof window !== "undefined" ? window.location.pathname : "/");

          // Ensure unique pageId across all bindings
          const used = new Set(Object.values(s.aiBindings).map((b) => b.pageId));
          let pageId = makeId();
          while (used.has(pageId)) pageId = makeId();

          // Group this creation workflow
          const flowId = makeId();

          const aiBindings = {
            ...s.aiBindings,
            [id]: {
              route,
              pageId,
              manifest: { tabId: id, route, pageId, title: base, flowId },
            },
          };

          // Minimal, clear, grouped workflow (step 1/2 + step 2/2)
          logAction(
            "flow:create-ai-tab:step1",
            { flowId, tabId: id, title: base, route },
            "console/tab",
            `User: created a new AI tab "${base}"`
          );
          logSystem(
            "flow:create-ai-tab:step2",
            { flowId, tabId: id, route, pageId },
            "console/bind",
            "System: linked this tab to a new page"
          );

          return { tabs, activeTabId, activeTool: tool, open: true, ...extra, aiBindings };
        });
      },

      closeTab: (tool, tabId) =>
        set((s) => {
          const remaining = s.tabs[tool].filter((t) => t.id !== tabId);
          const nextActive =
            s.activeTabId[tool] === tabId ? remaining[0]?.id ?? null : s.activeTabId[tool];

          const base: any = {
            tabs: { ...s.tabs, [tool]: remaining },
            activeTabId: { ...s.activeTabId, [tool]: nextActive },
          };

          if (tool === "ai") {
            const binding = s.aiBindings[tabId];
            const flowId = binding?.manifest?.flowId;

            const { [tabId]: _m, ...restMsgs } = s.aiMessages;
            const { [tabId]: _d, ...restDrafts } = s.aiDrafts;
            const { [tabId]: _b, ...restBind } = s.aiBindings;

            base.aiMessages = restMsgs;
            base.aiDrafts = restDrafts;
            base.aiBindings = restBind;

            // Grouped close workflow
            logAction(
              "flow:close-ai-tab:step1",
              { flowId, tabId },
              "console/tab",
              "User: closed an AI tab"
            );
            logSystem(
              "flow:close-ai-tab:step2",
              { flowId, tabId },
              "console/bind",
              "System: removed the tab ↔ page link"
            );
          }

          return base;
        }),

      setActiveTab: (tool, tabId) => {
        set((s) => ({ activeTool: tool, activeTabId: { ...s.activeTabId, [tool]: tabId } }));
        // No log: switching tabs is frequent and not required for validation.
      },
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
          s.tabs = {
            logs: tb.logs ?? [],
            ai: tb.ai ?? [],
            traces: tb.traces ?? [],
            tasks: tb.tasks ?? [],
          };

          const ati = s.activeTabId ?? {};
          s.activeTabId = {
            logs: ati.logs ?? null,
            ai: ati.ai ?? null,
            traces: ati.traces ?? null,
            tasks: ati.tasks ?? null,
          };

          s.contextTitle = s.contextTitle ?? "Chat";
          s.open = s.open ?? true;
          s.consoleSize = typeof s.consoleSize === "number" ? s.consoleSize : 35;
          s.railCollapsed = !!s.railCollapsed;
          s.activeTool = (["logs", "ai", "traces", "tasks"] as ToolId[]).includes(s.activeTool)
            ? s.activeTool
            : "ai";
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