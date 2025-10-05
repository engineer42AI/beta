/** src/app/(protected)/system-b/browse-cert-specs-V3/page.tsx */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

/* ---------------- Types ---------------- */
type OutlineNode = {
  type: 'Subpart' | 'Heading' | 'Section';
  uuid: string;
  label?: string;
  number?: string;
  title?: string;
  paragraph_id?: string;
  children?: OutlineNode[];
};

type AnyEvent = {
  type: 'run_start' | 'batch_header' | 'batch_start' | 'item_done' | 'batch_progress' | 'batch_end' | 'run_end' | 'error';
  [k: string]: any;
};

type ItemDone = {
  type: 'item_done';
  item: {
    trace_uuid: string;
    bottom_uuid?: string;
    bottom_clause?: string;
    response?: { relevant?: boolean; rationale?: string };
    usage?: { total_cost?: number };
  };
};

type TraceRow = {
  trace_uuid: string;
  bottom_uuid: string;
  bottom_paragraph_id?: string;
  path_labels: string[];   // e.g. ["CS 25.20", "25.20(a)", "25.20(a)(1)"]
  results?: any[];         // streamed items we've appended
};

// reset helpers
function stripResults(m: Record<string, TraceRow[]>): Record<string, TraceRow[]> {
  const out: Record<string, TraceRow[]> = {};
  for (const [sid, rows] of Object.entries(m)) {
    out[sid] = rows.map(r => {
      // drop any streamed results, keep the rest
      const { results, ...rest } = r as any;
      return { ...rest };
    }) as TraceRow[];
  }
  return out;
}

// --- TriStateCheckbox: shadcn/ui (Radix) powered ---
function TriStateCheckbox({
  checked,
  indeterminate,
  onChange,
  className = "",
  title,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  title?: string;
}) {
  // Radix Checkbox accepts checked: boolean | "indeterminate"
  // and onCheckedChange: (boolean | "indeterminate") => void
  const visualState: boolean | "indeterminate" = indeterminate ? "indeterminate" : checked;

  return (
    <Checkbox
      title={title}
      checked={visualState}
      onCheckedChange={(v) => {
        // Treat "indeterminate" like a click-to-check (select all)
        onChange(v === true);
      }}
      className={[
        "h-4 w-4 shrink-0",
        // optional: tighten border to match your UI
        "border-muted-foreground/50",
        className,
      ].join(" ")}
    />
  );
}

/* ---------------- Stat helpers (from trace rows) ---------------- */

type NodeStats = { total: number; relevant: number; notRelevant: number };
const zeroStats = (): NodeStats => ({ total: 0, relevant: 0, notRelevant: 0 });

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

function statsFromTraceRows(rows: TraceRow[] | undefined): NodeStats {
  const s = zeroStats();
  if (!rows) return s;
  for (const r of rows) {
    const items = r.results ?? [];
    for (const it of items) {
      s.total += 1;
      if (it?.response?.relevant === true) s.relevant += 1;
      else if (it?.response?.relevant === false) s.notRelevant += 1;
    }
  }
  return s;
}

function addStats(a: NodeStats, b: NodeStats): NodeStats {
  return { total: a.total + b.total, relevant: a.relevant + b.relevant, notRelevant: a.notRelevant + b.notRelevant };
}

/* ---------------- tiny log model + formatter ---------------- */

type StreamLine = { ts?: number; text: string };

function tstamp(ts?: number) {
  if (!ts) return '';
  const d = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
  return d.toTimeString().slice(0, 8);
}

function eventToLines(evt: AnyEvent): StreamLine[] {
  const k = evt.type;
  if (k === 'item_done') return [];
  if (k === 'run_start') {
    const q = (evt.query || '').toString().replace(/\s+/g, ' ').trim();
    return [{ ts: evt.ts, text: `▶ run_start model=${evt.model} traces=${evt.total_traces} batch_size=${evt.batch_size}  query="${q}"` }];
  }
  if (k === 'batch_header') return [{ ts: evt.ts, text: `• batch_header ${evt.index}/${evt.of} size=${evt.size}` }];
  if (k === 'batch_start')  return [{ ts: evt.ts, text: `• batch_start size=${evt.size}` }];
  if (k === 'batch_progress') return [{
    ts: evt.ts,
    text: `✓ batch_progress ${evt.done}/${evt.total} tokens_in=${evt.tokens_in ?? '-'} tokens_out=${evt.tokens_out ?? '-'} cost=${(evt.batch_cost ?? 0).toFixed(6)} elapsed=${(evt.elapsed_s ?? 0).toFixed(2)}s`
  }];
  if (k === 'batch_end') return [{ ts: evt.ts, text: `• batch_end size=${evt.size} tokens_in=${evt.tokens_in ?? '-'} tokens_out=${evt.tokens_out ?? '-'} cost=${(evt.batch_cost ?? 0).toFixed(6)} elapsed=${(evt.elapsed_s ?? 0).toFixed(2)}s` }];
  if (k === 'run_end') {
    const s = evt.summary || {};
    return [{ ts: evt.ts, text: `■ run_end model=${s.model} traces=${s.total_traces} tokens_in=${s.tokens_in ?? '-'} tokens_out=${s.tokens_out ?? '-'} est_cost=${(s.estimated_cost ?? 0).toFixed(6)}` }];
  }
  if (k === 'error') return [{ ts: Date.now(), text: `⚠ error ${evt.error ?? ''}` }];
  return [{ ts: evt.ts, text: JSON.stringify(evt) }];
}

function isAbortError(err: unknown) {
  return !!err && typeof err === "object" && (err as any).name === "AbortError";
}

function StreamConsole({ lines }: { lines: StreamLine[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  useEffect(() => {
    if (!autoScroll) return;
    const el = wrapRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between px-3 py-2 text-xs bg-accent/60 text-accent-foreground">
        <span className="font-medium">Stream</span>
        <div className="flex items-center gap-3">
          <span className="opacity-80">{lines.length} lines</span>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" className="accent-current" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            <span>Auto-scroll</span>
          </label>
        </div>
      </div>

      <div ref={wrapRef} className="max-h-[260px] overflow-auto bg-background" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-xs font-mono">
          <tbody>
            {lines.map((ln, i) => (
              <tr key={`${i}-${ln.ts ?? ''}`} className={i % 2 ? 'bg-accent/20' : ''}>
                <td className="px-2 py-[3px] text-right align-top w-[48px] text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-2 py-[3px] align-top w-[70px] text-muted-foreground tabular-nums">{tstamp(ln.ts)}</td>
                <td className="px-2 py-[3px] align-top whitespace-pre-wrap">{ln.text}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td className="px-2 py-2 text-muted-foreground" colSpan={3}>(no events yet)</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusInline({ running, total, done, cost }: { running: boolean; total: number; done: number; cost: number; }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-accent/20 px-3 py-2">
      <div className="w-44">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
          <span>{running ? "Processing…" : "Idle"}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />
        <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">{done}/{total} traces</div>
      </div>
      <div className="ml-1 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Cost</span>
        <span className="font-mono tabular-nums px-2 py-[2px] rounded border bg-background">{cost.toFixed(6)}</span>
      </div>
    </div>
  );
}

/* ---------------- Selection helpers (module-scope, pure) ---------------- */

// flatten descendant section UUIDs
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

// from a list of section UUIDs, gather *trace* UUIDs using the server-provided rows
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

/* ---------------- NDJSON streamer ---------------- */
async function streamNdjson(
  url: string,
  payload: unknown,
  signal: AbortSignal,
  onEvent: (evt: AnyEvent) => void
) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status} ${res.statusText}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try { onEvent(JSON.parse(line)); } catch {}
    }
  }
}

/* ---------------- Misc UI helpers ---------------- */

function Chip({ children, dim = false, isBottom = false }: { children: React.ReactNode; dim?: boolean; isBottom?: boolean }) {
  return (
    <span className={["badge-pill chip", dim ? "opacity-70" : "", isBottom ? "font-semibold bg-accent/40" : ""].join(" ")}>{children}</span>
  );
}

function RelevancePill({ v }: { v: boolean | undefined }) {
  if (v === true) return <span className="px-2 py-[2px] rounded-full text-[11px] bg-green-600 text-white">Relevant</span>;
  if (v === false) return <span className="px-2 py-[2px] rounded-full text-[11px] bg-red-500 text-white">Not</span>;
  return <span className="px-2 py-[2px] rounded-full text-[11px] border text-muted-foreground">—</span>;
}

function Money({ v }: { v?: number }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono tabular-nums">{v.toFixed(6)}</span>;
}

function Rationale({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <button type="button" onClick={() => setOpen((x) => !x)} className="text-left w-full hover:bg-accent/40 rounded px-1 py-0.5" title={open ? "Collapse" : "Expand"}>
      <span className={open ? "" : "line-clamp-2"}>{text}</span>
    </button>
  );
}

function normalizeTracePath(labels: string[]): string[] {
  if (!labels || labels.length === 0) return [];
  const rest = labels.slice(1); // drop "CS …"
  return rest.map(l => l.replace(/\(([A-Za-z]+)\)/g, (_, g1) => `(${g1.toLowerCase()})`));
}

function useLatestResult(row: TraceRow) {
  const latest = row.results && row.results.length ? row.results[row.results.length - 1] : undefined;
  const rel: boolean | undefined = latest?.response?.relevant;
  const rat: string | undefined = latest?.response?.rationale;
  const cost: number | undefined = latest?.usage?.total_cost;
  return { latest, rel, rat, cost };
}

/* ---------------- Section rows w/ per-trace checkbox ---------------- */

function RelevanceDot({ v }: { v: boolean | undefined }) {
  const cls =
    v === true
      ? "bg-emerald-600"
      : v === false
      ? "bg-red-500"
      : "bg-muted-foreground/40";
  const label = v === true ? "Relevant" : v === false ? "Not relevant" : "—";
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`}
        title={label}
        aria-label={label}
      />
      <span className="hidden sm:inline text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function SectionTraceTableCompact({
  rows,
  selectedTraces,
  setSelectedTraces,
}: {
  rows: TraceRow[];
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  return (
    <div className="trace-table rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[26px,1fr,140px,1fr,90px] items-center text-xs font-medium bg-accent/60 text-accent-foreground px-3 py-2 sticky top-0 z-10">
        <div />
        <div>Traces</div>
        <div>Relevance</div>
        <div>Rationale</div>
        <div className="text-right pr-1">Cost</div>
      </div>

      {/* Rows */}
      <div>
          {rows.map((r) => {
            const { rel, rat, cost } = useLatestResult(r);
            const path = normalizeTracePath(r.path_labels || []);
            const traceChecked = selectedTraces.has(r.trace_uuid);

            return (
              <div
                key={r.trace_uuid}
                className={[
                  // ↓ five columns now
                  "trace-row grid grid-cols-[26px,1fr,140px,1fr,90px] items-center px-3 py-2 text-sm relative",
                  "hover:bg-accent/40 transition-colors",
                ].join(" ")}
              >
                {/* left rail (kept) */}
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-transparent" aria-hidden />

                {/* checkbox */}
                <div>
                  <TriStateCheckbox
                    checked={traceChecked}
                    onChange={(checked) => {
                      setSelectedTraces(prev => {
                        const next = new Set(prev);
                        if (checked) next.add(r.trace_uuid); else next.delete(r.trace_uuid);
                        return next;
                      });
                    }}
                    title="Select trace"
                  />
                </div>

                {/* path chips */}
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  {path.map((p, idx) => {
                    const isLast = idx === path.length - 1;
                    return (
                      <span
                        key={idx}
                        className={["badge-pill chip", isLast ? "is-bottom" : ""].join(" ")}
                        title={p}
                      >
                        {p}
                      </span>
                    );
                  })}
                </div>

                {/* relevance */}
                <div className="pl-2">
                  <RelevanceDot v={rel} />
                </div>

                {/* rationale */}
                <div className="px-2">
                  {rat ? <span className="block line-clamp-2 text-sm" title={rat}>{rat}</span>
                       : <span className="text-muted-foreground">—</span>}
                </div>

                {/* cost */}
                <div className="text-right pr-1 font-mono tabular-nums text-sm">
                  {cost == null ? <span className="text-muted-foreground">—</span> : cost.toFixed(6)}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ---------------- Section & Subpart renderers w/ header checkbox ---------------- */

function SectionCollapsible({
  section,
  sectionTraces,
  sectionStats,
  selectedTraces,
  setSelectedTraces,
}: {
  section: OutlineNode;
  sectionTraces: Record<string, TraceRow[]>;
  sectionStats: Record<string, NodeStats>;
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const s = sectionStats[section.uuid];
  const traces = sectionTraces[section.uuid] || [];
  const sel = selectionStateForNode(section, sectionTraces, selectedTraces);
  const headerTitle =
  section.label
    ?? (section.number && section.title
          ? `${section.number} ${section.title}`
          : section.number ?? section.title ?? "Section");

  return (
    <Collapsible>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TriStateCheckbox
            checked={sel.checked}
            indeterminate={sel.indeterminate}
            onChange={(checked) => {
              setSelectedTraces(prev => {
                const next = new Set(prev);
                for (const id of sel.ids) checked ? next.add(id) : next.delete(id);
                return next;
              });
            }}
          />
          <CollapsibleTrigger asChild>
            <button className="px-2 py-1 text-sm font-medium rounded hover:bg-accent/40 data-[state=open]:underline truncate">
              {headerTitle}
            </button>
          </CollapsibleTrigger>
        </div>
        <StatPills s={s} />
      </div>

      {/* Body */}
      <CollapsibleContent className="mt-2 pl-6">
        {traces.length > 0 ? (
          <SectionTraceTableCompact
            rows={traces}
            selectedTraces={selectedTraces}
            setSelectedTraces={setSelectedTraces}
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
}: {
  heading: OutlineNode;
  sectionTraces: Record<string, TraceRow[]>;
  sectionStats: Record<string, NodeStats>;
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const agg = useMemo(() => {
    const sectionIds = collectSectionIds(heading);
    return sectionIds.reduce((sum, sid) => addStats(sum, sectionStats[sid] || zeroStats()), zeroStats());
  }, [heading, sectionStats]);

  const sel = selectionStateForNode(heading, sectionTraces, selectedTraces);

  return (
    <Collapsible>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TriStateCheckbox
            checked={sel.checked}
            indeterminate={sel.indeterminate}
            onChange={(checked) => {
              setSelectedTraces(prev => {
                const next = new Set(prev);
                for (const id of sel.ids) checked ? next.add(id) : next.delete(id);
                return next;
              });
            }}
          />
          <CollapsibleTrigger asChild>
            <button className="px-2 py-1 text-sm font-medium rounded hover:bg-accent/40 data-[state=open]:underline truncate">
              {heading.label}
            </button>
          </CollapsibleTrigger>
        </div>
        <StatPills s={agg} />
      </div>

      {/* Children */}
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
                />
              ) : n.type === 'Heading' ? (
                <HeadingCollapsible
                  key={n.uuid}
                  heading={n}
                  sectionTraces={sectionTraces}
                  sectionStats={sectionStats}
                  selectedTraces={selectedTraces}
                  setSelectedTraces={setSelectedTraces}
                />
              ) : null
            )}
          </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SubpartAccordion({
  subpart,
  sectionTraces,
  sectionStats,
  selectedTraces,
  setSelectedTraces,
}: {
  subpart: OutlineNode;
  sectionTraces: Record<string, TraceRow[]>;
  sectionStats: Record<string, NodeStats>;
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
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
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TriStateCheckbox
            checked={sel.checked}
            indeterminate={sel.indeterminate}
            onChange={(checked) => {
              setSelectedTraces(prev => {
                const next = new Set(prev);
                for (const id of sel.ids) checked ? next.add(id) : next.delete(id);
                return next;
              });
            }}
          />
          <AccordionTrigger className="flex-1 text-left px-2 py-1 rounded hover:no-underline hover:bg-accent/40 truncate">
            {subpart.label
                ?? (subpart.code
                      ? `SUBPART ${subpart.code}${subpart.title ? ` – ${subpart.title}` : ""}`
                      : subpart.title ?? "Subpart")}
          </AccordionTrigger>
        </div>
        <StatPills s={agg} />
      </div>

      {/* Children */}
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
                />
              ) : child.type === 'Heading' ? (
                <HeadingCollapsible
                  key={child.uuid}
                  heading={child}
                  sectionTraces={sectionTraces}
                  sectionStats={sectionStats}
                  selectedTraces={selectedTraces}
                  setSelectedTraces={setSelectedTraces}
                />
              ) : (
                <div key={child.uuid} className="ml-2 text-sm text-gray-700">
                  {child.label}
                </div>
              )
            )}
          </div>
      </AccordionContent>
    </AccordionItem>
  );
}
/* ---------------- Main Page ---------------- */

export default function BrowseCertSpecV3Page() {
  const [outline, setOutline] = useState<OutlineNode | null>(null);

  // per-section trace rows + lookup (from backend)
  const [sectionTraces, setSectionTraces] = useState<Record<string, TraceRow[]>>({});
  const [traceLookup, setTraceLookup] = useState<Record<string, { section_uuid: string; index: number; bottom_uuid: string }>>({});

  // streaming state
  const [query, setQuery] = useState('Are there CS-25 rules relevant to approaches below 200 ft decision height, and why?');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<StreamLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // run status
  const [totalTraces, setTotalTraces] = useState<number>(0);
  const [doneTraces, setDoneTraces] = useState<number>(0);
  const [runCost, setRunCost] = useState<number>(0);

  // selection state (trace UUIDs)
  const [selectedTraces, setSelectedTraces] = useState<Set<string>>(new Set());

  useEffect(() => () => abortRef.current?.abort(), []);

  // Load outline + trace rows once
  useEffect(() => {
    (async () => {
      try {
        const url = `${BASE}/agents/cs25/outline`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Outline ${res.status}`);
        const data = await res.json();
        setOutline(data.outline ?? null);
        setSectionTraces(data.section_traces ?? {});
        setTraceLookup(data.trace_lookup ?? {});
      } catch (err) {
        console.error('Outline load failed:', err);
      }
    })();
  }, []);

  // handler for reset
  const resetAll = useCallback(() => {
      // stop any in-flight run
      abortRef.current?.abort();
      setRunning(false);

      // clear streamed results from rows
      setSectionTraces(prev => stripResults(prev));

      // clear selections + console + counters
      setSelectedTraces(new Set());
      setLog([]);
      setTotalTraces(0);
      setDoneTraces(0);
      setRunCost(0);
  }, []);

  // live stats per SECTION from trace rows
  const sectionStats = useMemo(() => {
    const m: Record<string, NodeStats> = {};
    for (const [sid, rows] of Object.entries(sectionTraces)) m[sid] = statsFromTraceRows(rows);
    return m;
  }, [sectionTraces]);

  // Start/Stop streaming
  const start = useCallback(async () => {
    const ids = Array.from(selectedTraces);
    if (ids.length === 0) {
        setLog(prev => [...prev, { ts: Date.now(), text: 'ℹ nothing selected — tick subparts/sections/traces first' }]);
        return;
    }

    setLog([]);
    setRunning(true);

    // set totals immediately so the UI shows the correct denominator
    setTotalTraces(ids.length);
    setDoneTraces(0);
    setRunCost(0);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamNdjson(
        `${BASE}/agents/cs25/stream`,
        {
            query,
            model: 'gpt-5-nano',
            batch_size: 200,
            limit: null,
            pricing_per_million: [0.05, 0.40],
            selected_trace_ids: ids,
        },
        ac.signal,
        (evt) => {
          if (evt.type === 'run_start') {
              // trust the server if it matches; otherwise keep our selected count
              const serverTotal = Number(evt.total_traces ?? NaN);
              if (!Number.isNaN(serverTotal) && serverTotal > 0) {
                setTotalTraces(serverTotal);
              }
              setDoneTraces(0);
              setRunCost(0);
          }
          if (evt.type === 'item_done') {
            setDoneTraces((d) => d + 1);
            const it = (evt as ItemDone).item;
            const c = Number(it?.usage?.total_cost ?? 0);
            if (!Number.isNaN(c) && c > 0) setRunCost((prev) => prev + c);

            const tId = it?.trace_uuid;
            if (tId) {
              setSectionTraces((prev) => {
                const next = { ...prev };
                const loc = traceLookup[tId];
                if (!loc) return next;
                const arr = next[loc.section_uuid] ? [...next[loc.section_uuid]] : [];
                const row = { ...(arr[loc.index] || {}) };
                row.results = [...(row.results || []), it];
                arr[loc.index] = row;
                next[loc.section_uuid] = arr;
                return next;
              });
            }
          }
          if (evt.type === 'run_end') {
            const est = Number(evt?.summary?.estimated_cost ?? NaN);
            if (!Number.isNaN(est) && est >= 0) setRunCost(est);
            const tt = Number(evt?.summary?.total_traces ?? NaN);
            if (!Number.isNaN(tt) && tt > 0) setTotalTraces(tt);
          }

          const newLines = eventToLines(evt);
          if (newLines.length) setLog((prev) => (prev.length ? [...prev, ...newLines] : newLines));
        }
      );
    } catch (e) {
      if (isAbortError(e)) setLog((prev) => [...prev, { ts: Date.now(), text: '■ run aborted' }]);
      else {
        console.error(e);
        setLog((prev) => [...prev, { ts: Date.now(), text: `⚠ error ${String(e)}` }]);
      }
    } finally {
      setRunning(false);
    }
  }, [query, selectedTraces, traceLookup]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  if (!outline) return <div className="p-6">Loading outline…</div>;

  const subparts = (outline.children ?? []).filter((c) => c.type === 'Subpart');

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">CS-25 — Traces by Section</h1>
        <p className="text-sm text-gray-600">Tick subparts/sections/traces and run the agent only for those selections.</p>
      </header>

      {/* Query + Run */}
      <section className="space-y-3">
        <label className="block text-sm font-medium">User query</label>
        <textarea
          className="w-full border rounded p-3 min-h-[110px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about CS-25…"
        />
        <div className="flex gap-3 items-center">
          <Button onClick={start} disabled={running} className="px-4">
            {running ? 'Streaming…' : 'Run'}
          </Button>
          {running && (
            <Button variant="outline" onClick={stop} className="px-4">
              Stop
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={resetAll}
            disabled={running}
            className="px-3"
            title="Reset all results and selections"
          >
            Reset
          </Button>
          <div className="ml-auto">
            <StatusInline running={running} total={totalTraces} done={doneTraces} cost={runCost} />
          </div>
        </div>
      </section>

      {/* Outline (collapsible) */}
      <section>
        <Accordion type="multiple" className="w-full space-y-2">
          {subparts.map((sp) => (
            <SubpartAccordion
              key={sp.uuid}
              subpart={sp}
              sectionTraces={sectionTraces}
              sectionStats={sectionStats}
              selectedTraces={selectedTraces}
              setSelectedTraces={setSelectedTraces}
            />
          ))}
        </Accordion>
      </section>

      {/* Stream console */}
      <section className="space-y-2">
        <StreamConsole lines={log} />
      </section>
    </div>
  );
}