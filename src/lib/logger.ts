"use client";

import { create } from "zustand";

/** Severity */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** High-level source */
export type LogCategory = "action" | "system"; // action = user-initiated, system = internal

export type LogEntry = {
  id: string;
  ts: number;
  level: LogLevel;
  category: LogCategory;
  /** short, machine-ish id (e.g. "tab:new", "manifest:update") */
  event: string;
  /** optional human-friendly one-liner */
  message?: string;
  /** area (e.g. "console/tab", "console/bind", "page") */
  context?: string;
  /** structured payload */
  data?: unknown;
  /** optional tags (e.g. route:/foo, v4)  */
  tags?: string[];
  /** coalesced repeat count */
  repeat?: number;
};

type LogState = {
  entries: LogEntry[];

  /** minimum level shown in the store (UI can filter further if it wants) */
  minLevel: LogLevel;
  setLogMinLevel: (lv: LogLevel) => void;

  /** optional default category filter persisted here if you want */
  enabledCategories: Record<LogCategory, boolean>;
  setCategoryEnabled: (cat: LogCategory, on: boolean) => void;

  push: (e: Omit<LogEntry, "id" | "ts" | "repeat">) => void;
  clear: () => void;
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const makeId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** coalesce identical consecutive rows within this window */
const COALESCE_MS = 2000;

export const useLogStore = create<LogState>((set, get) => ({
  entries: [],
  minLevel: "info",
  setLogMinLevel: (lv) => set({ minLevel: lv }),

  enabledCategories: { action: true, system: true },
  setCategoryEnabled: (cat, on) =>
    set((s) => ({ enabledCategories: { ...s.enabledCategories, [cat]: on } })),

  push: (base) => {
    // gate by level/category toggles
    const min = get().minLevel;
    if (LEVEL_RANK[base.level] < LEVEL_RANK[min]) return;

    const catEnabled = get().enabledCategories[base.category];
    if (!catEnabled) return;

    const now = Date.now();
    const next: LogEntry = { id: makeId(), ts: now, repeat: 1, ...base };

    set((s) => {
      const entries = s.entries.slice();
      const last = entries[entries.length - 1];
      if (last && now - last.ts <= COALESCE_MS) {
        const same =
          last.level === next.level &&
          last.category === next.category &&
          (last.event ?? "") === (next.event ?? "") &&
          (last.message ?? "") === (next.message ?? "") &&
          (last.context ?? "") === (next.context ?? "") &&
          JSON.stringify(last.data ?? null) === JSON.stringify(next.data ?? null);
        if (same) {
          entries[entries.length - 1] = { ...last, repeat: (last.repeat ?? 1) + 1, ts: now };
          return { entries };
        }
      }
      entries.push(next);
      return { entries };
    });
  },

  clear: () => set({ entries: [] }),
}));

/* ---------- internal helper ---------- */
function _log(
  level: LogLevel,
  category: LogCategory,
  event: string,
  data?: unknown,
  context?: string,
  message?: string,
  tags?: string[]
) {
  useLogStore.getState().push({ level, category, event, data, context, message, tags });
}

/* ---------- Public API ---------- */
/** User-initiated (clicks, create/close tab, explicit actions) */
export function logAction(
  event: string,
  data?: unknown,
  context?: string,
  message?: string,
  level: LogLevel = "info",
  tags?: string[]
) {
  _log(level, "action", event, data, context, message, tags);
}

/** Internal state transitions (binding, manifests, routing, background) */
export function logSystem(
  event: string,
  data?: unknown,
  context?: string,
  message?: string,
  level: LogLevel = "info",
  tags?: string[]
) {
  _log(level, "system", event, data, context, message, tags);
}

/** Warnings & Errors */
export const logWarn  = (event: string, data?: unknown, context?: string, message?: string, tags?: string[]) =>
  _log("warn",  "system", event, data, context, message, tags);

export const logError = (event: string, data?: unknown, context?: string, message?: string, tags?: string[]) =>
  _log("error", "system", event, data, context, message, tags);

/** Optional: quick human comment */
export function logNote(
  message: string,
  opts?: { context?: string; data?: unknown; tags?: string[]; level?: LogLevel; category?: LogCategory }
) {
  const level    = opts?.level ?? "info";
  const category = opts?.category ?? "system";
  _log(level, category, "note", opts?.data, opts?.context, message, opts?.tags);
}