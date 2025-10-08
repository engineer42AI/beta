// src/stores/pageConfig-store.ts
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useEffect, useMemo, useRef, useCallback } from 'react';

type AnyConfig = Record<string, any>;
export const makeBindingKey = (route: string, tabId: string) => `${route}::${tabId}`;

interface PageConfigStore {
  configs: Record<string, AnyConfig>; // key = route::tabId

  setConfig: (route: string, tabId: string, next: AnyConfig) => void;
  updateConfig: (route: string, tabId: string, patch: Partial<AnyConfig>) => void;
  clearConfig: (route: string, tabId: string) => void;

  // NEW: convenience cleaners you can call from console-store on tab close
  clearByTabId: (tabId: string) => void;
  clearByBindingKey: (bindingKey: string) => void;

  clearAll: () => void;
  listKeys: () => string[];
}

export const usePageConfigStore = create<PageConfigStore>()(
  persist(
    (set, get) => ({
      configs: {},

      setConfig: (route, tabId, next) => {
        const key = makeBindingKey(route, tabId);
        set((state) => ({ configs: { ...state.configs, [key]: { ...next } } }));
      },

      updateConfig: (route, tabId, patch) => {
        const key = makeBindingKey(route, tabId);
        set((state) => ({
          configs: { ...state.configs, [key]: { ...(state.configs[key] ?? {}), ...patch } },
        }));
      },

      clearConfig: (route, tabId) => {
        const key = makeBindingKey(route, tabId);
        set((state) => {
          const next = { ...state.configs };
          delete next[key];
          return { configs: next };
        });
      },

      // NEW: wipe all configs for a tabId across any routes (handy if tabs can jump routes)
      clearByTabId: (tabId) => {
          set((state) => {
            const next = { ...state.configs };
            for (const k of Object.keys(next)) {
              const parts = k.split('::');
              const last = parts[parts.length - 1];
              if (last === tabId) delete next[k];
            }
            return { configs: next };
          });
      },

      // NEW: wipe exact binding key if you already know route::tabId
      clearByBindingKey: (bindingKey) => {
        set((state) => {
          const next = { ...state.configs };
          delete next[bindingKey];
          return { configs: next };
        });
      },

      clearAll: () => set({ configs: {} }),

      listKeys: () => Object.keys(get().configs),
    }),
    {
      name: 'page-config-v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);

// Keep your stabilized hook version you already implemented:
export function usePageConfig<T extends AnyConfig>(
  route: string | undefined,
  tabId: string | undefined,
  defaults: T
) {
  const key = route && tabId ? makeBindingKey(route, tabId) : undefined;

  const stableDefaultsRef = useRef<T>(defaults);

  const cfgForKey = usePageConfigStore(
      useCallback((s) => (key ? (s.configs[key] as T | undefined) : undefined), [key])
  );
  const setConfig     = usePageConfigStore((s) => s.setConfig);
  const updateConfig  = usePageConfigStore((s) => s.updateConfig);

  useEffect(() => {
    if (!key || !route || !tabId) return;
    if (cfgForKey === undefined) {
      setConfig(route, tabId, stableDefaultsRef.current);
    }
  }, [key, route, tabId, cfgForKey, setConfig]);

  const config = useMemo<T>(() => (cfgForKey ?? stableDefaultsRef.current), [cfgForKey]);

  const set = (next: T) => { if (route && tabId) setConfig(route, tabId, next); };
  const update = (patch: Partial<T>) => { if (route && tabId) updateConfig(route, tabId, patch); };

  return { config, setConfig: set, update };
}