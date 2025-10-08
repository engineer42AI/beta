// src/app/(protected)/system-b/browse-cert-specs-V4/DebugConsole.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useConsoleStore } from "@/stores/console-store";

/**
 * DebugConsole — tab-scoped dashboard
 *
 * Shows, for the *active* tab only:
 *  - Inbound envelope history (console → page)
 *  - Outbound envelope history (page → console)
 *  - Page Config history (route+tab)
 *  - Current snapshots (Page Config, Binding/Manifest)
 *
 * Notes:
 *  - Only envelopes with evt.tabId === boundTabId are tracked.
 *  - Histories reset when boundTabId changes.
 */

/** Safe stringify that tolerates cycles and BigInt, and stabilizes key order */
function safeStringify(value: any): string {
  const cache = new WeakSet();
  const replacer = (_key: string, val: any) => {
    if (typeof val === "bigint") return val.toString();
    if (typeof val === "object" && val !== null) {
      if (cache.has(val)) return "[Circular]";
      cache.add(val);
      // sort keys for stability
      if (!Array.isArray(val)) {
        const sorted: Record<string, any> = {};
        for (const k of Object.keys(val).sort()) sorted[k] = (val as any)[k];
        return sorted;
      }
    }
    return val;
  };
  try {
    return JSON.stringify(value, replacer);
  } catch {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
}

type EventRow = { ts: string; summary: string; data: any };
const MAX_EVENTS = 600; // per section

export function DebugConsole({
  route,
  boundTabId,
  hydratedKey,
  selectedTraces,
  config,
  lastMsg,       // legacy (optional)
  lastPublish,   // legacy (optional)
  running,
  totalTraces,
  doneTraces,
  runCost,
}: any) {
  const [ts, setTs] = useState("");
  useEffect(() => setTs(new Date().toISOString()), [lastMsg, lastPublish, config]);

  const isBound = Boolean(boundTabId);
  const persistedSel = config?.selectedTraceIds?.length ?? 0;
  const persistedRes = Object.keys(config?.resultsByTraceId ?? {}).length ?? 0;

  // Live bus envelopes from console store
  const toPageEnv   = useConsoleStore((s) => s.lastMessage);        // console → page
  const toConsoleEnv= useConsoleStore((s) => s.lastConsoleEvent);   // page → console

  // Binding + manifest (bindings-only)
  const getManifest = useConsoleStore((s) => s.getManifest);
  const getBinding  = useConsoleStore((s) => s.getBinding);
  const manifest = boundTabId ? getManifest(boundTabId) : undefined;
  const binding  = boundTabId ? getBinding(boundTabId)  : undefined;

  // ── Histories (tab-scoped) ────────────────────────────────────────────────
  const [inbound,  setInbound]  = useState<EventRow[]>([]);
  const [outbound, setOutbound] = useState<EventRow[]>([]);
  const [cfgHist,  setCfgHist]  = useState<EventRow[]>([]);
  const [pauseIn, setPauseIn] = useState(false);
  const [pauseOut,setPauseOut]= useState(false);
  const [pauseCfg,setPauseCfg]= useState(false);

  // Reset histories when the active tab changes (tab-scoped dashboard)
  useEffect(() => {
    setInbound([]); setOutbound([]); setCfgHist([]);
    setPauseIn(false); setPauseOut(false); setPauseCfg(false);
  }, [boundTabId]);

  const cap = (arr: EventRow[], next: EventRow[]) => [...next, ...arr].slice(0, MAX_EVENTS);
  const now = () => new Date().toISOString();

  // Inbound capture (console → page). Only current tab.
  const lastInSig = useRef<string>("");
  useEffect(() => {
    if (!toPageEnv || !boundTabId || pauseIn) return;
    if (toPageEnv.tabId !== boundTabId) return;
    const sig = envSig(toPageEnv);
    if (sig === lastInSig.current) return;
    lastInSig.current = sig;

    setInbound(prev => cap(prev, [{
      ts: now(),
      summary: `type: ${toPageEnv.type} · tab: ${toPageEnv.tabId}`,
      data: toPageEnv
    }]));
  }, [toPageEnv, boundTabId, pauseIn]);

  // Outbound capture (page → console). Only current tab.
  const lastOutSig = useRef<string>("");
  useEffect(() => {
    if (!toConsoleEnv || !boundTabId || pauseOut) return;
    if (toConsoleEnv.tabId !== boundTabId) return;
    const sig = envSig(toConsoleEnv);
    if (sig === lastOutSig.current) return;
    lastOutSig.current = sig;

    setOutbound(prev => cap(prev, [{
      ts: now(),
      summary: `type: ${toConsoleEnv.type} · tab: ${toConsoleEnv.tabId}`,
      data: toConsoleEnv
    }]));
  }, [toConsoleEnv, boundTabId, pauseOut]);

  // Page Config change capture (route+tab)
  const lastCfgSig = useRef<string>("");
  useEffect(() => {
    if (pauseCfg) return;
    const sig = safeStringify({
      keys: Object.keys(config ?? {}).sort(),
      sel: persistedSel,
      resCount: persistedRes,
      // include bound tab to avoid cross-tab bleed
      tab: boundTabId ?? "—",
    });
    if (sig === lastCfgSig.current) return;
    lastCfgSig.current = sig;

    setCfgHist(prev => cap(prev, [{
      ts: now(),
      summary: `PageConfig changed · selected: ${persistedSel} · results: ${persistedRes}`,
      data: config
    }]));
  }, [config, persistedSel, persistedRes, pauseCfg, boundTabId]);

  // UI controls
  const [expandAll, setExpandAll] = useState(false);
  const toggleExpandAll = useCallback(() => setExpandAll(v => !v), []);
  const pauseAll  = () => { setPauseIn(true);  setPauseOut(true);  setPauseCfg(true);  };
  const resumeAll = () => { setPauseIn(false); setPauseOut(false); setPauseCfg(false); };
  const clearAll  = () => { setInbound([]);    setOutbound([]);    setCfgHist([]);     };

  // Pre-serialized for copy
  const cfgExact   = useMemo(() => stringifyExact(config), [config]);
  const cfgStable  = useMemo(() => stringifyStable(config), [config]);
  const cfgStr      = useMemo(() => safeStringify(config), [config]);
  const manifestStr = useMemo(() => safeStringify({ binding, manifest }), [binding, manifest]);

  // Legacy props (optional)
  const legacyInStr  = useMemo(() => safeStringify(lastMsg), [lastMsg]);
  const legacyOutStr = useMemo(() => safeStringify(lastPublish), [lastPublish]);

  const copy = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  }, []);

  return (
    <Card className="p-4 text-xs leading-5 space-y-4 bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-wide">🔧 Debug Dashboard</h2>
          <Badge variant="outline">tab: {boundTabId ?? "—"}</Badge>
          <Badge variant="outline">route: {route}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={toggleExpandAll}>
            {expandAll ? 'Collapse all' : 'Expand all'}
          </Button>
          <Button size="sm" variant="outline" onClick={pauseAll}>Pause all</Button>
          <Button size="sm" variant="outline" onClick={resumeAll}>Resume all</Button>
          <Button size="sm" variant="destructive" onClick={clearAll}>Clear all</Button>
        </div>
      </div>

      {/* Status summary */}
      <InfoGrid
        items={[
          ["Binding", isBound ? <Badge className="bg-emerald-600 text-white">Bound</Badge> : <Badge variant="destructive">Unbound</Badge>],
          ["Hydration key", <code>{hydratedKey ?? "—"}</code>],
          ["Selections", <>UI {selectedTraces.size} · Persisted {persistedSel}</>],
          ["Stored results", <>{persistedRes}</>],
          ["Run", <>
            {running ? <Badge className="bg-blue-600 text-white">Running</Badge> : <Badge variant="outline">Idle</Badge>}
            {' '}total {totalTraces} · done {doneTraces} · cost {Number(runCost ?? 0).toFixed(4)}
          </>],
          ["Updated", <code>{ts}</code>],
        ]}
      />

      {/* Inbound / Outbound / Config histories (TAB-SCOPED) */}
      <HistorySection
        accentTitle="Inbound envelopes"
        subtitle="console → page (this tab only)"
        count={inbound.length}
        paused={pauseIn}
        onPauseToggle={() => setPauseIn(v => !v)}
        onClear={() => setInbound([])}
        events={inbound}
        expandAll={expandAll}
      />
      <HistorySection
        accentTitle="Outbound envelopes"
        subtitle="page → console (this tab only)"
        count={outbound.length}
        paused={pauseOut}
        onPauseToggle={() => setPauseOut(v => !v)}
        onClear={() => setOutbound([])}
        events={outbound}
        expandAll={expandAll}
      />
      <HistorySection
        accentTitle="Page Config changes"
        subtitle="route+tab persistence (usePageConfig)"
        count={cfgHist.length}
        paused={pauseCfg}
        onPauseToggle={() => setPauseCfg(v => !v)}
        onClear={() => setCfgHist([])}
        events={cfgHist}
        expandAll={expandAll}
        headerExtras={
          <div className="flex items-center gap-2">
            <Badge variant="outline">keys: {Object.keys(config ?? {}).length}</Badge>
            <Badge variant="outline">selected: {persistedSel}</Badge>
            <Badge variant="outline">results: {persistedRes}</Badge>
          </div>
        }
      />

      {/* Current snapshots */}
      <SectionHeader label="Current Page Config" subtitle="route+tab scope" />
      <div className="flex items-center justify-end gap-2 mb-2">
          <Button size="sm" variant="outline" onClick={() => copy(cfgExact)}>Copy (exact)</Button>
          <Button size="sm" variant="outline" onClick={() => copy(cfgStable)}>Copy (stable)</Button>
      </div>
      <JsonBox value={config} jsonString={cfgStr} expandAll={expandAll} onCopy={() => copy(cfgStr)} />

      <SectionHeader label="Binding & Manifest" subtitle="console store (bindings-only manifest)" />
      <div className="flex items-center justify-end gap-2 mb-2">
          <Button size="sm" variant="outline" onClick={() => copy(stringifyExact({ binding, manifest }))}>Copy (exact)</Button>
          <Button size="sm" variant="outline" onClick={() => copy(stringifyStable({ binding, manifest }))}>Copy (stable)</Button>
      </div>
      <JsonBox value={{ binding, manifest }} jsonString={manifestStr} expandAll={expandAll} onCopy={() => copy(manifestStr)} />

      {/* Legacy panels (optional) */}
      {(lastMsg || lastPublish) && (
        <>
          <SectionHeader label="Legacy bus (compat)" subtitle="lastMsg / lastPublish" />
          <div className="space-y-2">
            <JsonSection
              title="Legacy: lastMsg"
              subtitle={lastMsg?.topic ? `topic: ${lastMsg.topic}` : '—'}
              json={lastMsg}
              jsonString={legacyInStr}
              expandAll={expandAll}
              onCopy={() => copy(legacyInStr)}
            />
            <JsonSection
              title="Legacy: lastPublish"
              subtitle={lastPublish?.topic ? `topic: ${lastPublish.topic}` : '—'}
              json={lastPublish}
              jsonString={legacyOutStr}
              expandAll={expandAll}
              onCopy={() => copy(legacyOutStr)}
            />
          </div>
        </>
      )}
    </Card>
  );
}

/* ============================== UI Bits ============================== */

function SectionHeader({ label, subtitle }: { label: string; subtitle?: string }) {
  return (
    <div className="flex items-end justify-between border-b pb-1">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold tracking-wide">{label}</h3>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
  );
}

function InfoGrid({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <div className="grid grid-cols-[160px,1fr] gap-x-2 gap-y-1">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <div className="text-muted-foreground">{k}:</div>
            <div>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistorySection({
  accentTitle,
  subtitle,
  count,
  paused,
  onPauseToggle,
  onClear,
  events,
  expandAll,
  headerExtras,
}: {
  accentTitle: string;
  subtitle?: string;
  count: number;
  paused: boolean;
  onPauseToggle: () => void;
  onClear: () => void;
  events: EventRow[];
  expandAll: boolean;
  headerExtras?: React.ReactNode;
}) {
  return (
    <Card className="p-0 bg-background/50 border">
      <div className="px-3 py-2 flex items-center justify-between border-b bg-accent/30">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold">{accentTitle}</h3>
          <Badge variant="outline">{count}</Badge>
          {subtitle && <span className="text-[11px] text-muted-foreground">— {subtitle}</span>}
          {headerExtras}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onPauseToggle}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" variant="destructive" onClick={onClear}>Clear</Button>
        </div>
      </div>

      <div className="rounded-md overflow-hidden">
        {/* header row */}
        <div className="grid grid-cols-[18px,190px,1fr] items-center text-[11px] font-medium bg-accent/60 text-accent-foreground px-2 py-1 sticky top-0 z-10">
          <div />
          <div>Time (ISO)</div>
          <div>Summary</div>
        </div>
        {/* rows */}
        <div className="max-h-80 overflow-auto">
          {events.length === 0 ? (
            <div className="text-muted-foreground text-[11px] px-2 py-2">No events yet for this tab.</div>
          ) : (
            events.map((e, i) => <HistoryRow key={`${e.ts}-${i}`} row={e} expandAll={expandAll} />)
          )}
        </div>
      </div>
    </Card>
  );
}

function HistoryRow({ row, expandAll }: { row: EventRow; expandAll: boolean }) {
  const [open, setOpen] = useState(false);
  const jsonStr = safeStringify(row.data);

  return (
    <div className={["border-t first:border-t-0", open ? "bg-accent/25" : "odd:bg-background"].join(" ")}>
      <button
        className="grid grid-cols-[18px,190px,1fr] items-center text-[11px] px-2 py-1 w-full text-left"
        onClick={() => setOpen(v => !v)}
        title="Click to expand"
      >
        <span className="font-mono">{open ? "▾" : "▸"}</span>
        <code className="truncate">{row.ts}</code>
        <div className="truncate" title={row.summary}>{row.summary}</div>
      </button>
      {open && (
        <div className="px-2 pb-2">
          <div className="rounded border bg-background p-2 max-h-72 overflow-auto">
            <JSONView value={row.data} expandAll={expandAll} />
          </div>
          <div className="flex items-center justify-end mt-1">
            <Button size="xs" variant="outline" onClick={() => navigator.clipboard.writeText(jsonStr).catch(() => {})}>
              Copy JSON
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== JSON Helpers ============================== */

function JsonSection({
  title,
  subtitle,
  json,
  jsonString,
  expandAll,
  onCopy,
}: {
  title: string;
  subtitle?: string;
  json: any;
  jsonString: string;
  expandAll: boolean;
  onCopy: () => void;
}) {
  const size = jsonString?.length ?? 0;
  const prettySize = `${(size / 1024).toFixed(1)} KB`;

  return (
    <Collapsible defaultOpen={false}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="outline">{title}</Button>
          </CollapsibleTrigger>
          {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
          <Badge variant="outline">{prettySize}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onCopy}>Copy JSON</Button>
        </div>
      </div>
      <CollapsibleContent className="mt-2">
        <div className="rounded border bg-background p-2 max-h-80 overflow-auto">
          <JSONView value={json} expandAll={expandAll} />
        </div>
      </CollapsibleContent>
      <div className="flex items-center justify-end gap-2 mt-1">
          <Button size="xs" variant="outline"
            onClick={() => navigator.clipboard.writeText(stringifyExact(row.data)).catch(() => {})}>
            Copy JSON (exact order)
          </Button>
          <Button size="xs" variant="outline"
            onClick={() => navigator.clipboard.writeText(stringifyStable(row.data)).catch(() => {})}>
            Copy JSON (stable keys)
          </Button>
      </div>
    </Collapsible>
  );
}

function JsonBox({
  value,
  jsonString,
  expandAll,
  onCopy,
}: {
  value: any;
  jsonString: string;
  expandAll: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-muted-foreground">size {(jsonString.length/1024).toFixed(1)} KB</div>
        <Button size="xs" variant="outline" onClick={onCopy}>Copy JSON</Button>
      </div>
      <div className="max-h-80 overflow-auto">
        <JSONView value={value} expandAll={expandAll} />
      </div>
    </div>
  );
}

function JSONView({ value, expandAll }: { value: any; expandAll?: boolean }) {
  return (
    <div className="font-mono text-[11px] leading-5">
      <JSONNode name={undefined} value={value} level={0} expandAll={!!expandAll} />
    </div>
  );
}

function JSONNode({ name, value, level, expandAll }: { name?: string; value: any; level: number; expandAll: boolean }) {
  const [open, setOpen] = useState(expandAll || level < 1);
  useEffect(() => setOpen(expandAll || level < 1), [expandAll, level]);

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

  const entries = isArr ? (value as any[]).map((v, i) => [String(i), v] as const)
                        : Object.entries(value as Record<string, any>);
  const summary = isArr ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div>
      <button
        className="text-left w-full hover:bg-accent/40 rounded px-1"
        onClick={() => setOpen((v) => !v)}
      >
        {name !== undefined && <span className="text-muted-foreground">{name}: </span>}
        <span className="font-semibold">{isArr ? 'Array' : 'Object'}</span>{' '}
        <span className="text-muted-foreground">{summary}</span>
      </button>
      {open && (
        <div className="pl-3 border-l ml-1">
          {entries.map(([k, v]) => (
            <JSONNode key={k} name={k} value={v} level={level + 1} expandAll={expandAll} />
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

/* ============================== utils ============================== */

function stringifyExact(value: any): string {
  // preserves insertion order; still guards BigInt/circular
  const seen = new WeakSet();
  return JSON.stringify(
    value,
    (key, val) => {
      if (typeof val === "bigint") return val.toString();  // JSON can't handle BigInt
      if (val && typeof val === "object") {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    },
    2
  ) ?? "";
}

function stringifyStable(value: any): string {
  // sorts keys for deterministic diffs
  const seen = new WeakSet();
  const replacer = (_k: string, val: any) => {
    if (typeof val === "bigint") return val.toString();
    if (val && typeof val === "object") {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
      if (Array.isArray(val)) return val;
      // sort keys for stability
      const out: Record<string, any> = {};
      for (const k of Object.keys(val).sort()) out[k] = val[k];
      return out;
    }
    return val;
  };
  try { return JSON.stringify(value, replacer, 2) ?? ""; } catch { return ""; }
}

function envSig(evt: any) {
  return safeStringify({
    tabId: evt?.tabId,
    type: evt?.type,
    ts: evt?.ts,
    shape: shapeOf(evt?.payload ?? evt?.data ?? evt),
  });
}

function shapeOf(val: any): any {
  if (val == null) return val;
  if (Array.isArray(val)) return [`len:${val.length}`, ...val.slice(0, 2).map(shapeOf)];
  if (typeof val === 'object') return Object.keys(val).sort();
  return typeof val;
}