"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type CS25TraceResult = {
  trace_uuid: string;             // key
  relevant?: boolean;
  rationale?: string;
  total_cost?: number;
  run_id?: string;
  at: number;                     // when we stored it (ms)
  // keep anything else you find useful (tokens, clause, etc.)
};


type Bucket = {
  // trace_uuid -> latest result (overwrite on rerun)
  traces: Record<string, CS25TraceResult>;
};

type TraceState = {
  /** per key `${route}::${tabId}` -> bucket */
  byKey: Record<string, Bucket>;

  /** upsert/overwrite one trace for a route/tab */
  upsert: (route: string, tabId: string, item: Partial<CS25TraceResult> & { trace_uuid: string }) => void;

  /** bulk upsert (optional convenience) */
  upsertMany: (route: string, tabId: string, items: Array<Partial<CS25TraceResult> & { trace_uuid: string }>) => void;

  /** read helpers */
  getBucket: (route: string, tabId: string) => Bucket | undefined;

  /** clear exactly one key (route::tabId) */
  clear: (route?: string, tabId?: string) => void;

  /** nukes all keys whose suffix is ::tabId */
  clearByTabId: (tabId: string) => void;

  /** nukes all keys whose prefix is route:: */
  clearByRoute: (route: string) => void;
};

const makeKey = (route?: string, tabId?: string) => `${route ?? ""}::${tabId ?? ""}`;

export const useCS25TraceStore = create<TraceState>()(
  persist(
    (set, get) => ({
      byKey: {},

      upsert: (route, tabId, item) =>
        set((s) => {
          const key = makeKey(route, tabId);
          const bucket = s.byKey[key] ?? { traces: {} };
          const prev = bucket.traces[item.trace_uuid] ?? {};
          const next: CS25TraceResult = {
            ...prev,
            ...("relevant" in item ? { relevant: item.relevant as boolean } : {}),
            ...("rationale" in item ? { rationale: item.rationale as string } : {}),
            ...("total_cost" in item ? { total_cost: item.total_cost as number } : {}),
            ...("run_id" in item ? { run_id: item.run_id as string } : {}),
            trace_uuid: item.trace_uuid,
            at: Date.now(),
          };
          return { byKey: { ...s.byKey, [key]: { traces: { ...bucket.traces, [item.trace_uuid]: next } } } };
        }),

      upsertMany: (route, tabId, items) =>
        set((s) => {
          if (!items?.length) return s;
          const key = makeKey(route, tabId);
          const bucket = s.byKey[key] ?? { traces: {} };
          const traces = { ...bucket.traces };
          const now = Date.now();
          for (const it of items) {
            const prev = traces[it.trace_uuid] ?? {};
            traces[it.trace_uuid] = {
              ...prev,
              ...("relevant" in it ? { relevant: it.relevant as boolean } : {}),
              ...("rationale" in it ? { rationale: it.rationale as string } : {}),
              ...("total_cost" in it ? { total_cost: it.total_cost as number } : {}),
              ...("run_id" in it ? { run_id: it.run_id as string } : {}),
              trace_uuid: it.trace_uuid,
              at: now,
            };
          }
          return { byKey: { ...s.byKey, [key]: { traces } } };
        }),

      getBucket: (route, tabId) => get().byKey[makeKey(route, tabId)],

      clear: (route, tabId) =>
        set((s) => {
          const { [makeKey(route, tabId)]: _drop, ...rest } = s.byKey;
          return { byKey: rest };
        }),

      clearByTabId: (tabId) =>
        set((s) => {
          const out: Record<string, Bucket> = {};
          const suffix = `::${tabId}`;
          for (const [k, v] of Object.entries(s.byKey)) if (!k.endsWith(suffix)) out[k] = v;
          return { byKey: out };
        }),

      clearByRoute: (route) =>
        set((s) => {
          const out: Record<string, Bucket> = {};
          const prefix = `${route}::`;
          for (const [k, v] of Object.entries(s.byKey)) if (!k.startsWith(prefix)) out[k] = v;
          return { byKey: out };
        }),
    }),
    {
      name: "cs25-trace-v1",                       // ✅ shows up in your inspector
      storage: createJSONStorage(() => localStorage),
      // Persist exactly the compact map; nothing else.
      partialize: (state) => ({ byKey: state.byKey }),
      version: 1,
    }
  )
);