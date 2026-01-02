"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLogStore, type LogEntry, logNote } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardCopy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LogPanel() {
  const entries = useLogStore((s) => s.entries);
  const clear = useLogStore((s) => s.clear);

  // filters
  const [q, setQ] = useState("");
  const [ctxFilter, setCtxFilter] = useState("");
  const [showDebug, setShowDebug] = useState(true);
  const [showInfo, setShowInfo] = useState(true);
  const [showWarn, setShowWarn] = useState(true);
  const [showError, setShowError] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  // expand state per row
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((m) => ({ ...m, [id]: !m[id] }));

  // quick note composer
  const [note, setNote] = useState("");

  // layout refs
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // measure header → CSS var (--log-head-h)
  useEffect(() => {
    const head = headRef.current;
    const root = rootRef.current;
    if (!head || !root) return;

    const ro = new ResizeObserver(() => {
      const h = Math.ceil(head.getBoundingClientRect().height);
      root.style.setProperty("--log-head-h", `${h}px`);
    });
    ro.observe(head);
    const h = Math.ceil(head.getBoundingClientRect().height);
    root.style.setProperty("--log-head-h", `${h}px`);
    return () => ro.disconnect();
  }, []);

  // derived rows
  const filtered = useMemo(() => {
    const byLevel = new Set<LogEntry["level"]>([
      ...(showDebug ? (["debug"] as const) : []),
      ...(showInfo ? (["info"] as const) : []),
      ...(showWarn ? (["warn"] as const) : []),
      ...(showError ? (["error"] as const) : []),
    ]);

    const qx = q.trim().toLowerCase();
    const cx = ctxFilter.trim().toLowerCase();

    return entries.filter((e) => {
      if (!byLevel.has(e.level)) return false;
      if (cx && !(e.context ?? "").toLowerCase().includes(cx)) return false;
      if (!qx) return true;

      const blob =
        (e.message ?? "") +
        " " +
        (e.event ?? "") +
        " " +
        (e.context ?? "") +
        " " +
        ((e.tags ?? []).join(" ")) +
        " " +
        (typeof e.data === "string" ? e.data : JSON.stringify(e.data ?? {}));
      return blob.toLowerCase().includes(qx);
    });
  }, [entries, q, ctxFilter, showDebug, showInfo, showWarn, showError]);

  // autoscroll on new rows
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [filtered, autoScroll]);

  // copy single row JSON
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = async (row: LogEntry) => {
    await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  // level badge
  const LevelBadge = ({ level }: { level: LogEntry["level"] }) => (
    <span
      className={cn(
        "px-1.5 py-[2px] rounded-full text-[11px]",
        level === "error" && "bg-red-600 text-white",
        level === "warn" && "bg-amber-500 text-white",
        level === "info" && "bg-blue-600 text-white",
        level === "debug" && "bg-muted text-foreground/70"
      )}
    >
      {level}
    </span>
  );

  // tag bubble
  const Tag = ({ t }: { t: string }) => (
    <span className="px-1 py-[1px] rounded bg-muted text-[10px] text-muted-foreground mr-1">
      {t}
    </span>
  );

  return (
    <div
      ref={rootRef}
      className="relative h-full min-h-0"
      style={{ ["--log-head-h" as any]: "44px" }}
    >
      {/* Header / toolbar (measured) */}
      <div
        ref={headRef}
        className="absolute left-0 right-0 top-0 z-10 border-b bg-background/95 backdrop-blur px-2"
      >
        <div className="min-h-11 w-full flex items-center gap-2 py-1">
          <Input
            placeholder="Search logs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-56"
          />
          <div className="flex items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1">
              <Checkbox checked={showDebug} onCheckedChange={(v) => setShowDebug(!!v)} />
              <span>debug</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <Checkbox checked={showInfo} onCheckedChange={(v) => setShowInfo(!!v)} />
              <span>info</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <Checkbox checked={showWarn} onCheckedChange={(v) => setShowWarn(!!v)} />
              <span>warn</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <Checkbox checked={showError} onCheckedChange={(v) => setShowError(!!v)} />
              <span>error</span>
            </label>
          </div>

          <Input
            placeholder="Context filter (e.g. console/ui)"
            value={ctxFilter}
            onChange={(e) => setCtxFilter(e.target.value)}
            className="h-8 w-64"
          />

          <label className="ml-auto mr-2 text-xs inline-flex items-center gap-2">
            <Checkbox checked={autoScroll} onCheckedChange={(v) => setAutoScroll(!!v)} />
            <span>autoscroll</span>
          </label>

          <Button size="sm" variant="outline" onClick={() => clear()}>
            Clear
          </Button>
        </div>

        {/* quick note composer */}
        <div className="pb-2 flex gap-2">
          <Input
            placeholder="Add a note to the log…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8"
          />
          <Button
            size="sm"
            onClick={() => {
              if (!note.trim()) return;
              logNote(note.trim(), { context: "note" });
              setNote("");
            }}
          >
            Add note
          </Button>
        </div>
      </div>

      {/* Scrollable body (absolute) */}
      <div
        ref={scrollRef}
        className="absolute left-0 right-0 bottom-0 overflow-auto"
        style={{ top: "var(--log-head-h)", scrollbarGutter: "stable" }}
      >
        <table className="w-full text-xs">
          {/* no whitespace children inside colgroup to avoid hydration issues */}
          <colgroup><col style={{width:110}}/><col style={{width:72}}/><col style={{width:200}}/><col/></colgroup>
          <thead className="sticky top-0 bg-muted/50 backdrop-blur border-b">
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left px-2 py-2">time</th>
              <th className="text-left px-2 py-2">level</th>
              <th className="text-left px-2 py-2">context</th>
              <th className="text-left px-2 py-2">message / event / data</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-muted-foreground">
                  (no logs)
                </td>
              </tr>
            ) : (
              filtered.map((e) => {
                const isOpen = !!open[e.id];
                return (
                  <tr key={e.id} className={cn("border-b last:border-b-0 align-top")}>
                    <td className="px-2 py-1 whitespace-nowrap tabular-nums text-muted-foreground">
                      {new Date(e.ts).toLocaleTimeString()}
                    </td>
                    <td className="px-2 py-1"><LevelBadge level={e.level} /></td>
                    <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{e.context ?? "—"}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-start gap-2">
                        <button
                          className="mt-[2px] text-muted-foreground hover:text-foreground"
                          onClick={() => toggle(e.id)}
                          title={isOpen ? "Collapse" : "Expand"}
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <div className="font-medium text-foreground break-words">
                              {e.message ?? e.event}
                              {e.repeat && e.repeat > 1 && (
                                <span className="ml-2 text-[10px] px-1 rounded bg-muted text-muted-foreground">
                                  ×{e.repeat}
                                </span>
                              )}
                            </div>
                            {e.message ? (
                              <div className="text-[11px] text-muted-foreground">({e.event})</div>
                            ) : null}
                          </div>

                          {(e.tags?.length ?? 0) > 0 && (
                            <div className="mt-1">
                              {e.tags!.map((t) => <Tag key={t} t={t} />)}
                            </div>
                          )}

                          {isOpen && e.data != null && (
                            <pre className="mt-2 text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
                              {typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2)}
                            </pre>
                          )}
                        </div>

                        {/* copy JSON */}
                        <button
                          onClick={() => copy(e)}
                          className="self-start p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Copy JSON"
                        >
                          {copiedId === e.id ? (
                            <Check className="w-3 h-3 text-green-600" />
                          ) : (
                            <ClipboardCopy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}