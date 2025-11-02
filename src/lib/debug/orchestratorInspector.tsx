// src/lib/debug/orchestratorInspector.ts
"use client";

import React, { useEffect, useMemo, useState } from "react";

/* ===================== Types & Globals ===================== */

type Rec = {
  id: number;
  channel: string;
  type: "register" | "off";
  when: number;
  stack?: string;
  fnName?: string;
};

declare global {
  interface Window {
    __orchestratorInspectorInstalled__?: boolean;
    __orchestratorInspector__?: {
      list: () => Rec[];
      stats: () => Record<string, number>;
      findDuplicates: () => Array<{ channel: string; count: number }>;
    };
  }
}

/* ===================== Installer ===================== */

export function installOrchestratorInspector(orchestrator: any) {
  if (typeof window === "undefined") return;
  if (!orchestrator) return;

  // don’t install twice
  if (window.__orchestratorInspectorInstalled__) return;
  window.__orchestratorInspectorInstalled__ = true;

  const recs: Rec[] = [];
  let nextId = 1;
  const counts = new Map<string, number>(); // channel -> handler count

  function push(type: Rec["type"], channel: string, fn?: Function) {
    const r: Rec = {
      id: nextId++,
      channel,
      type,
      when: Date.now(),
      fnName: fn?.name || undefined,
      stack:
        (new Error().stack || "")
          .split("\n")
          .slice(2, 9)
          .join("\n") || undefined,
    };
    recs.push(r);
  }

  function inc(ch: string) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  function dec(ch: string) {
    counts.set(ch, Math.max(0, (counts.get(ch) || 0) - 1));
  }

  // expose tiny API for the UI panel
  window.__orchestratorInspector__ = {
    list: () => recs.slice(),
    stats: () => {
      const out: Record<string, number> = {};
      for (const [k, v] of counts.entries()) out[k] = v;
      return out;
    },
    findDuplicates: () => {
      const arr: Array<{ channel: string; count: number }> = [];
      for (const [k, v] of counts.entries()) {
        if (v > 1) arr.push({ channel: k, count: v });
      }
      arr.sort((a, b) => b.count - a.count);
      return arr;
    },
  };

  // Patch orchestrator methods (non-destructive)
  const origRegister = orchestrator.registerHandler?.bind(orchestrator);
  const origOff = (orchestrator as any).off?.bind(orchestrator);

  if (origRegister) {
    orchestrator.registerHandler = (channel: string, fn: Function) => {
      push("register", channel, fn);
      inc(channel);
      return origRegister(channel, fn);
    };
  }

  if (origOff) {
    (orchestrator as any).off = (channel: string, fn: Function) => {
      push("off", channel, fn);
      dec(channel);
      return origOff(channel, fn);
    };
  }
}

/* ===================== UI Panel ===================== */

export function HandlersPanel({ compact = false }: { compact?: boolean }) {
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(true);
  const api = typeof window !== "undefined" ? window.__orchestratorInspector__ : undefined;

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 700);
    return () => window.clearInterval(id);
  }, [live]);

  const stats = useMemo(() => api?.stats() ?? {}, [api, tick]);
  const dups = useMemo(() => api?.findDuplicates() ?? [], [api, tick]);
  const rows = useMemo(() => (api?.list() ?? []).slice(-250).reverse(), [api, tick]); // tail only

  if (!api) {
    return (
      <div className="text-xs text-red-600">
        Orchestrator inspector not installed (dev only). Call{" "}
        <code>installOrchestratorInspector(orchestrator)</code> in your app shell (development).
      </div>
    );
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const channels = Object.keys(stats).sort((a, b) => stats[b] - stats[a]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <b>Handlers (live)</b>{" "}
          <span className="text-muted-foreground">
            · {channels.length} channels · {total} handlers
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-2 py-1 rounded border" onClick={() => setTick((t) => t + 1)}>
            Refresh
          </button>
          <button
            className={`text-xs px-2 py-1 rounded border ${live ? "" : "opacity-70"}`}
            onClick={() => setLive((v) => !v)}
          >
            Live: {live ? "On" : "Off"}
          </button>
        </div>
      </div>

      {!compact && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="rounded border">
            <div className="px-2 py-1 text-xs border-b bg-muted/30">Totals by channel</div>
            <div className="p-2 space-y-1 max-h-64 overflow-auto">
              {channels.map((ch) => (
                <div key={ch} className="flex items-center justify-between text-xs">
                  <code className="truncate">{ch}</code>
                  <span className="px-1.5 py-0.5 rounded bg-accent/40">{stats[ch]}</span>
                </div>
              ))}
              {channels.length === 0 && (
                <div className="text-xs text-muted-foreground">No handlers registered.</div>
              )}
            </div>
          </div>

          <div className="rounded border">
            <div className="px-2 py-1 text-xs border-b bg-muted/30">Potential duplicates</div>
            <div className="p-2 space-y-1">
              {dups.length === 0 && <div className="text-xs text-muted-foreground">No suspicious counts.</div>}
              {dups.map((d) => (
                <div key={d.channel} className="flex items-center justify-between text-xs">
                  <code className="truncate">{d.channel}</code>
                  <span className="px-1.5 py-0.5 rounded bg-yellow-200">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="rounded border">
        <div className="px-2 py-1 text-xs border-b bg-muted/30">Recent activity (last 250)</div>
        <div className="p-2 space-y-1 max-h-72 overflow-auto">
          {rows.length === 0 && <div className="text-xs text-muted-foreground">No activity captured yet.</div>}
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`px-1.5 py-0.5 rounded ${r.type === "register" ? "bg-emerald-100" : "bg-rose-100"}`}>
                  {r.type}
                </span>
                <code className="truncate">{r.channel}</code>
              </div>
              <div className="flex items-center gap-2">
                {r.fnName && <span className="text-[10px] text-muted-foreground">{r.fnName}</span>}
                <span className="text-[10px] text-muted-foreground">
                  {new Date(r.when).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}