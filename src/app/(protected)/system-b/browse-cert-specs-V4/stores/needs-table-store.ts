// src/app/(protected)/system-b/browse-cert-specs-V4/stores/needs-table-store.ts

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StreamedNeedItem, FrozenNeedRow } from "../NeedsTableUI";

export type NeedsClusters = {
  k: number;
  map: Record<string, string>; // need_id -> cluster_id
  clusters: Array<{
    cluster_id: string;
    size: number;
    label: string;
    need_ids: string[];
  }>;
};

export type NeedStrand =
  | "PERFORMANCE"
  | "INTEGRITY"
  | "INTEGRATION"
  | "MAINTAINABILITY"
  | "ASSURANCE";

export type NeedsStrands = {
  map: Record<
    string,
    { strand: NeedStrand; confidence?: number; reason?: string }
  >; // need_id -> strand tag
  // optional summary, if backend sends it
  strands?: Array<{ strand: NeedStrand; size: number }>;
};

export type NeedsMeta = {
  streaming: boolean;
  done?: number;
  total?: number;

  // ✅ NEW
  clustersReady?: boolean;
  strandsReady?: boolean;
};

export type TabNeedsState = {
  mode: "draft" | "frozen";
  frozenAt?: string;
  snapshotRows?: FrozenNeedRow[];
  items: StreamedNeedItem[];

  // ✅ NEW
  clusters?: NeedsClusters;
  strands?: NeedsStrands;

  meta: NeedsMeta;
};

type Store = {
  byKey: Record<string, TabNeedsState>;
  ensureKey: (key: string) => void;
  setMode: (
    key: string,
    mode: "draft" | "frozen",
    frozenAt?: string,
    snapshotRows?: FrozenNeedRow[]
  ) => void;

  resetStream: (key: string) => void;
  setMeta: (key: string, meta: Partial<NeedsMeta>) => void;
  appendItems: (key: string, items: StreamedNeedItem[]) => void;

  // ✅ NEW
  setClusters: (key: string, clusters?: NeedsClusters) => void;
  setStrands: (key: string, strands?: NeedsStrands) => void;




  purgeKey: (key: string) => void;
  purgeByTabId: (tabId: string) => void;
};

const DEFAULT: TabNeedsState = {
  mode: "draft",
  items: [],
  meta: { streaming: false, clustersReady: false, strandsReady: false },
  clusters: undefined,
  strands: undefined,
};

const CAP_ITEMS = 2000;

export const useNeedsTableStore = create<Store>()(
  persist(
    (set, get) => ({
      byKey: {},

      ensureKey: (key) => {
        if (get().byKey[key]) return;
        set((s) => ({ byKey: { ...s.byKey, [key]: { ...DEFAULT } } }));
      },

      setMode: (key, mode, frozenAt, snapshotRows) => {
        get().ensureKey(key);
        set((s) => {
          const prev = s.byKey[key] ?? DEFAULT;
          const clearFrozen = mode === "draft";

          return {
            byKey: {
              ...s.byKey,
              [key]: {
                ...prev,
                mode,
                frozenAt: clearFrozen ? undefined : frozenAt ?? prev.frozenAt,
                snapshotRows: clearFrozen ? undefined : snapshotRows ?? prev.snapshotRows,

                // ✅ when going back to draft, clear clusters
                clusters: clearFrozen ? undefined : prev.clusters,
                strands: clearFrozen ? undefined : prev.strands, // ✅
                meta: clearFrozen
                  ? { ...prev.meta, clustersReady: false, strandsReady: false }
                  : prev.meta,
              },
            },
          };
        });
      },

      resetStream: (key) => {
        get().ensureKey(key);
        set((s) => {
          const prev = s.byKey[key] ?? DEFAULT;
          return {
            byKey: {
              ...s.byKey,
              [key]: {
                ...prev,
                items: [],
                clusters: undefined, // ✅ clear clusters on new run
                strands: undefined, // ✅
                meta: { streaming: true, done: 0, total: 0, clustersReady: false, strandsReady: false },
              },
            },
          };
        });
      },

      setMeta: (key, meta) => {
        get().ensureKey(key);
        set((s) => {
          const prev = s.byKey[key] ?? DEFAULT;
          return {
            byKey: {
              ...s.byKey,
              [key]: { ...prev, meta: { ...prev.meta, ...meta } },
            },
          };
        });
      },

      appendItems: (key, items) => {
        if (!items?.length) return;
        get().ensureKey(key);
        set((s) => {
          const prev = s.byKey[key] ?? DEFAULT;
          const next = [...prev.items, ...items].slice(-CAP_ITEMS);
          return { byKey: { ...s.byKey, [key]: { ...prev, items: next } } };
        });
      },

      // ✅ NEW
      setClusters: (key, clusters) => {
        get().ensureKey(key);
        set((s) => {
          const prev = s.byKey[key] ?? DEFAULT;
          return {
            byKey: {
              ...s.byKey,
              [key]: {
                ...prev,
                clusters,
                meta: { ...prev.meta, clustersReady: Boolean(clusters?.clusters?.length) },
              },
            },
          };
        });
      },

      setStrands: (key, strands) => {
          get().ensureKey(key);
          set((s) => {
            const prev = s.byKey[key] ?? DEFAULT;
            const ready = Boolean(strands && Object.keys(strands.map ?? {}).length);
            return {
              byKey: {
                ...s.byKey,
                [key]: {
                  ...prev,
                  strands,
                  meta: { ...prev.meta, strandsReady: ready },
                },
              },
            };
          });
      },


      purgeKey: (key) =>
        set((s) => {
          if (!s.byKey[key]) return s;
          const { [key]: _drop, ...rest } = s.byKey;
          return { byKey: rest };
        }),

      purgeByTabId: (tabId) =>
        set((s) => {
          const next: Record<string, TabNeedsState> = {};
          for (const [k, v] of Object.entries(s.byKey)) {
            if (!k.endsWith(`::${tabId}`)) next[k] = v;
          }
          return { byKey: next };
        }),
    }),
    {
      name: "e42.needsTable.v1",
      version: 3, // ✅ bump because schema changed
      partialize: (s) => ({ byKey: s.byKey }),
    }
  )
);