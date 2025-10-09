 "use client";

import { useEffect, useMemo, useState } from "react";
import { orchestrator, type WireEntry, type OrchestratorPublicState } from "@/lib/pageOrchestrator";
import { Inspector } from "react-inspector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { ChevronDown, Clock } from "lucide-react";

/* ── role text colors (no row fills) ───────────────────────────── */
const roleColor: Record<WireEntry["from"] | WireEntry["to"], string> = {
  page: "text-emerald-700",
  zustand: "text-emerald-800",
  console: "text-blue-700",
  backend: "text-orange-700",
  orchestrator: "text-slate-700",
};

/* ── define workflow “triggers” (extend over time) ─────────────── */
const CATEGORY_TRIGGERS: Record<string, string> = {
  "page.outline.load": "PAGE_OUTLINE_LOAD",
  // add more: "page.some.workflow.start": "SOME_WORKFLOW"
};

type WorkflowGroup = {
  id: string;                 // stable id (first trigger ts + tab)
  category: string;           // e.g., PAGE_OUTLINE_LOAD
  tabId?: string | null;
  pageId?: string | null;
  route?: string | null;
  startedTs: number;
  status: "running" | "ok" | "error";
  httpStatus?: number | null;
  rows: WireEntry[];          // entries that belong to this workflow
};

type Opt = { value: string; label: string };

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

/* ── helpers for status + http status ───────────────────────────── */
function rowStatusText(e: WireEntry) {
  if (typeof e.payload?.httpStatus === "number") return String(e.payload.httpStatus);
  if (e.channel.toLowerCase().includes("error")) return "error";
  return "";
}
function statusClass(t: string) {
  return t === "error" ? "text-red-600"
    : /^\d{3}$/.test(t) && Number(t) >= 400 ? "text-red-600"
    : /^\d{3}$/.test(t) && Number(t) >= 300 ? "text-amber-600"
    : "text-muted-foreground";
}

/* ── derive grouped workflows from the raw wire ─────────────────── */
function groupWire(wire: WireEntry[]): WorkflowGroup[] {
  // Process in chronological order, then render newest groups first.
  const sorted = [...wire].sort((a, b) => a.ts - b.ts);

  // track the currently active workflow per tabId
  const activeByTab = new Map<string | null | undefined, WorkflowGroup>();

  // final groups
  const groups: WorkflowGroup[] = [];

  for (const e of sorted) {
    const cat = CATEGORY_TRIGGERS[e.channel]; // is this a trigger?
    const key = e.tabId ?? null;

    // start a new workflow if we hit a trigger
    if (cat) {
      const id = `${cat}:${key ?? "—"}:${e.ts}`;
      const g: WorkflowGroup = {
        id,
        category: cat,
        tabId: e.tabId ?? null,
        pageId: e.pageId ?? null,
        route: e.route ?? null,
        startedTs: e.ts,
        status: "running",
        rows: [],
      };
      groups.push(g);
      activeByTab.set(key, g);
    }

    // attach current row to the active workflow for this tab (if any)
    const current = activeByTab.get(key);
    if (current) {
      current.rows.push(e);

      // keep the most recent binding context (route/page) from any row
      if (e.route) current.route = e.route;
      if (e.pageId) current.pageId = e.pageId;

      // surface httpStatus if present
      const hs = typeof e.payload?.httpStatus === "number" ? e.payload.httpStatus : null;
      if (hs != null) current.httpStatus = hs;

      // update status heuristics
      if (e.channel.toLowerCase().includes("error")) {
        current.status = "error";
      } else if (e.channel === "page.outline.loaded") {
        current.status = "ok";
      } else if (current.status !== "error" && current.status !== "ok") {
        current.status = "running";
      }
    }
  }

  for (const g of groups) {
      // newest-first rows inside each group
      g.rows.sort((a, b) => b.ts - a.ts);
  }

  // Newest-first by group start
  return groups.sort((a, b) => b.startedTs - a.startedTs);
}

export default function OrchestratorWire() {
  const [wire, setWire] = useState<WireEntry[]>(orchestrator.getWire?.() ?? []);
  const [state, setState] = useState<OrchestratorPublicState | null>(orchestrator.getState?.() ?? null);

  useEffect(() => orchestrator.subscribeWire?.(setWire), []);
  useEffect(() => orchestrator.subscribe?.((s: any) => setState(s)), []);

  const groups = useMemo(() => groupWire(wire), [wire]);

  // Filters (Category, Tab)
  const categoryOptions = useMemo(
    () => Array.from(new Set(groups.map(g => g.category))).sort(),
    [groups]
  );
  const tabOptions = useMemo(
    () => Array.from(new Set(groups.map(g => g.tabId ?? "—"))).sort(),
    [groups]
  );

  const [fCategory, setFCategory] = useState<string | null>(null);
  const [fTab, setFTab] = useState<string | null>(null);

  const visible = useMemo(
    () => groups.filter(g =>
      (!fCategory || g.category === fCategory) &&
      (!fTab || (g.tabId ?? "—") === fTab)
    ),
    [groups, fCategory, fTab]
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
        <ColumnFilter label="Category" value={fCategory} onChange={setFCategory} options={categoryOptions} />
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
                    <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">{g.category}</Badge>
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

                        {/* payload inspector */}
                        <div className="px-3 pb-3">
                          <div className="rounded-md border bg-background/60">
                            <div className="px-2 py-1.5 text-[11px] text-muted-foreground border-b">Payload</div>
                            <div className="p-2 overflow-auto">
                              <Inspector
                                theme="chromeLight"
                                table={false}
                                expandLevel={1}
                                sortObjectKeys
                                showNonenumerable={false}
                                data={e.payload ?? {}}
                              />
                            </div>
                          </div>
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