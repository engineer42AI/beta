// src/app/(protected)/system-b/browse-cert-specs-V4/OutlineUI.tsx

'use client';

import { useMemo } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

/* ---------------- Local Types (aligned with page.tsx) ---------------- */
export type OutlineNode = {
  type: 'Subpart' | 'Heading' | 'Section';
  uuid: string;
  label?: string;
  number?: string;
  title?: string;
  paragraph_id?: string;
  children?: OutlineNode[];
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

/* ---------------- Tiny UI atoms ---------------- */
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
  const visualState: boolean | "indeterminate" = indeterminate ? "indeterminate" : checked;
  return (
    <Checkbox
      title={title}
      checked={visualState}
      onCheckedChange={(v) => onChange(v === true)}
      className={["h-4 w-4 shrink-0", "border-muted-foreground/50", className].join(" ")}
    />
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
}: {
  rows: TraceRow[];
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  return (
    <div className="trace-table rounded-lg border overflow-hidden">
      <div className="grid grid-cols-[26px,1fr,140px,1fr,90px] items-center text-xs font-medium bg-accent/60 text-accent-foreground px-3 py-2 sticky top-0 z-10">
        <div />
        <div>Traces</div>
        <div>Relevance</div>
        <div>Rationale</div>
        <div className="text-right pr-1">Cost</div>
      </div>
      <div>
        {rows.map((r) => {
          const { rel, rat, cost } = useLatestResult(r);
          const path = normalizeTracePath(r.path_labels || []);
          const traceChecked = selectedTraces.has(r.trace_uuid);
          return (
            <div key={r.trace_uuid} className="trace-row grid grid-cols-[26px,1fr,140px,1fr,90px] items-center px-3 py-2 text-sm relative hover:bg-accent/40 transition-colors">
              <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-transparent" aria-hidden />
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
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                {path.map((p, idx) => {
                  const isLast = idx === path.length - 1;
                  return (
                    <span key={idx} className={["badge-pill chip", isLast ? "is-bottom" : ""].join(" ")} title={p}>
                      {p}
                    </span>
                  );
                })}
              </div>
              <div className="pl-2"><RelevanceDot v={rel} /></div>
              <div className="px-2">{rat ? <span className="block line-clamp-2 text-sm" title={rat}>{rat}</span> : <span className="text-muted-foreground">—</span>}</div>
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

/* ---------------- Public component ---------------- */
export function OutlineTree({
  subparts,
  sectionTraces,
  sectionStats,
  selectedTraces,
  setSelectedTraces,
}: {
  subparts: OutlineNode[];
  sectionTraces: Record<string, TraceRow[]>;
  sectionStats: Record<string, NodeStats>;
  selectedTraces: Set<string>;
  setSelectedTraces: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  return (
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
      {subparts.length === 0 && (
        <div className="text-sm text-muted-foreground">Loading outline…</div>
      )}
    </Accordion>
  );
}

/* ---------------- Internal subcomponents ---------------- */
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