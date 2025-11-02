"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/* ---------- chat bubbles ---------- */
export type ChatMsg = {
  role: "user" | "assistant" | "tool" | "system" | "topic";
  content: string;
  at: number;
};

/* ---------- compact system status ticks ---------- */
export type StatusTick = {
  text: string;
  at: number;
  scope?: "OUTLINE" | "NEEDS";
};

/* ---------- progress (persisted) ---------- */
export type ProgressPhase = "seed" | "start" | "tick" | "batch" | "done" | "aborted" | "error";
export type PersistedRun = {
  runId: string;
  tabId: string;
  firstAt: number;   // first time we saw this run (stable placement)
  lastAt: number;    // last update time
  phase: ProgressPhase;
  pct: number;
  total: number;
  done: number;
  tokensIn?: number;
  tokensOut?: number;
  batchCost?: number;
  label: string;     // derived from phase
};

type ProgressIndex = Record<string, Record<string, PersistedRun>>;
//                  ^ key = `${route}::${tabId}`   ^ runId -> run state

function labelForPhase(p: ProgressPhase) {
  switch (p) {
    case "seed":    return "Preparing…";
    case "start":   return "Starting…";
    case "tick":    return "Processing…";
    case "batch":   return "Processing…";
    case "done":    return "Completed";
    case "aborted": return "Aborted";
    case "error":   return "Error";
    default:        return "—";
  }
}
const PHASE_RANK: Record<ProgressPhase, number> = {
  seed: 0, start: 1, tick: 2, batch: 3, done: 4, aborted: 3, error: 3,
};

type ChatState = {
  messages: Record<string, ChatMsg[]>;
  statusTicks: Record<string, StatusTick[]>;
  progress: ProgressIndex;

  add: (key: string, msg: ChatMsg) => void;
  addStatus: (key: string, tick: StatusTick) => void;

  /** Upsert a progress run (guard so 'done' isn't overwritten by a later 'error') */
  upsertProgress: (key: string, patch: Partial<PersistedRun> & { runId: string; tabId: string }) => void;

  /** Mark a run stopped/aborted */
  markProgressAborted: (key: string, runId: string) => void;

  clearKey: (key: string) => void;
  clear: (route?: string, tabId?: string) => void;
  clearByTabId: (tabId: string) => void;
  clearByRoute: (route: string) => void;
};

export const useCS25ChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: {},
      statusTicks: {},
      progress: {},

      add: (key, msg) =>
        set((s) => ({
          messages: { ...s.messages, [key]: [...(s.messages[key] ?? []), msg] },
        })),

      addStatus: (key, tick) =>
        set((s) => {
          const arr = s.statusTicks[key] ?? [];
          const sec = Math.floor(tick.at / 1000);
          const exists = arr.some((t) => t.text === tick.text && Math.floor(t.at / 1000) === sec);
          const next = exists ? arr : [...arr, tick];
          return { statusTicks: { ...s.statusTicks, [key]: next } };
        }),

      upsertProgress: (key, patch) =>
        set((s) => {
          const byRun = { ...(s.progress[key] ?? {}) };
          const existing = byRun[patch.runId];

          // guard: if existing is done, don't downgrade to error/tick/etc.
          const incomingPhase = (patch.phase ?? existing?.phase ?? "seed") as ProgressPhase;
          const currentPhase = (existing?.phase ?? "seed") as ProgressPhase;
          const take =
            existing && PHASE_RANK[currentPhase] > PHASE_RANK[incomingPhase]
              ? existing
              : {
                  runId: patch.runId,
                  tabId: patch.tabId,
                  firstAt: existing?.firstAt ?? Date.now(),
                  lastAt: Date.now(),
                  phase: incomingPhase,
                  pct: patch.pct ?? existing?.pct ?? 0,
                  total: patch.total ?? existing?.total ?? 0,
                  done: patch.done ?? existing?.done ?? 0,
                  tokensIn: patch.tokensIn ?? existing?.tokensIn,
                  tokensOut: patch.tokensOut ?? existing?.tokensOut,
                  batchCost: patch.batchCost ?? existing?.batchCost,
                  label: labelForPhase(incomingPhase),
                };

          byRun[patch.runId] = take;
          return { progress: { ...s.progress, [key]: byRun } };
        }),

      markProgressAborted: (key, runId) =>
        set((s) => {
          const byRun = { ...(s.progress[key] ?? {}) };
          const ex = byRun[runId];
          if (!ex) return {};
          byRun[runId] = { ...ex, phase: "aborted", lastAt: Date.now(), label: labelForPhase("aborted") };
          return { progress: { ...s.progress, [key]: byRun } };
        }),

      clearKey: (key) =>
        set((s) => {
          const { [key]: _drop1, ...restMsgs } = s.messages;
          const { [key]: _drop2, ...restTicks } = s.statusTicks;
          const { [key]: _drop3, ...restProg } = s.progress;
          return { messages: restMsgs, statusTicks: restTicks, progress: restProg };
        }),

      clear: (route, tabId) => {
        const key = `${route ?? ""}::${tabId ?? ""}`;
        get().clearKey(key);
      },

      clearByTabId: (tabId) =>
        set((s) => {
          const suffix = `::${tabId}`;
          const outMsgs: Record<string, ChatMsg[]> = {};
          const outTicks: Record<string, StatusTick[]> = {};
          const outProg: ProgressIndex = {};
          for (const [k, v] of Object.entries(s.messages)) if (!k.endsWith(suffix)) outMsgs[k] = v;
          for (const [k, v] of Object.entries(s.statusTicks)) if (!k.endsWith(suffix)) outTicks[k] = v;
          for (const [k, v] of Object.entries(s.progress)) if (!k.endsWith(suffix)) outProg[k] = v;
          return { messages: outMsgs, statusTicks: outTicks, progress: outProg };
        }),

      clearByRoute: (route) =>
        set((s) => {
          const prefix = `${route}::`;
          const outMsgs: Record<string, ChatMsg[]> = {};
          const outTicks: Record<string, StatusTick[]> = {};
          const outProg: ProgressIndex = {};
          for (const [k, v] of Object.entries(s.messages)) if (!k.startsWith(prefix)) outMsgs[k] = v;
          for (const [k, v] of Object.entries(s.statusTicks)) if (!k.startsWith(prefix)) outTicks[k] = v;
          for (const [k, v] of Object.entries(s.progress)) if (!k.startsWith(prefix)) outProg[k] = v;
          return { messages: outMsgs, statusTicks: outTicks, progress: outProg };
        }),
    }),
    { name: "cs25-chat-v2", storage: createJSONStorage(() => localStorage) }
  )
);