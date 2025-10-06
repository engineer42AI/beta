// src/stores/logger-store.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  id: string;
  ts: number;
  level: LogLevel;
  topic?: string;     // e.g. "console", "ai", "page", "auth"
  message: string;
  payload?: any;      // structured details
};

type LoggerState = {
  logs: LogEntry[];
  cap: number;

  log(level: LogLevel, message: string, options?: { topic?: string; payload?: any }): void;
  clear(): void;
};

const DEFAULT_CAP = 500;

// Choose whether to persist logs.
// For most dev/MVP flows, keep them in-memory (no persist) to avoid bloat.
// If you *want* persistence across refreshes, uncomment the persist wrapper below.

export const useLoggerStore = create<LoggerState>()(
// persist(  // <-- uncomment to persist logs
//   (set, get) => ({
  (set, get) => ({
    logs: [],
    cap: DEFAULT_CAP,

    log: (level, message, options) => {
      const entry: LogEntry = {
        id: Math.random().toString(36).slice(2, 10),
        ts: Date.now(),
        level,
        topic: options?.topic,
        message,
        payload: options?.payload,
      };

      set((s) => {
        const next =
          s.logs.length >= s.cap
            ? [...s.logs.slice(-(s.cap - 1)), entry]
            : [...s.logs, entry];

        // Mirror to dev console for convenience
        if (process.env.NODE_ENV !== "production") {
          const tag = options?.topic ? ` (${options.topic})` : "";
          // eslint-disable-next-line no-console
          console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
            `[${level}]${tag} ${message}`,
            entry.payload ?? ""
          );
        }
        return { logs: next };
      });
    },

    clear: () => set({ logs: [] }),
  })
// , { name: "global-logs", storage: createJSONStorage(() => localStorage) }  // <-- persist options if you enabled persist
// )
);