/** src/app/(protected)/system-b/browse-cert-specs-V2/page.tsx */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

/* ---------------- Types (minimal) ---------------- */
type OutlineNode = {
  type: string;
  uuid: string;
  label?: string;
  number?: string;
  title?: string;
  paragraph_id?: string;
  results?: any[];
  children?: OutlineNode[];
};

type Indices = {
  uuid_to_node: Record<string, OutlineNode>;
  uuid_to_path: Record<string, string[]>;
  bottom_uuid_to_path: Record<string, string[]>;
};

type AnyEvent = {
  type: 'run_start' | 'batch_header' | 'batch_start' | 'item_done' | 'batch_progress' | 'batch_end' | 'run_end' | 'error';
  [k: string]: any;
};

type ItemDone = {
  type: 'item_done';
  item: {
    bottom_uuid?: string;
    bottom_clause?: string;
    response?: { relevant?: boolean; rationale?: string };
    usage?: { total_cost?: number };
    // ... other fields
  };
};

/* -------------- Helpers: stats -------------- */

type NodeStats = {
  total: number;        // number of streamed items under this node
  relevant: number;     // response.relevant === true
  notRelevant: number;  // response.relevant === false
};

type StatsById = Record<string, NodeStats>;

/** Count results for a single Paragraph node. */
function statsForParagraph(node: OutlineNode): NodeStats {
  const items = node.results ?? [];
  let total = 0, relevant = 0, notRelevant = 0;
  for (const it of items) {
    total += 1;
    if (it?.response?.relevant === true) relevant += 1;
    else if (it?.response?.relevant === false) notRelevant += 1;
  }
  return { total, relevant, notRelevant };
}

/** Recursively compute stats for the whole outline and return a map uuid -> stats. */
function computeStats(outline: OutlineNode | null): StatsById {
  const byId: StatsById = {};
  if (!outline) return byId;

  function walk(node: OutlineNode): NodeStats {
    if (node.type === 'Paragraph') {
      const s = statsForParagraph(node);
      byId[node.uuid] = s;
      return s;
    }
    let total = 0, relevant = 0, notRelevant = 0;
    for (const c of node.children ?? []) {
      const s = walk(c);
      total += s.total;
      relevant += s.relevant;
      notRelevant += s.notRelevant;
    }
    const s = { total, relevant, notRelevant };
    byId[node.uuid] = s;
    return s;
  }

  walk(outline);
  return byId;
}

/** Tiny badge group to render counts. */
function Counts({ s }: { s?: NodeStats }) {
  if (!s) return null;
  return (
    <span className="ml-2 inline-flex gap-1 items-center">
      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{s.total}</Badge>
      <Badge className="px-1.5 py-0 text-[10px] bg-green-600 text-white hover:bg-green-600">
        {s.relevant}
      </Badge>
      <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
        {s.notRelevant}
      </Badge>
    </span>
  );
}

/* -------------- Helpers: NDJSON streamer -------------- */
async function streamNdjson(url: string, payload: unknown, signal: AbortSignal, onEvent: (evt: AnyEvent) => void) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
  });
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

/* -------------- Immutable update: append a result into the outline -------------- */
/**
 * Given an outline tree, append `item` into the `results` array of the Paragraph node
 * whose uuid === item.bottom_uuid. Returns a new outline (immutably).
 */
function appendResult(outline: OutlineNode | null, bottom_uuid: string, item: any): OutlineNode | null {
  if (!outline) return outline;
  // DFS copy-on-write
  function visit(node: OutlineNode): OutlineNode {
    let changed = false;
    let children = node.children;

    if (node.uuid === bottom_uuid && node.type === 'Paragraph') {
      const results = (node.results ?? []).concat(item);
      return { ...node, results };
    }

    if (children && children.length) {
      const newChildren = [];
      for (const c of children) {
        const next = visit(c);
        changed = changed || next !== c;
        newChildren.push(next);
      }
      if (changed) return { ...node, children: newChildren };
    }
    return node;
  }
  return visit(outline);
}

/* -------------- Flatten an outline into table rows for a nicer view -------------- */
type Row = {
  uuid: string;
  kind: string;
  pathLabel: string; // e.g. "Subpart B › GENERAL › CS 25.20 Scope"
  paragraph_id?: string;
  resultsCount?: number;
  latestRationale?: string;
  latestRelevant?: boolean | undefined;
  latestCost?: number | undefined;
};

function rowsFromOutline(outline: OutlineNode | null): Row[] {
  const out: Row[] = [];
  if (!outline) return out;

  function walk(node: OutlineNode, trail: string[]) {
    const labelParts = [
      node.number ? node.number : null,
      node.title ? node.title : node.label ? node.label : null,
    ].filter(Boolean) as string[];
    const here = labelParts.join(' ');
    const pathLabel = [...trail, here].filter(Boolean).join(' › ');

    if (node.type === 'Paragraph') {
      const results = node.results ?? [];
      const latest = results.length ? results[results.length - 1] : undefined;
      out.push({
        uuid: node.uuid,
        kind: 'Paragraph',
        pathLabel,
        paragraph_id: node.paragraph_id,
        resultsCount: results.length,
        latestRationale: latest?.response?.rationale,
        latestRelevant: latest?.response?.relevant,
        latestCost: latest?.usage?.total_cost,
      });
    } else if (node.type === 'Section' || node.type === 'Heading' || node.type === 'Subpart') {
      // also add a heading row (optional)
      out.push({ uuid: node.uuid, kind: node.type, pathLabel });
    }

    for (const c of node.children ?? []) walk(c, pathLabel ? [pathLabel] : []);
  }

  walk(outline, []);
  return out;
}

/* -------------- Page -------------- */

/* ---------------- Hierarchy renderers ---------------- */

function ParagraphTable({ paragraphs }: { paragraphs: OutlineNode[] }) {
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-gray-50 text-gray-600">
          <th className="px-2 py-1 text-left">Paragraph</th>
          <th className="px-2 py-1 text-left">Relevance</th>
          <th className="px-2 py-1 text-left">Rationale</th>
          <th className="px-2 py-1 text-left">Cost</th>
        </tr>
      </thead>
      <tbody>
        {paragraphs.map((p) => {
          const results = p.results ?? [];
          const latest = results.at(-1);
          const rel = latest?.response?.relevant;
          return (
            <tr key={p.uuid} className="border-t">
              <td className="px-2 py-1">{p.paragraph_id ?? "—"}</td>
              <td className="px-2 py-1">
                {rel === true ? (
                  <Badge className="bg-green-600 text-white hover:bg-green-600">Relevant</Badge>
                ) : rel === false ? (
                  <Badge variant="destructive">Not</Badge>
                ) : (
                  <Badge variant="outline">—</Badge>
                )}
              </td>
              <td className="px-2 py-1">{latest?.response?.rationale ?? "—"}</td>
              <td className="px-2 py-1">{latest?.usage?.total_cost != null ? latest.usage.total_cost.toFixed(6) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SubpartAccordion({ subpart, statsById }: { subpart: OutlineNode; statsById: StatsById }) {
  const s = statsById[subpart.uuid];
  return (
    <AccordionItem value={String(subpart.uuid)}>
      <AccordionTrigger className="text-base font-semibold">
        {subpart.label} {subpart.title ? `– ${subpart.title}` : ""}
        <Counts s={s} />
      </AccordionTrigger>
      <AccordionContent className="space-y-2 ml-2">
        {(subpart.children ?? []).map((sec) => (
          <SectionCollapsible key={sec.uuid} section={sec} statsById={statsById} />
        ))}
      </AccordionContent>
    </AccordionItem>
  );
}

function SectionCollapsible({ section, statsById }: { section: OutlineNode; statsById: StatsById }) {
  const paragraphs = (section.children ?? []).filter((c) => c.type === "Paragraph");
  const subHeadings = (section.children ?? []).filter((c) => c.type !== "Paragraph");
  const s = statsById[section.uuid];

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between text-sm font-medium">
          <span className="truncate text-left">
            {section.number ? `${section.number} ${section.title ?? ""}` : section.label}
          </span>
          <Counts s={s} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-4 space-y-2">
        {paragraphs.length > 0 && <ParagraphTable paragraphs={paragraphs} />}
        {subHeadings.map((h) => (
          <SectionCollapsible key={h.uuid} section={h} statsById={statsById} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function BrowseCertSpecV2Page() {
  const [outline, setOutline] = useState<OutlineNode | null>(null);

  // ---- NEW: streaming state ----
  const [query, setQuery] = useState(
    'Are there CS-25 rules relevant to approaches below 200 ft decision height, and why?'
  );
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AnyEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Load outline once
  useEffect(() => {
    (async () => {
      try {
        const url = `${BASE}/agents/cs25/outline`;
        const res = await fetch(url);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Outline ${res.status}: ${text}`);
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          const text = await res.text();
          throw new Error(`Expected JSON, got: ${text.slice(0, 200)}`);
        }
        const data = await res.json();
        setOutline(data.outline ?? null);
      } catch (err) {
        console.error('Outline load failed:', err);
      }
    })();
  }, []); // ← keep empty & stable

  // ---- NEW: start/stop streaming ----
  const start = useCallback(async () => {
    if (!outline) return; // outline first
    setEvents([]);
    setRunning(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamNdjson(
        `${BASE}/agents/cs25/stream`,
        { query, model: 'gpt-5-nano', batch_size: 5, limit: 10, pricing_per_million: [0.05, 0.40] },
        ac.signal,
        (evt) => {
          setEvents((prev) => [...prev, evt]);
          if (evt.type === 'item_done') {
            const item = (evt as ItemDone).item;
            const uuid = item?.bottom_uuid;
            if (uuid) {
              // immutably append the result to the right paragraph
              setOutline((prev) => appendResult(prev, uuid, item));
            }
          }
        }
      );
    } catch (e) {
      console.error(e);
      setEvents((prev) => [...prev, { type: 'error', error: String(e) } as AnyEvent]);
    } finally {
      setRunning(false);
    }
  }, [outline, query]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const statsById = useMemo(() => computeStats(outline), [outline]);

  if (!outline) return <div className="p-6">Loading outline…</div>;

  const subparts = (outline.children ?? []).filter((c) => c.type === 'Subpart');

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">CS-25 Outline</h1>
        <p className="text-sm text-gray-600">
          Expand subparts/sections. Run a query to stream relevance per paragraph.
        </p>
      </header>

      {/* ---- NEW: query + run/stop ---- */}
      <section className="space-y-3">
        <label className="block text-sm font-medium">User query</label>
        <textarea
          className="w-full border rounded p-3 min-h-[110px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about CS-25…"
        />
        <div className="flex gap-3">
          <Button onClick={start} disabled={running} className="px-4">
            {running ? 'Streaming…' : 'Run'}
          </Button>
          {running && (
            <Button variant="outline" onClick={stop} className="px-4">
              Stop
            </Button>
          )}
        </div>
      </section>

      {/* Outline (collapsible) */}
      <section>
          <Accordion type="multiple" className="w-full space-y-2">
            {subparts.map((sp) => (
              <SubpartAccordion key={sp.uuid} subpart={sp} statsById={statsById} />
            ))}
          </Accordion>
      </section>

      {/* ---- NEW: small debug panel for streamed events ---- */}
      <section className="space-y-2">
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="justify-start">
              {events.length ? `Events (${events.length})` : 'Events (none)'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border rounded p-3 max-h-[260px] overflow-auto text-xs font-mono bg-white">
              {events.length === 0 ? (
                <div className="text-gray-500">No events yet.</div>
              ) : (
                events.map((evt, i) => (
                  <pre key={i} className="whitespace-pre-wrap">
                    {JSON.stringify(evt, null, 2)}
                  </pre>
                ))
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  );
}