'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useConsoleStore } from '@/stores/console-store';

/**
 * Event Bus Monitor
 * - Live timeline of console⇄page envelopes
 * - Filters: tab, direction, topic text, route
 * - Small, dense UI. Expandable JSON. Copy & Export.
 *
 * Data sources (zustand store):
 *  - lastMessage      (console -> page)
 *  - lastConsoleEvent (page -> console)
 *
 * Row model (normalized):
 * {
 *   id: string,
 *   ts: number,
 *   iso: string,
 *   dir: 'console→page' | 'page→console',
 *   tabId: string,
 *   route?: string,
 *   topic?: string,        // if payload.topic is present
 *   size: number,          // JSON length for quick eyeballing
 *   data: any,             // full envelope as received
 * }
 */

// ------ Helpers
type Dir = 'page→console' | 'console→page';
type Row = {
  id: string; ts: number; iso: string; dir: Dir;
  tabId: string; route?: string; topic?: string; size: number; data: any;
};

const MAX_ROWS = 500;

function nowIso(ts?: number) {
  return new Date(ts ?? Date.now()).toISOString();
}

function rowFromStoreEvent(source: 'lastMessage' | 'lastConsoleEvent', evt: any): Row | null {
  if (!evt) return null;
  // Store shapes:
  // - lastMessage:     { tabId, type:'bus_message', payload, ts }
  // - lastConsoleEvent:{ tabId, type,               payload, ts }
  const dir: Dir = source === 'lastConsoleEvent' ? 'page→console' : 'console→page';
  const tabId = evt?.tabId ?? '—';
  const ts = typeof evt?.ts === 'number' ? evt.ts : Date.now();

  // Try to extract route/topic from the payload (our envelopes usually embed them)
  const p = evt?.payload ?? {};
  const topic = p?.topic ?? p?.payload?.topic ?? undefined;
  const route = p?.route ?? p?.payload?.route ?? undefined;

  const json = stringifyExact(evt);
  return {
    id: `${dir}:${tabId}:${ts}:${Math.random().toString(36).slice(2, 8)}`,
    ts,
    iso: nowIso(ts),
    dir,
    tabId,
    route,
    topic,
    size: json.length,
    data: evt,
  };
}

function stringifyExact(value: any): string {
  const seen = new WeakSet();
  return JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    }
  ) ?? '';
}

function stringifyStable(value: any): string {
  const seen = new WeakSet();
  const replacer = (_k: string, v: any) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
      if (Array.isArray(v)) return v;
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = (v as any)[k];
      return out;
    }
    return v;
  };
  try { return JSON.stringify(value, replacer, 2) ?? ''; } catch { return ''; }
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ------ Page
export default function EventBusMonitorPage() {
  // Store subscriptions (small, focused slices)
  const lastMsg          = useConsoleStore(s => s.lastMessage);
  const lastConsoleEvent = useConsoleStore(s => s.lastConsoleEvent);
  const tabs             = useConsoleStore(s => s.tabs.ai);
  const getBinding       = useConsoleStore(s => s.getBinding);

  // Local live buffer
  const [rows, setRows] = useState<Row[]>([]);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Build a list of selectable tabs (id + label)
  const tabOptions = useMemo(() => {
    return (tabs ?? []).map(t => ({ id: t.id, title: t.title || t.id }));
  }, [tabs]);

  // Filters
  const [filterTab, setFilterTab] = useState<string>('all');
  const [filterDirConsole, setFilterDirConsole] = useState(true);
  const [filterDirPage, setFilterDirPage] = useState(true);
  const [filterTopic, setFilterTopic] = useState('');
  const [filterRoute, setFilterRoute] = useState('');

  // Auto-scroll
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);

  // On new events from store: normalize and append
  const append = useCallback((source: 'lastMessage'|'lastConsoleEvent', evt: any) => {
    const r = rowFromStoreEvent(source, evt);
    if (!r) return;

    // resolve route if missing (use binding)
    if (!r.route) {
      const b = r.tabId ? getBinding?.(r.tabId) : undefined;
      if (b?.route) r.route = b.route;
    }

    setRows(prev => {
      if (pausedRef.current) return prev;
      // de-dupe consecutive identical envelopes by (dir, tabId, topic, size, ts within 10ms)
      const last = prev[prev.length - 1];
      const isDup =
        last &&
        last.dir === r.dir &&
        last.tabId === r.tabId &&
        (last.topic ?? '') === (r.topic ?? '') &&
        Math.abs(last.ts - r.ts) < 10 &&
        stringifyExact(last.data) === stringifyExact(r.data);

      const next = isDup ? prev : [...prev, r].slice(-MAX_ROWS);
      return next;
    });
  }, [getBinding]);

  useEffect(() => { if (lastMsg)          append('lastMessage', lastMsg); }, [lastMsg, append]);
  useEffect(() => { if (lastConsoleEvent) append('lastConsoleEvent', lastConsoleEvent); }, [lastConsoleEvent, append]);

  useEffect(() => {
    if (!autoScroll || rows.length === 0) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rows, autoScroll]);

  // Derived filtered rows
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (!filterDirConsole && r.dir === 'console→page') return false;
      if (!filterDirPage    && r.dir === 'page→console')  return false;
      if (filterTab !== 'all' && r.tabId !== filterTab) return false;
      if (filterTopic && !(r.topic ?? '').toLowerCase().includes(filterTopic.toLowerCase())) return false;
      if (filterRoute && !(r.route ?? '').toLowerCase().includes(filterRoute.toLowerCase())) return false;
      return true;
    });
  }, [rows, filterDirConsole, filterDirPage, filterTab, filterTopic, filterRoute]);

  const clear = useCallback(() => setRows([]), []);

  const exportCurrent = useCallback(() => {
    const payload = filtered.map(r => ({
      id: r.id, ts: r.ts, iso: r.iso, dir: r.dir, tabId: r.tabId, route: r.route, topic: r.topic, data: r.data
    }));
    download(`bus-events_${nowIso().replace(/[:.]/g, '-')}.json`, stringifyStable(payload));
  }, [filtered]);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4 text-[11.5px] leading-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Event Bus Monitor</h1>
          <p className="text-[11px] text-muted-foreground">
            Live envelopes flowing between <span className="font-mono">console</span> and <span className="font-mono">page</span>. Expand any row to inspect the exact payload.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{rows.length} events</Badge>
          <Button size="sm" variant={paused ? 'default' : 'outline'} onClick={() => setPaused(v => !v)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" variant={autoScroll ? 'default' : 'outline'} onClick={() => setAutoScroll(v => !v)}>
            {autoScroll ? 'Auto-scroll: On' : 'Auto-scroll: Off'}
          </Button>
          <Button size="sm" variant="outline" onClick={exportCurrent}>Export JSON</Button>
          <Button size="sm" variant="destructive" onClick={clear}>Clear</Button>
        </div>
      </header>

      <Card className="p-2">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 p-2 border-b bg-muted/20 rounded">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Tab:</span>
            <select
              className="h-7 px-2 rounded border bg-background"
              value={filterTab}
              onChange={(e) => setFilterTab(e.target.value)}
            >
              <option value="all">All</option>
              {tabOptions.map(t => <option key={t.id} value={t.id}>{t.id} — {t.title}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Dir:</span>
            <label className="flex items-center gap-1">
              <input type="checkbox" className="scale-90" checked={filterDirConsole} onChange={e => setFilterDirConsole(e.target.checked)} />
              <span>console→page</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" className="scale-90" checked={filterDirPage} onChange={e => setFilterDirPage(e.target.checked)} />
              <span>page→console</span>
            </label>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Topic:</span>
            <input
              className="h-7 px-2 rounded border bg-background w-48"
              placeholder="e.g. cs25.status"
              value={filterTopic}
              onChange={(e) => setFilterTopic(e.target.value)}
            />
          </div>

            <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Route:</span>
            <input
              className="h-7 px-2 rounded border bg-background w-56"
              placeholder="/system-b/..."
              value={filterRoute}
              onChange={(e) => setFilterRoute(e.target.value)}
            />
          </div>
        </div>

        {/* Header row */}
        <div className="grid grid-cols-[150px,120px,1fr,180px,110px,70px] gap-x-2 px-2 py-1 text-[11px] font-medium text-muted-foreground border-b">
          <div>Time</div>
          <div>Direction</div>
          <div>Tab / Route</div>
          <div>Topic</div>
          <div>TabId</div>
          <div className="text-right pr-1">Size</div>
        </div>

        {/* Rows */}
        <div className="max-h-[65vh] overflow-auto">
          {filtered.map((row) => (
            <EventRow key={row.id} row={row} />
          ))}
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-muted-foreground">No events (check filters or try interacting with the page/console).</div>
          )}
          <div ref={endRef} />
        </div>
      </Card>
    </div>
  );
}

/* ---------- Row + Inspector ---------- */

function EventRow({ row }: { row: Row }) {
  const dirBadge =
    row.dir === 'page→console'
      ? <Badge className="bg-blue-600 text-white">page→console</Badge>
      : <Badge className="bg-emerald-600 text-white">console→page</Badge>;

  const exact = useMemo(() => stringifyExact(row.data), [row.data]);
  const stable = useMemo(() => stringifyStable(row.data), [row.data]);

  return (
    <Collapsible>
      <div className="grid grid-cols-[150px,120px,1fr,180px,110px,70px] gap-x-2 items-center px-2 py-1 hover:bg-accent/30">
        <div className="font-mono tabular-nums">{row.iso}</div>
        <div>{dirBadge}</div>
        <div className="truncate">
          <span className="font-mono">{row.route ?? '—'}</span>
        </div>
        <div className="truncate">{row.topic ?? <span className="text-muted-foreground">—</span>}</div>
        <div className="font-mono truncate">{row.tabId}</div>
        <div className="text-right pr-1 tabular-nums">{(row.size / 1024).toFixed(1)} KB</div>
      </div>

      <div className="px-2 pb-2">
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="outline">Inspect</Button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="outline" onClick={() => navigator.clipboard.writeText(exact).catch(() => {})}>
              Copy JSON (exact)
            </Button>
            <Button size="xs" variant="outline" onClick={() => navigator.clipboard.writeText(stable).catch(() => {})}>
              Copy JSON (stable)
            </Button>
          </div>
        </div>
        <CollapsibleContent>
          <div className="mt-2 rounded border bg-background p-2 max-h-96 overflow-auto">
            <JSONView value={row.data} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* ---------- Minimal JSON Viewer (compact) ---------- */

function JSONView({ value }: { value: any }) {
  return (
    <div className="font-mono text-[11px] leading-5">
      <JSONNode value={value} level={0} />
    </div>
  );
}

function JSONNode({ name, value, level }: { name?: string; value: any; level: number }) {
  const [open, setOpen] = useState(level < 1);
  const isObj = value && typeof value === 'object' && !Array.isArray(value);
  const isArr = Array.isArray(value);

  if (!isObj && !isArr) {
    return (
      <div className="whitespace-pre-wrap break-words">
        {name !== undefined && <span className="text-muted-foreground">{name}: </span>}
        <Val value={value} />
      </div>
    );
  }

  const entries = isArr
    ? (value as any[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, any>);
  const summary = isArr ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div>
      <button
        className="text-left w-full hover:bg-accent/40 rounded px-1"
        onClick={() => setOpen(v => !v)}
      >
        {name !== undefined && <span className="text-muted-foreground">{name}: </span>}
        <span className="font-semibold">{isArr ? 'Array' : 'Object'}</span>{' '}
        <span className="text-muted-foreground">{summary}</span>
      </button>
      {open && (
        <div className="pl-3 border-l ml-1">
          {entries.map(([k, v]) => (
            <JSONNode key={k} name={k} value={v} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function Val({ value }: { value: any }) {
  if (typeof value === 'string') return <span className="text-emerald-700 break-words">"{value}"</span>;
  if (typeof value === 'number') return <span className="text-blue-700">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-purple-700">{String(value)}</span>;
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === 'undefined') return <span className="text-muted-foreground">undefined</span>;
  return <span className="break-words">{String(value)}</span>;
}