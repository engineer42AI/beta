// src/app/(protected)/system-b/browse-cert-specs-V4/stores/needs-table-store.ts

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StreamedNeedItem, FrozenNeedRow } from "../NeedsTableUI";

export type NeedsMeta = { streaming: boolean; done?: number; total?: number };

export type TabNeedsState = {
  mode: "draft" | "frozen";
  frozenAt?: string;
  snapshotRows?: FrozenNeedRow[];
  items: StreamedNeedItem[];
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

  purgeKey: (key: string) => void;
  purgeByTabId: (tabId: string) => void;
};

const DEFAULT: TabNeedsState = {
  mode: "draft",
  items: [],
  meta: { streaming: false },
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
                snapshotRows: clearFrozen
                  ? undefined
                  : snapshotRows ?? prev.snapshotRows,
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
                meta: { streaming: true, done: 0, total: 0 },
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
      version: 1,
      partialize: (s) => ({ byKey: s.byKey }),
    }
  )
);