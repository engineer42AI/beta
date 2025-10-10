// src/app/(protected)/tests/orchestrator-debug/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { orchestrator, type WireEntry, type OrchestratorPublicState } from "@/lib/pageOrchestrator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { ChevronDown, Clock } from "lucide-react";
import JsonViewer from "@/components/dev/JsonViewer";
import { WF } from "@/app/(protected)/system-b/browse-cert-specs-V4/outline.handlers";

/* ── role text colors (no row fills) ───────────────────────────── */
const roleColor: Record<WireEntry["from"] | WireEntry["to"], string> = {
  page: "text-emerald-700",
  console: "text-blue-700",
  backend: "text-orange-700",
  orchestrator: "text-slate-700",
};

/* ── helper: event & runId from metadata ───────────────────────── */
function getEvent(e: WireEntry): string | undefined {
  return e?.metadata?.event as string | undefined;
}
function getRunId(e: WireEntry): string | undefined {
  return e?.metadata?.runId as string | undefined;
}
function getStep(e: WireEntry): number | undefined {
  const s = e?.metadata?.step;
  return typeof s === "number" ? s : undefined;
}

/* ── workflow trigger: start a group on workflow 'started' ─────── */
function isWorkflowStart(e: WireEntry): boolean {
  if (e.channel !== WF.OUTLINE_LOAD) return false;
  const ev = getEvent(e);
  return ev === "initialRequest" || ev === "started";
}

/* ── status helpers ─────────────────────────────────────────────── */
function rowStatusText(e: WireEntry) {
  if (typeof e.metadata?.httpStatus === "number") return String(e.metadata.httpStatus);
  if (getEvent(e) === "error") return "error";
  return "";
}
function statusClass(t: string) {
  return t === "error" ? "text-red-600"
    : /^\d{3}$/.test(t) && Number(t) >= 400 ? "text-red-600"
    : /^\d{3}$/.test(t) && Number(t) >= 300 ? "text-amber-600"
    : "text-muted-foreground";
}

/* ── group type ─────────────────────────────────────────────────── */
type WorkflowGroup = {
  id: string;                 // stable id (runId + tab)
  workflow: string;           // e.g., outline.load
  runId: string;
  tabId?: string | null;
  pageId?: string | null;
  route?: string | null;
  startedTs: number;
  status: "running" | "ok" | "error";
  httpStatus?: number | null;
  rows: WireEntry[];
};

type Opt = { value: string; label: string };

/* ── derive grouped workflows from the raw wire ─────────────────── */
function groupWire(wire: WireEntry[]): WorkflowGroup[] {
  // Only consider rows that belong to a workflow run (have runId)
  const workflowRows = wire.filter(e => getRunId(e));

  // chronological pass for grouping
  const sorted = [...workflowRows].sort((a, b) => a.ts - b.ts);

  const active = new Map<string, WorkflowGroup>();
  const groups: WorkflowGroup[] = [];

  for (const e of sorted) {
    const event = getEvent(e);
    const runId = getRunId(e)!; // we filtered for runId
    const key = `${e.tabId ?? "—"}::${runId}`;

    // ✅ start a group when we see the first starter event (initialRequest OR started)
    if (isWorkflowStart(e) && !active.get(key)) {
      const g: WorkflowGroup = {
        id: key,
        workflow: e.channel, // e.g., "outline.load"
        runId,
        tabId: e.tabId ?? null,
        pageId: e.pageId ?? null,
        route: e.route ?? null,
        startedTs: e.ts,      // note: could be initialRequest timestamp
        status: "running",
        rows: [],
      };
      groups.push(g);
      active.set(key, g);
    }

    // attach to current group if it exists
    const g = active.get(key);
    if (g) {
      g.rows.push(e);

      // keep latest context (or first non-null)
      if (e.route && !g.route) g.route = e.route;
      if (e.pageId && !g.pageId) g.pageId = e.pageId;

      const hs = typeof e.metadata?.httpStatus === "number" ? e.metadata.httpStatus : null;
      if (hs != null) g.httpStatus = hs;

      if (event === "error") g.status = "error";
      else if (event === "success") g.status = "ok";
      else if (g.status !== "error" && g.status !== "ok") g.status = "running";
    }
  }

  // Order rows inside a group by step (then ts) — newest first at the top
  for (const g of groups) {
    g.rows.sort((a, b) => {
      const sa = getStep(a), sb = getStep(b);
      if (sa != null && sb != null) return sb - sa; // step desc
      if (sa != null && sb == null) return 1;       // unknowns last
      if (sa == null && sb != null) return -1;
      return b.ts - a.ts;                            // time desc
    });
  }

  // Newest groups first by start time
  return groups.sort((a, b) => b.startedTs - a.startedTs);
}

function ColumnFilter({
  label, value, onChange, options,
}: { label: string; value: string | null; onChange: (v: string | null) => void; options: string[] }) {
  const [open, setOpen] = useState(false);
  const opts: Opt[] = options.map(v => ({ value: v, label: v }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 min-w-[180px] justify-between">
          <span className="truncate text-xs">
            <span className="text-muted-foreground">{label}: </span>
            {value ?? "All"}
          </span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-50 w-[280px] p-0">
        <Command shouldFilter>
          <CommandInput placeholder={`Filter ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No options</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => { onChange(null); setOpen(false); }}>
                All
              </CommandItem>
              {opts.map(o => (
                <CommandItem
                  key={o.value}
                  onSelect={() => { onChange(o.value); setOpen(false); }}
                >
                  <span className="font-mono text-xs">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function OrchestratorWire() {
  const [wire, setWire] = useState<WireEntry[]>(orchestrator.getWire?.() ?? []);
  const [state, setState] = useState<OrchestratorPublicState | null>(orchestrator.getState?.() ?? null);

  useEffect(() => orchestrator.subscribeWire?.(setWire), []);
  useEffect(() => orchestrator.subscribe?.((s: any) => setState(s)), []);

  const groups = useMemo(() => groupWire(wire), [wire]);

  // Filters (Workflow, Tab)
  const workflowOptions = useMemo(
    () => Array.from(new Set(groups.map(g => g.workflow))).sort(),
    [groups]
  );
  const tabOptions = useMemo(
    () => Array.from(new Set(groups.map(g => g.tabId ?? "—"))).sort(),
    [groups]
  );

  const [fWorkflow, setFWorkflow] = useState<string | null>(null);
  const [fTab, setFTab] = useState<string | null>(null);

  const visible = useMemo(
    () => groups.filter(g =>
      (!fWorkflow || g.workflow === fWorkflow) &&
      (!fTab || (g.tabId ?? "—") === fTab)
    ),
    [groups, fWorkflow, fTab]
  );

  const lastTs = wire.length ? new Date(wire[wire.length - 1]!.ts).toLocaleTimeString() : "—";

  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Orchestrator — Workflows</h1>
        <div className="flex items-center gap-3 text-xs">
          <Badge variant="outline" className="px-2 h-7 text-[11px]">
            Groups <span className="ml-1 font-mono tabular-nums">{visible.length}</span>
          </Badge>
          <Badge variant="outline" className="px-2 h-7 text-[11px] flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Last ts <span className="ml-1 font-mono tabular-nums">{lastTs}</span>
          </Badge>
        </div>
      </div>

      {/* group-level filters */}
      <div className="flex flex-wrap items-center gap-2">
        <ColumnFilter label="Workflow" value={fWorkflow} onChange={setFWorkflow} options={workflowOptions} />
        <ColumnFilter label="Tab" value={fTab} onChange={setFTab} options={tabOptions} />
      </div>

      {/* groups */}
      {visible.length === 0 ? (
        <div className="text-xs text-muted-foreground mt-4">No workflows.</div>
      ) : (
        <div className="space-y-3">
          {visible.map((g) => {
            const statusBadge =
              g.status === "ok" ? "bg-emerald-600 text-white"
              : g.status === "error" ? "bg-red-600 text-white"
              : "bg-amber-500 text-white";

            return (
              <details key={g.id} className="rounded-md border overflow-hidden open:bg-muted/5">
                {/* group header */}
                <summary className="list-none px-3 py-2 cursor-pointer grid grid-cols-[220px_1fr_auto] gap-3 items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">{g.workflow}</Badge>
                    <span className={cn("px-1.5 py-[2px] rounded-full text-[10px]", statusBadge)}>
                      {g.status}
                    </span>
                    {g.httpStatus != null && (
                      <span className={cn("font-mono text-[11px]", statusClass(String(g.httpStatus)))}>
                        HTTP {g.httpStatus}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 text-[11px] text-muted-foreground truncate">
                    <span className="mr-3">
                      route <span className="font-mono">{g.route ?? "—"}</span>
                    </span>
                    <span className="mr-3">
                      page <span className="font-mono">{g.pageId?.slice(0, 8) ?? "—"}</span>
                    </span>
                    <span>
                      tab <span className="font-mono">{g.tabId ?? "—"}</span>
                    </span>
                  </div>
                  <div className="justify-self-end font-mono tabular-nums text-[11px] text-muted-foreground">
                    {new Date(g.startedTs).toLocaleTimeString()}
                  </div>
                </summary>

                {/* table header for rows */}
                <div className="grid grid-cols-[110px_80px_110px_110px_200px_1fr_240px_120px_140px] items-center gap-0 border-y bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                  <div>Time</div>
                  <div>Status</div>
                  <div>From</div>
                  <div>To</div>
                  <div>Channel</div>
                  <div>Label</div>
                  <div>Route</div>
                  <div>Page</div>
                  <div>Tab</div>
                </div>

                {/* group rows (chronological inside the group) */}
                <div className="max-h-[60vh] overflow-auto">
                  {g.rows.map((e) => {
                    const st = rowStatusText(e);
                    return (
                      <details key={e.id} className="border-b">
                        <summary className="list-none grid grid-cols-[110px_80px_110px_110px_200px_1fr_240px_120px_140px] items-start gap-0 px-3 py-2 cursor-pointer">
                          {/* time */}
                          <div className="font-mono tabular-nums text-[11px] text-muted-foreground pr-3">
                            {new Date(e.ts).toLocaleTimeString()}
                          </div>
                          {/* status */}
                          <div className={cn("font-mono text-[11px]", statusClass(st))}>{st || "—"}</div>
                          {/* from / to */}
                          <div className={cn("font-mono text-[11px]", roleColor[e.from])}>{e.from}</div>
                          <div className={cn("font-mono text-[11px]", roleColor[e.to])}>{e.to}</div>
                          {/* channel / label */}
                          <div className="font-mono text-[11px]">{e.channel}</div>
                          <div className="truncate  text-[11px]">{e.label}</div>
                          {/* route/page/tab */}
                          <div className="truncate text-muted-foreground text-[11px]">{e.route ?? "—"}</div>
                          <div className="font-mono text-muted-foreground text-[11px]">{e.pageId?.slice(0, 8) ?? "—"}</div>
                          <div className="font-mono text-muted-foreground text-[11px]">{e.tabId ?? "—"}</div>
                        </summary>

                        {/* payload + metadata inspectors */}
                        <div className="px-3 pb-3 space-y-2">
                          {typeof e.payload !== "undefined" && (
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Payload</div>
                              <JsonViewer value={e.payload} defaultOpen={1} className="p-2" />
                            </div>
                          )}
                          {typeof e.metadata !== "undefined" && (
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Metadata</div>
                              <JsonViewer value={e.metadata} defaultOpen={1} className="p-2" />
                            </div>
                          )}
                          {typeof e.payload === "undefined" && typeof e.metadata === "undefined" && (
                            <div className="text-xs text-muted-foreground">No payload or metadata.</div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}