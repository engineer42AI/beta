// src/app/(protected)/system-b/browse-cert-specs-v4/console_ai_view.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useConsoleBusChannel } from "@/components/console/bus/useBusChannel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";

/* ====================== Types ====================== */
type Status = { running: boolean; total: number; done: number; cost: number };
const initialStatus: Status = { running: false, total: 0, done: 0, cost: 0 };

/* ====================== Per-tab sticky cache ====================== */
/** Persists last known status per AI tab so state survives tab switches. */
const LAST_STATUS = new Map<string, Status>();

/* ====================== UI bits ====================== */
function StatusInline({ s }: { s: Status }) {
  const pct = s.total > 0 ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-accent/20 px-3 py-2">
      <div className="w-48">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
          <span>{s.running ? "Processing…" : "Idle"}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />
        <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {s.done}/{s.total} traces
        </div>
      </div>
      <div className="ml-1 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Cost</span>
        <span className="font-mono tabular-nums px-2 py-[2px] rounded border bg-background">
          {s.cost.toFixed(6)}
        </span>
      </div>
    </div>
  );
}

/* ====================== Console AI View ====================== */
export default function ConsoleAiView() {
  const { activeAiTabId, binding, isLinkedToPage, feedFromPage, sendToPage } =
    useConsoleBusChannel("ai");

  // ---- query input (console-originated) ----
  const [query, setQuery] = useState(
    "Are there CS-25 rules relevant to approaches below 200 ft decision height, and why?"
  );

  // ---- status with sticky per-tab cache ----
  const [status, _setStatus] = useState<Status>(initialStatus);
  const setStatus = useCallback(
    (next: Status) => {
      _setStatus(next);
      if (activeAiTabId) LAST_STATUS.set(activeAiTabId, next);
    },
    [activeAiTabId]
  );

  // seed from cache whenever tab changes
  useEffect(() => {
    if (activeAiTabId) {
      const cached = LAST_STATUS.get(activeAiTabId) ?? initialStatus;
      _setStatus(cached);
    } else {
      _setStatus(initialStatus);
    }
  }, [activeAiTabId]);

  // ---- optimistic "running" timer (cleared on real status) ----
  const optimismTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearOptimism = () => {
    if (optimismTimer.current) {
      clearTimeout(optimismTimer.current);
      optimismTimer.current = null;
    }
  };
  useEffect(() => () => clearOptimism(), []);

  // ---- consume page → console status messages (authoritative) ----
  useEffect(() => {
    if (!feedFromPage.length) return;
    const last = feedFromPage[feedFromPage.length - 1];
    if (last.topic !== "cs25.status") return;

    const p = last.payload || {};
    setStatus({
      running: !!p.running,
      total: typeof p.total === "number" ? p.total : status.total,
      done: typeof p.done === "number" ? p.done : status.done,
      cost: typeof p.cost === "number" ? p.cost : status.cost,
    });

    // got real data → cancel optimism timeout
    clearOptimism();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedFromPage.length]); // process each new message once

  // ---- commands to page ----
  const run = useCallback(() => {
    if (!isLinkedToPage) return;

    // optimistic flip to "running"
    setStatus({ running: true, total: status.total || 0, done: status.done || 0, cost: status.cost || 0 });

    // send command
    sendToPage("cs25.run.start", { query });

    // safety: if page never acks within 2s, relax to idle
    clearOptimism();
    optimismTimer.current = setTimeout(() => {
      setStatus(prev => (prev.running ? { ...prev, running: false } : prev));
      optimismTimer.current = null;
    }, 2000);
  }, [isLinkedToPage, query, sendToPage, setStatus, status.total, status.done, status.cost]);

  const stop = useCallback(() => {
    if (!isLinkedToPage) return;
    sendToPage("cs25.run.stop");
    // let page confirm via status; no local flip here to avoid desync
  }, [isLinkedToPage, sendToPage]);

  const reset = useCallback(() => {
    if (!isLinkedToPage) return;
    // local clear + cache clear now
    setStatus(initialStatus);
    sendToPage("cs25.reset");
  }, [isLinkedToPage, setStatus, sendToPage]);

  const disabled = !isLinkedToPage;

  return (
    <div className="h-full flex flex-col gap-3 p-3">
      <div className="text-[11px] text-muted-foreground">
        tab: <code>{activeAiTabId ?? "—"}</code> · page:{" "}
        <code>{binding?.pageId?.slice(0, 8) ?? "—"}</code> · route:{" "}
        <code>{binding?.route ?? "—"}</code>
      </div>

      <Card className="p-3 space-y-3">
        <label className="block text-sm font-medium">User query</label>
        <Textarea
          className="w-full min-h-[100px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about CS-25…"
          disabled={disabled}
        />

        <div className="flex gap-3 items-center">
          <Button onClick={run} disabled={!isLinkedToPage || status.running}>
              {status.running ? "Streaming…" : "Run"}
          </Button>
          {status.running && (
            <Button variant="outline" onClick={stop} disabled={disabled} className="px-4">
              Stop
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={reset}
            disabled={disabled || status.running}
            className="px-3"
            title="Reset all results and selections"
          >
            Reset
          </Button>
          <span className="text-xs text-muted-foreground ml-2">
              Selected: <span className="font-mono tabular-nums">{status.total}</span>
          </span>
          <div className="ml-auto">
            <StatusInline s={status} />
          </div>


        </div>
      </Card>

      {!isLinkedToPage && (
        <div className="text-xs text-muted-foreground">
          This tab isn’t linked to the current page yet. Open a fresh AI tab for this route from the overlay.
        </div>
      )}
    </div>
  );
}