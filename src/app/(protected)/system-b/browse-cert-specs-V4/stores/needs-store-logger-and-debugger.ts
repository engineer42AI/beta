//src/app/(protected)/system-b/browse-cert-specs-V4/stores/needs-store.ts

"use client";

import { create } from "zustand";

export type NeedsLogLevel = "info" | "warn" | "error";

export type NeedsLogEntry = {
  ts: number;
  level: NeedsLogLevel;
  event: string;
  tabId: string;
  runId?: string;
  message?: string;
  data?: any;
};

type State = {
  byTab: Record<string, NeedsLogEntry[]>;
  push: (e: Omit<NeedsLogEntry, "ts">) => void;
  clearTab: (tabId: string) => void;
  clearAll: () => void;
};

const MAX_PER_TAB = 500;

export const useNeedsLogStore = create<State>((set) => ({
  byTab: {},
  push: (e) =>
    set((s) => {
      const tabId = e.tabId || "—";
      const next = [...(s.byTab[tabId] ?? []), { ...e, ts: Date.now() }];
      const trimmed = next.length > MAX_PER_TAB ? next.slice(-MAX_PER_TAB) : next;
      return { byTab: { ...s.byTab, [tabId]: trimmed } };
    }),
  clearTab: (tabId) =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: [] } })),
  clearAll: () => set({ byTab: {} }),
}));