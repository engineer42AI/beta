// src/app/(protected)/system-b/browse-cert-specs-V4/OutlineUI.tsx

'use client';

import React, { useMemo, useState } from "react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose } from "@/components/ui/drawer";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { resolveOutlineDetails } from "./outline.handlers"; // NEW

import { BookOpenText } from "lucide-react";

const cbCls = [
  "h-4 w-4 shrink-0 rounded-[6px]",
  "border border-border bg-card transition-colors",

  // ✅ Softer checked color: uses accent instead of pure foreground
  "data-[state=checked]:bg-[color-mix(in_oklab,hsl(var(--foreground))_70%,hsl(var(--background))_10%)]",
  "data-[state=checked]:border-[color-mix(in_oklab,hsl(var(--foreground))_60%,hsl(var(--background))_20%)]",
  "data-[state=checked]:text-background",

  // ✅ Softer indeterminate state too
  "data-[state=indeterminate]:bg-[color-mix(in_oklab,hsl(var(--foreground))_60%,hsl(var(--background))_20%)]",
  "data-[state=indeterminate]:border-[color-mix(in_oklab,hsl(var(--foreground))_50%,hsl(var(--background))_30%)]",
  "data-[state=indeterminate]:text-background",

  "hover:border-foreground/50",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "focus-visible:ring-offset-1 focus-visible:ring-offset-background",
].join(" ");

/* ---------------- Local Types (aligned with page.tsx) ---------------- */
export type OutlineNode = {
  type: 'Subpart' | 'Heading' | 'Section';
  uuid: string;
  label?: string;
  number?: string;
  title?: string;
  paragraph_id?: string;
  children?: OutlineNode[];

  // NEW: intent(s) your backend may attach to Section
  intent?: { uuid?: string; summary?: string; intent?: string; events?: any } | null;
  intents?: Array<{ uuid?: string; summary?: string; intent?: string; events?: any }>;
};

export type TraceRow = {
  trace_uuid: string;
  bottom_uuid: string;
  bottom_paragraph_id?: string;
  path_labels: string[];
  results?: any[];
};

export type NodeStats = { total: number; relevant: number; notRelevant: number };


/* ---------------- Pure helpers (only used inside this module) ---------------- */


const zeroStats = (): NodeStats => ({ total: 0, relevant: 0, notRelevant: 0 });

function addStats(a: NodeStats, b: NodeStats): NodeStats {
  return { total: a.total + b.total, relevant: a.relevant + b.relevant, notRelevant: a.notRelevant + b.notRelevant };
}

function collectSectionIds(node: OutlineNode): string[] {
  const out: string[] = [];
  const stack: OutlineNode[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.type === 'Section') out.push(cur.uuid);
    (cur.children ?? []).forEach((c) => stack.push(c));
  }
  return out;
}

function collectTraceIdsForSections(sectionIds: string[], sectionTraces: Record<string, TraceRow[]>): string[] {
  const ids: string[] = [];
  for (const sid of sectionIds) {
    const rows = sectionTraces[sid] ?? [];
    for (const r of rows) ids.push(r.trace_uuid);
  }
  return ids;
}

function selectionStateForNode(
  node: OutlineNode,
  sectionTraces: Record<string, TraceRow[]>,
  selected: Set<string>
) {
  const sectionIds = collectSectionIds(node);
  const traceIds = collectTraceIdsForSections(sectionIds, sectionTraces);
  if (traceIds.length === 0) return { total: 0, checked: false, indeterminate: false, ids: traceIds };
  let selectedCount = 0;
  for (const id of traceIds) if (selected.has(id)) selectedCount++;
  const checked = selectedCount === traceIds.length;
  const indeterminate = selectedCount > 0 && selectedCount < traceIds.length;
  return { total: traceIds.length, checked, indeterminate, ids: traceIds };
}

function normalizeTracePath(labels: string[]): string[] {
  if (!labels || labels.length === 0) return [];
  const rest = labels.slice(1);
  return rest.map(l => l.replace(/\(([A-Za-z]+)\)/g, (_, g1) => `(${g1.toLowerCase()})`));
}

function useLatestResult(row: TraceRow) {
  const latest = row.results && row.results.length ? row.results[row.results.length - 1] : undefined;
  const rel: boolean | undefined = latest?.response?.relevant;
  const rat: string | undefined = latest?.response?.rationale;
  const cost: number | undefined = latest?.usage?.total_cost;
  return { latest, rel, rat, cost };
}

/* ---------------- Drawer renderer ---------------- */
type ResolvedPayload =
  | { type: 'section'; meta: any; intent?: any; intents?: any[] }
  | { type: 'trace'; meta: any; intent?: any; hierarchy?: any[]; citations?: any[]; citations_page?: any };

/* --- helper: flatten whatever the backend sends for citations --- */
function niceTraceTitle(data: any): string {
  if (!data || data.type !== 'trace') return "…";
  // Prefer meta label/paragraph, then bottom paragraph from hierarchy, then uuid shortened
  const h = Array.isArray(data.hierarchy) ? data.hierarchy : [];
  const bottom = h[h.length - 1];
  const para = bottom?.paragraph_id ?? bottom?.label ?? bottom?.number ?? "";
  const metaT = data.meta?.label ?? data.meta?.paragraph_id ?? "";
  const raw = metaT || para || data.meta?.uuid || "";
  return raw ? String(raw) : "…";
}

function DetailDrawerShell({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        // keep it wide like you had, but make height logic consistent
        className="w-screen max-w-none border-t p-0"
      >
        {/* We do header (fixed-ish) + scroll body.
           The wrapper below imposes max height and internal scroll.
        */}
        <div className="flex flex-col max-h-[70vh] pb-[env(safe-area-inset-bottom)] bg-background">
          {/* Header */}
          <div className="shrink-0 h-10 px-4 sm:px-5 flex items-center border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <DrawerTitle className="text-[13px] font-semibold truncate">
              {title}
            </DrawerTitle>
          </div>

          {/* Scroll body */}
          <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-5 py-3 text-[13px] leading-5 selection:bg-accent/60">
            {children}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}



function DrawerBody({ data }: { data: ResolvedPayload | null }) {
  // ⬇ keep all helper fns you already had (ROLE_LABEL, ROLE_BADGE, etc.)
  // I'll keep your logic, just tweak container classes.

  if (!data) return null;

  // ---- chips + helpers ----
  const ROLE_LABEL: Record<string, string> = {
    scope_setter: "Scope",
    normative_requirement: "Requirement",
    condition_clause: "Condition",
    exception_clause: "Exception",
    definition: "Definition",
    reference_only: "Reference",
    reserved: "Reserved",
    guidance: "Guidance",
  };
  const ROLE_BADGE: Record<string, string> = {
    scope_setter: "bg-indigo-100 text-indigo-900 border-indigo-200",
    normative_requirement: "bg-emerald-100 text-emerald-900 border-emerald-200",
    condition_clause: "bg-amber-100 text-amber-900 border-amber-200",
    exception_clause: "bg-rose-100 text-rose-900 border-rose-200",
    definition: "bg-sky-100 text-sky-900 border-sky-200",
    reference_only: "bg-slate-100 text-slate-900 border-slate-200",
    reserved: "bg-gray-100 text-gray-900 border-gray-200",
    guidance: "bg-purple-100 text-purple-900 border-purple-200",
  };
  const UUID_RE = /^[0-9a-f-]{20,}$/i;
  const shortId = (s?: string) =>
    !s ? "" : UUID_RE.test(s) ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;

  function RoleChip({ role }: { role?: string }) {
    const nice = ROLE_LABEL[role || ""] || role || "—";
    const cls =
      ROLE_BADGE[role || ""] ||
      "bg-muted text-foreground/80 border-border";
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium ${cls}`}
      >
        {nice}
      </span>
    );
  }

  function TinyToken({ children }: { children: React.ReactNode }) {
    return (
      <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] border border-border">
        {children}
      </span>
    );
  }

  // ---- citations normalizer ----
  type FlatCitation = {
    direction?: "inbound" | "outbound" | string;
    source?: string;
    target?: string;
    role?: string;
    comment?: string;
    clause?: string;
    ref_source?: string;
    ref_target?: string;
  };

  function flattenCitations(raw: any[]): FlatCitation[] {
    if (!Array.isArray(raw)) return [];
    const out: FlatCitation[] = [];
    for (const c of raw) {
      if (Array.isArray(c?.inbound_cites)) {
        c.inbound_cites.forEach((x: any) =>
          out.push({ direction: "inbound", ...x, ...x.ref })
        );
      } else if (Array.isArray(c?.outbound_cites)) {
        c.outbound_cites.forEach((x: any) =>
          out.push({ direction: "outbound", ...x, ...x.ref })
        );
      } else {
        out.push({ ...c, ...c.ref });
      }
    }
    return out.map((x) => ({
      direction: x.direction,
      source: (x as any).ref_source ?? x.source,
      target: (x as any).ref_target ?? x.target,
      role: x.role,
      comment: x.comment,
      clause: (x as any).clause ?? (x as any).paragraph_id,
    }));
  }

  // ====================== SECTION ======================
  if (data.type === "section") {
    const intents =
      (data.intents?.length ? data.intents : data.intent ? [data.intent] : []) ??
      [];
    const merged = {
      summary: intents.find((i: any) => i?.summary)?.summary,
      intent: intents.find((i: any) => i?.intent)?.intent,
      events: intents.flatMap((i: any) =>
        Array.isArray(i?.events) ? i.events : []
      ),
    };

    // NOTE:
    // We drop all fixed vh heights here.
    // Cards can grow naturally, and the *drawer shell* scrolls overall.
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Summary + Intent */}
        <div className="rounded-md border bg-card p-3 flex flex-col gap-3">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1">
              Summary
            </div>
            {merged.summary ? (
              <p className="text-[13px] leading-5">{merged.summary}</p>
            ) : (
              <p className="italic text-muted-foreground text-[13px] leading-5">
                No summary.
              </p>
            )}
          </div>
          <div className="border-t border-border pt-2">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">
              Intent
            </div>
            {merged.intent ? (
              <p className="text-[13px] leading-5 whitespace-pre-wrap">
                {merged.intent}
              </p>
            ) : (
              <p className="italic text-muted-foreground text-[13px] leading-5">
                No intent.
              </p>
            )}
          </div>
        </div>

        {/* Events */}
        <div className="rounded-md border bg-card p-3 flex flex-col">
          <div className="text-[10px] uppercase text-muted-foreground mb-2">
            Events
          </div>
          {merged.events.length === 0 ? (
            <div className="italic text-muted-foreground text-[13px] leading-5">
              (none)
            </div>
          ) : (
            <ul className="space-y-2">
              {merged.events.map((e: any, i: number) => (
                <li
                  key={i}
                  className="rounded border p-2.5 bg-background text-[13px] leading-5"
                >
                  {String(e)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ====================== TRACE ======================
  const h = Array.isArray((data as any).hierarchy)
    ? (data as any).hierarchy
    : [];
  const cites = flattenCitations((data as any).citations ?? []);

  // local state INSIDE DrawerBody was causing rerenders of OutlineTree.
  // We'll keep this, it's fine. This state doesn't break layout.
  const [dir, setDir] = React.useState<"all" | "inbound" | "outbound">("all");
  const filtered = cites.filter(
      (c) => dir === "all" || c.direction === dir
  );

  return (
    <Tabs defaultValue="intent" className="flex flex-col gap-3">
      {/* Tabs header */}
      <div className="flex items-center justify-between">
        <TabsList className="h-8">
          <TabsTrigger value="intent" className="px-2.5 py-1 text-[12px]">
            Intent
          </TabsTrigger>

          <TabsTrigger value="hierarchy" className="px-2.5 py-1 text-[12px]">
            Hierarchy
          </TabsTrigger>

          <TabsTrigger value="citations" className="px-2.5 py-1 text-[12px]">
            Citations{" "}
            {cites?.length ? (
              <Badge className="ml-1 h-5 px-1.5 text-[11px]">
                {cites.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </div>

      <Separator />

      {/* INTENT */}
      <TabsContent value="intent">
        <div className="rounded-md border bg-card p-3">
          {data.intent ? (
            <>
              {data.intent.summary && (
                <p className="mb-2 text-[13px] leading-5">
                  {data.intent.summary}
                </p>
              )}
              {data.intent.intent && (
                <p className="text-[13px] leading-5 whitespace-pre-wrap">
                  {data.intent.intent}
                </p>
              )}
              {Array.isArray(data.intent.events) &&
                data.intent.events.length > 0 && (
                  <>
                    <div className="text-[10px] uppercase text-muted-foreground mt-3 mb-1">
                      Events
                    </div>
                    <ul className="space-y-2">
                      {data.intent.events.map((e: any, i: number) => (
                        <li
                          key={i}
                          className="rounded border p-2.5 bg-background text-[13px] leading-5"
                        >
                          {String(e)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

              {!data.intent.summary &&
                !data.intent.intent &&
                !Array.isArray(data.intent.events) && (
                  <p className="italic text-muted-foreground text-[13px] leading-5">
                    No intent.
                  </p>
                )}
            </>
          ) : (
            <p className="italic text-muted-foreground text-[13px] leading-5">
              No intent.
            </p>
          )}
        </div>
      </TabsContent>

      {/* HIERARCHY */}
      <TabsContent value="hierarchy">
        <div className="rounded-md border bg-card p-3">
          {h.length === 0 ? (
            <p className="italic text-muted-foreground text-[13px] leading-5">
              No hierarchy.
            </p>
          ) : (
            <div className="relative">
              <div className="absolute left-3 top-0 bottom-0 w-px border-l border-dashed border-border" />
              <ul className="space-y-2">
                {h.map((n: any, idx: number) => {
                  const isBottom = idx === h.length - 1;
                  return (
                    <li
                      key={n.uuid || idx}
                      className="relative pl-8 text-[13px] leading-5"
                    >
                      <span
                        className={`absolute left-2 top-3 h-2.5 w-2.5 rounded-full bg-muted border border-border ${
                          isBottom ? "ring-2 ring-primary/60" : ""
                        }`}
                      />
                      <div className="rounded-md border bg-background">
                        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                          <span className="text-[10px] font-semibold tracking-wide text-muted-foreground">
                            {(n.ntype || n.node_ntype || "Node")
                              .toString()
                              .toUpperCase()}
                          </span>
                          <TinyToken>
                            {n.paragraph_id ??
                              n.label ??
                              n.number ??
                              n.title ??
                              shortId(n.uuid)}
                          </TinyToken>
                          {n.classification && (
                            <RoleChip role={n.classification} />
                          )}
                          {isBottom && (
                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-900">
                              Bottom clause
                            </span>
                          )}
                        </div>
                        {n.classification_reason && (
                          <div className="px-3 pb-2">
                            <div className="rounded bg-muted/40 px-2 py-1.5 text-[12px] leading-5">
                              {n.classification_reason}
                            </div>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </TabsContent>

      {/* CITATIONS */}
      <TabsContent value="citations">
        <div className="rounded-md border bg-card">
          {/* filters */}
          <div className="p-2.5 flex flex-wrap items-center gap-2 border-b text-[12px]">
              {(["all", "inbound", "outbound"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDir(d)}
                  className={`px-2 py-1 rounded border ${
                    dir === d
                      ? "bg-accent border-primary"
                      : "bg-background border-border hover:bg-accent/40"
                  }`}
                >
                  {d}
                </button>
              ))}

              <div className="ml-auto text-[11px] text-muted-foreground">
                {filtered.length} shown
              </div>
          </div>

          {/* table */}
          <div className="p-2.5 overflow-x-auto">
            {filtered.length === 0 ? (
              <p className="italic text-muted-foreground text-[13px] leading-5">
                No citations.
              </p>
            ) : (
              <table className="w-full text-[13px] border border-border">
                <thead className="bg-accent text-accent-foreground">
                  <tr>
                    <th className="text-left p-2 border-b">Dir</th>
                    <th className="text-left p-2 border-b">Source</th>
                    <th className="text-left p-2 border-b">Target</th>
                    <th className="text-left p-2 border-b">Role</th>
                    <th className="text-left p-2 border-b">Context</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr
                      key={i}
                      className="odd:bg-muted/20 align-top text-[12px] leading-4"
                    >
                      <td className="p-2">
                        <TinyToken>{c.direction}</TinyToken>
                      </td>
                      <td className="p-2">{shortId(c.source)}</td>
                      <td className="p-2">{shortId(c.target)}</td>
                      <td className="p-2">
                        <RoleChip role={c.role} />
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {c.comment ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}



function StatPills({ s }: { s?: NodeStats }) {
  if (!s) return null;
  return (
    <div className="ml-auto flex items-center gap-1 w-[96px] justify-end" aria-label="section stats">
      <Badge variant="outline" className="h-6 min-w-6 px-2 rounded-full flex items-center justify-center">
        <span className="tabular-nums">{s.total}</span>
      </Badge>
      <Badge className="h-6 min-w-6 px-2 rounded-full flex items-center justify-center bg-emerald-600 text-white">
        <span className="tabular-nums">{s.relevant}</span>
      </Badge>
      <Badge variant="destructive" className="h-6 min-w-6 px-2 rounded-full flex items-center justify-center">
        <span className="tabular-nums">{s.notRelevant}</span>
      </Badge>
    </div>
  );
}



function RelevanceDot({ v }: { v: boolean | undefined }) {
  const cls =
    v === true ? "bg-emerald-600" : v === false ? "bg-red-500" : "bg-muted-foreground/40";
  const label = v === true ? "Relevant" : v === false ? "Not relevant" : "—";
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} title={label} aria-label={label} />
      <span className="hidden sm:inline text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function SectionTraceTableCompact({
  rows,
  selectedTraces,
  setSelectedTraces,
  onOpenTrace,
  disabled, // NEW
}: {
  rows: TraceRow[];
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenTrace: (uuid: string, bottom_uuid?: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="trace-table rounded-lg border overflow-hidden mb-4">
      {/* Compact 4-column grid (checkbox, traces, relevance, rationale) */}
      <div className="grid grid-cols-[26px,1fr,120px,1.2fr] items-center text-[11px] font-medium bg-accent/60 text-accent-foreground px-3 py-1.5 sticky top-0 z-10">
        <div />
        <div>Traces</div>
        <div>Relevance</div>
        <div>Rationale</div>
      </div>

      <div>
        {rows.map((r) => {
          const { rel, rat } = useLatestResult(r);
          const path = normalizeTracePath(r.path_labels || []);

          return (
            <div
              key={r.trace_uuid}
              className="trace-row grid grid-cols-[26px,1fr,120px,1.2fr] items-start px-3 py-1.5 text-[12px] leading-snug relative hover:bg-accent/30 transition-colors"
            >
              {/* checkbox */}
              <div className="pt-1">
                  <Checkbox
                    disabled={disabled} // <- ⛔ lock UI
                    checked={selectedTraces.has(r.trace_uuid)}
                    onCheckedChange={(v) => {
                      if (disabled) return; // guard at handler level too
                      const next = v === true;
                      setSelectedTraces((prev) => {
                        const s = new Set(prev);
                        next ? s.add(r.trace_uuid) : s.delete(r.trace_uuid);
                        return s;
                      });
                    }}
                    className={`${cbCls} h-3.5 w-3.5`}   // ← ensures square corners like the rest
                  />
              </div>

              {/* Traces cell: pills + icon */}
              <div className="flex items-center gap-1 min-w-0 relative">
                  <div className="flex flex-wrap items-center gap-1 min-w-0 flex-1 pr-8">
                    {path.map((p, idx) => {
                      const isLast = idx === path.length - 1;
                      return (
                        <span
                          key={idx}
                          className={`badge-pill chip ${isLast ? "is-bottom" : ""}`}
                          title={p}
                        >
                          {p}
                        </span>
                      );
                    })}
                  </div>

                  {/* Info icon (right side, larger + cleaner) */}
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-md hover:bg-accent/40 transition-colors"
                          aria-label="Trace details"
                          onClick={() => onOpenTrace(r.trace_uuid, r.bottom_uuid)}
                        >
                          <BookOpenText className="h-4.5 w-4.5 text-muted-foreground" strokeWidth={1.5} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        View trace intent, hierarchy & citations
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
              </div>

              {/* Relevance */}
              <div className="pl-1 pt-1">
                <RelevanceDot v={rel} />
              </div>

              {/* Rationale */}
              <div className="px-2 text-[11px] text-muted-foreground leading-snug line-clamp-2">
                {rat ? (
                  <span title={rat} className="text-foreground/90">
                    {rat}
                  </span>
                ) : (
                  <span className="italic text-muted-foreground/70">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Public component ---------------- */
export function OutlineTree({
  subparts,
  sectionTraces,
  sectionStats,
  selectedTraces,
  setSelectedTraces,
  disabled, // NEW
}: {
  subparts: OutlineNode[];
  sectionTraces: Record<string, TraceRow[]>;
  sectionStats: Record<string, NodeStats>;
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
  disabled?: boolean;
}) {

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerData, setDrawerData] = useState<ResolvedPayload | null>(null);
  const [drawerErr, setDrawerErr] = useState<string | null>(null);

  // NEW: keep the intented kind explicitly ("section" | "trace")
  const [drawerKind, setDrawerKind] = useState<'section' | 'trace' | null>(null);

  async function openDetailsForSection(uuid: string) {
      setDrawerKind('section');            // <- set before fetch
      setDrawerErr(null); setDrawerLoading(true); setDrawerOpen(true);
      try {
        const resp = await resolveOutlineDetails({ uuid });
        // if backend sends a different casing, normalize and keep kind in sync
        const t = String((resp as any)?.type ?? 'section').toLowerCase();
        setDrawerKind(t === 'trace' ? 'trace' : 'section');
        setDrawerData(resp as ResolvedPayload);
      } catch (e: any) {
        setDrawerErr(e?.message || "Failed to load details");
        setDrawerData(null);
      } finally {
        setDrawerLoading(false);
      }
  }

  async function openDetailsForTrace(uuid: string, bottom_uuid?: string) {
      setDrawerKind('trace');              // <- set before fetch
      setDrawerErr(null); setDrawerLoading(true); setDrawerOpen(true);
      try {
        const resp = await resolveOutlineDetails({ uuid, bottom_uuid });
        const t = String((resp as any)?.type ?? 'trace').toLowerCase();
        setDrawerKind(t === 'trace' ? 'trace' : 'section'); // stays 'trace' if backend is correct
        setDrawerData(resp as ResolvedPayload);
      } catch (e: any) {
        setDrawerErr(e?.message || "Failed to load details");
        setDrawerData(null);
      } finally {
        setDrawerLoading(false);
      }
  }



  return (
    <>
        <Accordion type="multiple" className="w-full space-y-2">
          {subparts.map((sp) => (
            <SubpartAccordion
              key={sp.uuid}
              subpart={sp}
              sectionTraces={sectionTraces}
              sectionStats={sectionStats}
              selectedTraces={selectedTraces}
              setSelectedTraces={setSelectedTraces}
              onOpenSection={openDetailsForSection}   // ✅ add
              onOpenTrace={openDetailsForTrace}       // ✅ add
              disabled={disabled} // pass down
            />
          ))}
        </Accordion>

        {/* Drawer */}
        <DetailDrawerShell
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={
            drawerKind === "trace"
              ? `Trace — ${niceTraceTitle(drawerData)}`
              : `Section — ${
                  drawerData?.meta?.label ??
                  drawerData?.meta?.number ??
                  drawerData?.meta?.uuid ??
                  "…"
                }`
          }
        >
          {drawerLoading && (
            <div className="w-full h-[30vh] grid place-items-center text-xs text-muted-foreground">
              Loading…
            </div>
          )}

          {drawerErr && (
            <div className="w-full h-[30vh] grid place-items-center text-xs text-destructive">
              {drawerErr}
            </div>
          )}

          {!drawerLoading && !drawerErr && (
            <DrawerBody data={drawerData} />
          )}
        </DetailDrawerShell>
    </>
  );
}

/* ---------------- Internal subcomponents ---------------- */
function SubpartAccordion({
  subpart,
  sectionTraces,
  sectionStats,
  selectedTraces,
  setSelectedTraces,
  onOpenSection, onOpenTrace, // <- add
  disabled, // NEW
}: {
  subpart: OutlineNode;
  sectionTraces: Record<string, TraceRow[]>;
  sectionStats: Record<string, NodeStats>;
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenSection: (uuid: string) => void;          // <- add
  onOpenTrace: (uuid: string, bottom_uuid?: string) => void; // <- add
  disabled?: boolean;
}) {
  const agg = useMemo(() => {
    const sum = zeroStats();
    const stack = [subpart];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.type === 'Section') {
        const s = sectionStats[node.uuid] || zeroStats();
        sum.total += s.total; sum.relevant += s.relevant; sum.notRelevant += s.notRelevant;
      }
      for (const c of node.children ?? []) stack.push(c);
    }
    return sum;
  }, [subpart, sectionStats]);

  const sel = selectionStateForNode(subpart, sectionTraces, selectedTraces);

  return (
    <AccordionItem value={String(subpart.uuid)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
              disabled={disabled} // <- ⛔ lock UI
              checked={sel.indeterminate ? "indeterminate" : sel.checked}
              onCheckedChange={(v) => {
                if (disabled) return; // guard at handler level too
                const next = v === true;
                setSelectedTraces(prev => {
                  const s = new Set(prev);
                  for (const id of sel.ids) next ? s.add(id) : s.delete(id);
                  return s;
                });
              }}
              className={cbCls}
          />
          <AccordionTrigger className="flex-1 text-left px-2 py-1 rounded hover:no-underline hover:bg-accent/40 truncate">
            {subpart.label
                ?? (subpart as any).code
                ? `SUBPART ${(subpart as any).code}${subpart.title ? ` – ${subpart.title}` : ""}`
                : subpart.title ?? "Subpart"}
          </AccordionTrigger>
        </div>
        <StatPills s={agg} />
      </div>

      <AccordionContent className="mt-2 pl-6 space-y-2">
        <div className="zebra-list rounded-md overflow-hidden">
          {(subpart.children ?? []).map((child) =>
            child.type === 'Section' ? (
              <SectionCollapsible
                key={child.uuid}
                section={child}
                sectionTraces={sectionTraces}
                sectionStats={sectionStats}
                selectedTraces={selectedTraces}
                setSelectedTraces={setSelectedTraces}
                onOpenSection={onOpenSection}  // <- pass
                onOpenTrace={onOpenTrace}      // <- pass
                disabled={disabled}           // ✅ forward
              />
            ) : child.type === 'Heading' ? (
              <HeadingCollapsible
                key={child.uuid}
                heading={child}
                sectionTraces={sectionTraces}
                sectionStats={sectionStats}
                selectedTraces={selectedTraces}
                setSelectedTraces={setSelectedTraces}
                onOpenSection={onOpenSection}  // <- pass
                onOpenTrace={onOpenTrace}      // <- pass
                disabled={disabled}           // ✅ forward
              />
            ) : (
              <div key={child.uuid} className="ml-2 text-sm text-muted-foreground">
                {child.label}
              </div>
            )
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function SectionCollapsible({
  section,
  sectionTraces,
  sectionStats,
  selectedTraces,
  setSelectedTraces,
  onOpenSection, onOpenTrace, // <- add
  disabled, // NEW
}: {
  section: OutlineNode;
  sectionTraces: Record<string, TraceRow[]>;
  sectionStats: Record<string, NodeStats>;
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenSection: (uuid: string) => void;
  onOpenTrace: (uuid: string, bottom_uuid?: string) => void;
  disabled?: boolean;
}) {
  const s = sectionStats[section.uuid];
  const traces = sectionTraces[section.uuid] || [];
  const sel = selectionStateForNode(section, sectionTraces, selectedTraces);

  const headerTitle =
    section.label ??
    (section.number && section.title
      ? `${section.number} ${section.title}`
      : section.number ?? section.title ?? "Section");


  return (
    <Collapsible>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* ✅ Use shadcn Checkbox directly */}
          <Checkbox
              disabled={disabled} // <- ⛔ lock UI
              checked={sel.indeterminate ? "indeterminate" : sel.checked}
              onCheckedChange={(v) => {
                if (disabled) return; // guard at handler level too
                const next = v === true;
                setSelectedTraces(prev => {
                  const s = new Set(prev);
                  for (const id of sel.ids) next ? s.add(id) : s.delete(id);
                  return s;
                });
              }}
              className={cbCls}
          />

          <CollapsibleTrigger asChild>
            <button className="px-2 py-1 text-sm font-medium rounded hover:bg-accent/40 data-[state=open]:underline truncate">
              {headerTitle}
            </button>
          </CollapsibleTrigger>

          {/* NEW: info icon to open Drawer for SECTION */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="ml-1 inline-flex items-center justify-center rounded-md p-1.5 hover:bg-accent/40"
                  aria-label="Section details"
                  onClick={() => onOpenSection(section.uuid)}
                >
                  <BookOpenText className="h-4.5 w-4.5 text-muted-foreground" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                View section intent & summary
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

        </div>

        <StatPills s={s} />
      </div>

      <CollapsibleContent className="mt-2 pl-6">
        {traces.length > 0 ? (
          <SectionTraceTableCompact
            rows={traces}
            selectedTraces={selectedTraces}
            setSelectedTraces={setSelectedTraces}
            onOpenTrace={onOpenTrace} // <- pass
            disabled={disabled} // ✅ forward to row-level checkboxes
          />
        ) : (
          <div className="text-xs text-muted-foreground border rounded px-3 py-2">
            No traces under this section.
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function HeadingCollapsible({
  heading,
  sectionTraces,
  sectionStats,
  selectedTraces,
  setSelectedTraces,
  onOpenSection, onOpenTrace, // <- add
  disabled, // NEW
}: {
  heading: OutlineNode;
  sectionTraces: Record<string, TraceRow[]>;
  sectionStats: Record<string, NodeStats>;
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenSection: (uuid: string) => void;
  onOpenTrace: (uuid: string, bottom_uuid?: string) => void;
  disabled?: boolean;
}) {
  const agg = useMemo(() => {
    const sectionIds = collectSectionIds(heading);
    return sectionIds.reduce((sum, sid) => addStats(sum, sectionStats[sid] || zeroStats()), zeroStats());
  }, [heading, sectionStats]);

  const sel = selectionStateForNode(heading, sectionTraces, selectedTraces);

  return (
    <Collapsible>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
              disabled={disabled} // <- ⛔ lock UI
              checked={sel.indeterminate ? "indeterminate" : sel.checked}
              onCheckedChange={(v) => {
                if (disabled) return; // guard at handler level too
                const next = v === true;
                setSelectedTraces(prev => {
                  const s = new Set(prev);
                  for (const id of sel.ids) next ? s.add(id) : s.delete(id);
                  return s;
                });
              }}
              className={cbCls}
          />
          <CollapsibleTrigger asChild>
            <button className="px-2 py-1 text-sm font-medium rounded hover:bg-accent/40 data-[state=open]:underline truncate">
              {heading.label}
            </button>
          </CollapsibleTrigger>
        </div>
        <StatPills s={agg} />
      </div>



      <CollapsibleContent className="mt-2 pl-6 space-y-2">
        <div className="zebra-list rounded-md overflow-hidden">
          {(heading.children ?? []).map((n) =>
            n.type === 'Section' ? (
              <SectionCollapsible
                key={n.uuid}
                section={n}
                sectionTraces={sectionTraces}
                sectionStats={sectionStats}
                selectedTraces={selectedTraces}
                setSelectedTraces={setSelectedTraces}
                onOpenSection={onOpenSection}  // <- pass
                onOpenTrace={onOpenTrace}      // <- pass
                disabled={disabled}            // ✅ forward
              />
            ) : n.type === 'Heading' ? (
              <HeadingCollapsible
                key={n.uuid}
                heading={n}
                sectionTraces={sectionTraces}
                sectionStats={sectionStats}
                selectedTraces={selectedTraces}
                setSelectedTraces={setSelectedTraces}
                onOpenSection={onOpenSection}  // <- pass
                onOpenTrace={onOpenTrace}      // <- pass
                disabled={disabled}            // ✅ forward
              />
            ) : null
          )}
        </div>
      </CollapsibleContent>




    </Collapsible>
  );
}