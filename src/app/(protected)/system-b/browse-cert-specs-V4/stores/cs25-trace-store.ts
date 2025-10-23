"use client";

import { create } from "zustand";

export type TraceRow = {
  trace_uuid: string;
  bottom_uuid: string;
  bottom_paragraph_id?: string;
  path_labels: string[];
  results?: any[];
};

export type OutlineNode = {
  type: 'Subpart' | 'Heading' | 'Section';
  uuid: string;
  label?: string;
  number?: string;
  title?: string;
  paragraph_id?: string;
  children?: OutlineNode[];
  intent?: any | null;
  intents?: any[];
};

type TabState = {
  outline: OutlineNode | null;
  sectionTraces: Record<string, TraceRow[]>;
  traceLookup: Record<string, { section_uuid: string; index: number }>;
  // optional: last runId/phase if you want
  runId?: string | null;
};

type TraceStore = {
  tabs: Record<string, TabState>;
  /** Ensure a tab bucket exists */
  ensureTab: (tabId: string) => void;
  /** Remove tab bucket (on tab close) */
  removeTab: (tabId: string) => void;

  /** Set initial outline payload for tab (full replace on load success) */
  setInitialPayload: (tabId: string, raw: { outline: OutlineNode | null, section_traces: Record<string, TraceRow[]> }) => void;

  /** Reset only results for tab (used at run start / rerun) but keep outline & rows */
  resetResultsForTab: (tabId: string) => void;

  /** Upsert a streamed item result into the correct row for tab */
  applyTraceItem: (tabId: string, item: any) => void;
};

export const useTraceStore = create<TraceStore>((set, get) => ({
  tabs: {},

  ensureTab: (tabId) => set(state => {
    if (state.tabs[tabId]) return state;
    return {
      tabs: {
        ...state.tabs,
        [tabId]: { outline: null, sectionTraces: {}, traceLookup: {}, runId: null }
      }
    };
  }),

  removeTab: (tabId) => set(state => {
    const next = { ...state.tabs };
    delete next[tabId];
    return { tabs: next };
  }),

  setInitialPayload: (tabId, raw) => set(state => {
    const outline = raw?.outline ?? null;
    const sectionTraces = raw?.section_traces ?? {};
    // build lookup
    const lookup: Record<string, { section_uuid: string; index: number }> = {};
    Object.entries(sectionTraces).forEach(([section_uuid, rows]) => {
      (rows ?? []).forEach((row, index) => {
        if (row?.trace_uuid) lookup[row.trace_uuid] = { section_uuid, index };
      });
    });

    return {
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...(state.tabs[tabId] ?? { outline: null, sectionTraces: {}, traceLookup: {} }),
          outline,
          sectionTraces,
          traceLookup: lookup,
        }
      }
    };
  }),

  resetResultsForTab: (tabId) => set(state => {
    const cur = state.tabs[tabId];
    if (!cur) return state;
    const cleared: Record<string, TraceRow[]> = {};
    for (const [sid, rows] of Object.entries(cur.sectionTraces)) {
      cleared[sid] = (rows ?? []).map(r => ({ ...r, results: [] }));
    }
    return {
      tabs: {
        ...state.tabs,
        [tabId]: { ...cur, sectionTraces: cleared }
      }
    };
  }),

  applyTraceItem: (tabId, item) => set(state => {
    const cur = state.tabs[tabId];
    if (!cur) return state;

    const tId: string | undefined = item?.trace_uuid;
    if (!tId) return state;

    let loc = cur.traceLookup[tId];

    // Fallback: locate by scan if lookup missing
    if (!loc) {
      for (const [section_uuid, rows] of Object.entries(cur.sectionTraces)) {
        const idx = (rows ?? []).findIndex(r => r?.trace_uuid === tId);
        if (idx >= 0) {
          loc = { section_uuid, index: idx };
          break;
        }
      }
    }

    // If still not found but payload has section_uuid → append new row (rare but safe)
    if (!loc && item?.section_uuid) {
      const section_uuid: string = item.section_uuid;
      const rows = Array.isArray(cur.sectionTraces[section_uuid]) ? [...cur.sectionTraces[section_uuid]] : [];
      const newRow: TraceRow = {
        trace_uuid: tId,
        bottom_uuid: item.bottom_uuid ?? "",
        bottom_paragraph_id: item.bottom_paragraph_id,
        path_labels: item.path_labels ?? [],
        results: [item],
      };
      const nextTraces = { ...cur.sectionTraces, [section_uuid]: [...rows, newRow] };
      const nextLookup = { ...cur.traceLookup, [tId]: { section_uuid, index: nextTraces[section_uuid].length - 1 } };
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...cur, sectionTraces: nextTraces, traceLookup: nextLookup }
        }
      };
    }

    if (!loc) return state;

    const nextTraces = { ...cur.sectionTraces };
    const arr = Array.isArray(nextTraces[loc.section_uuid]) ? [...nextTraces[loc.section_uuid]] : [];
    const row = { ...(arr[loc.index] || {}) } as TraceRow;

    // “Overwrite only changed”: replace last result if same kind, else append.
    const old = Array.isArray(row.results) ? [...row.results] : [];
    const last = old[old.length - 1];

    const sameResult =
      (last?.result_id && item?.result_id && last.result_id === item.result_id) ||
      (last?.run_id && item?.run_id && last.run_id === item.run_id && last.step === item.step);

    const results = sameResult ? [...old.slice(0, -1), item] : [...old, item];

    row.results = results;
    arr[loc.index] = row;
    nextTraces[loc.section_uuid] = arr;

    return {
      tabs: {
        ...state.tabs,
        [tabId]: { ...cur, sectionTraces: nextTraces }
      }
    };
  }),
}));