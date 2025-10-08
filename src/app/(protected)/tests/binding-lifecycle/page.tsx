'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useConsoleStore } from '@/stores/console-store';

/* -------------------- Helpers -------------------- */

type Health = 'good' | 'warn' | 'bad' | 'idle';

const now = () => Date.now();
const msSince = (ts?: number | null) => (ts ? now() - ts : Infinity);
function healthFrom(lastIn?: number | null, lastOut?: number | null): Health {
  const delta = Math.min(msSince(lastIn), msSince(lastOut));
  if (!Number.isFinite(delta)) return 'idle';
  if (delta < 5_000) return 'good';
  if (delta < 30_000) return 'warn';
  return 'bad';
}
function fmtAge(ts?: number | null) {
  if (!ts) return '—';
  const ms = now() - ts;
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/* -------------------- Tiny JSON inspector -------------------- */

function JSONBox({ value }: { value: any }) {
  return (
    <div className="rounded-md border bg-background p-2 max-h-96 overflow-auto">
      <JSONView value={value} />
    </div>
  );
}
function JSONView({ value }: { value: any }) {
  return <div className="font-mono text-[11px] leading-5"><JSONNode value={value} level={0} /></div>;
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
      <button className="text-left w-full hover:bg-accent/40 rounded px-1" onClick={() => setOpen(v => !v)}>
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

/* -------------------- Fixed-width Health pill -------------------- */

function HealthPill({ health }: { health: Health }) {
  const map: Record<Health, { label: string; cls: string }> = {
    good: { label: 'Healthy', cls: 'bg-emerald-600 text-white' },
    warn: { label: 'Stale', cls: 'bg-amber-500 text-white' },
    bad:  { label: 'Disconnected', cls: 'bg-red-600 text-white' },
    idle: { label: 'Idle', cls: 'bg-muted text-foreground' },
  };
  const { label, cls } = map[health];
  // fixed width so the cell never changes width when status changes
  return <Badge className={`h-6 w-[112px] justify-center ${cls}`}>{label}</Badge>;
}

/* -------------------- Page -------------------- */

export default function BindingLifecyclePage() {
  const tabs = useConsoleStore(s => s.tabs.ai);
  const activeTabId = useConsoleStore(s => s.activeTabId.ai);
  const aiBindings = useConsoleStore(s => s.aiBindings);

  const setActiveTab = useConsoleStore(s => s.setActiveTab);
  const sendToPage   = useConsoleStore(s => s.sendToPage);
  const closeTab     = useConsoleStore(s => s.closeTab);
  const getBinding   = useConsoleStore(s => s.getBinding);
  const getManifest  = useConsoleStore(s => s.getManifest);

  const lastToPage    = useConsoleStore(s => s.lastMessage);      // console→page
  const lastToConsole = useConsoleStore(s => s.lastConsoleEvent); // page→console

  const [activity, setActivity] = useState<Record<string, {
    lastOutTs?: number; lastOutEnv?: any;
    lastInTs?: number;  lastInEnv?: any;
  }>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);

  // live activity feeds
  useEffect(() => {
    if (!lastToPage) return;
    setActivity(prev => {
      const next = { ...prev };
      const t = lastToPage.tabId;
      next[t] = { ...(next[t] ?? {}), lastOutTs: lastToPage.ts, lastOutEnv: lastToPage };
      return next;
    });
  }, [lastToPage]);

  useEffect(() => {
    if (!lastToConsole) return;
    setActivity(prev => {
      const next = { ...prev };
      const t = lastToConsole.tabId;
      next[t] = { ...(next[t] ?? {}), lastInTs: lastToConsole.ts, lastInEnv: lastToConsole };
      return next;
    });
  }, [lastToConsole]);

  // smooth age ticker
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(x => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // build rows grouped by route, preserving the console's original tab order
  const groups = useMemo(() => {
      const rows = (tabs ?? []).map((t) => {
        const b = getBinding(t.id);
        const m = getManifest(t.id);
        const a = activity[t.id] ?? {};
        const health = healthFrom(a.lastInTs, a.lastOutTs);

        return {
          tabId: t.id,
          title: t.title,
          active: t.id === activeTabId, // UI-only; does not affect order
          route: b?.route ?? '—',
          pageId: b?.pageId ?? '—',
          binding: b,
          manifest: m,
          lastInTs: a.lastInTs ?? null,
          lastOutTs: a.lastOutTs ?? null,
          lastInEnv: a.lastInEnv,
          lastOutEnv: a.lastOutEnv,
          health,
        };
      });

      // Group by first-seen route; keep row order as in `tabs`
      const map = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = r.route;
        const arr = map.get(key);
        if (arr) arr.push(r);
        else map.set(key, [r]);
      }
      return map;
  }, [tabs, aiBindings, activeTabId, activity, getBinding, getManifest]);

  const focusTab = useCallback((tabId: string) => setActiveTab('ai', tabId), [setActiveTab]);
  const pingTab = useCallback((tabId: string) => {
    sendToPage(tabId, { type: 'ping', from: 'binding-lifecycle', ts: Date.now() });
  }, [sendToPage]);
  const closeTabSafe = useCallback((tabId: string) => {
    if (!confirm(`Close AI tab "${tabId}"? This also clears its page-config.`)) return;
    closeTab('ai', tabId);
    if (openRow === tabId) setOpenRow(null);
  }, [closeTab, openRow]);

  const totalTabs = tabs?.length ?? 0;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-5 text-[12px] leading-5 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Binding &amp; Tab Lifecycle</h1>
          <p className="text-xs text-muted-foreground">Live view of AI tabs and their bindings. Health updates in real time.</p>
        </div>
        <Badge variant="outline" className="text-xs">{totalTabs} AI Tabs</Badge>
      </div>

      {/* Grid header */}
      <Card>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.8fr)_auto_72px_72px_auto] items-center gap-x-3 px-3 py-2 bg-muted/40 text-[11px] font-medium text-muted-foreground">
          <div>Tab</div>
          <div>Route</div>
          <div>Binding</div>
          <div>Status</div>
          <div className="text-right">Page→C</div>
          <div className="text-right">C→Page</div>
          <div className="text-right">Actions</div>
        </div>

        {/* Groups */}
        {[...groups.entries()].map(([route, rows]) => (
          <div key={route} className="border-t">
            {/* Group header */}
            <div className="px-3 py-2 bg-accent/20 flex items-center justify-between">
              <code className="text-[11px] px-2 py-0.5 rounded bg-background/60 border break-all">{route}</code>
              <Badge variant="outline" className="text-[11px]">{rows.length} tab(s)</Badge>
            </div>

            {/* Rows */}
            {rows.map(r => (
              <div key={r.tabId} className="border-t">
                {/* Data row */}
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.8fr)_auto_72px_72px_auto] items-center gap-x-3 px-3 py-2">
                  {/* Tab */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium" title={r.title}>{r.title}</span>
                      <Badge variant={r.active ? 'default' : 'outline'} className="rounded-full">{r.tabId}</Badge>
                    </div>
                  </div>

                  {/* Route */}
                  <div className="min-w-0">
                    <code className="text-[11px] text-muted-foreground break-all">{r.route}</code>
                  </div>

                  {/* Binding */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-accent/40 text-[11px] break-all" title={r.pageId}>
                        pageId: <code>{r.pageId}</code>
                      </span>
                      <Button size="xs" variant="outline" onClick={() => setOpenRow(prev => prev === r.tabId ? null : r.tabId)}>
                        {openRow === r.tabId ? 'Hide' : 'Inspect'}
                      </Button>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="shrink-0">
                    <HealthPill health={r.health} />
                  </div>

                  {/* Ages */}
                  <div className="text-right tabular-nums text-[11px]">{fmtAge(r.lastInTs)}</div>
                  <div className="text-right tabular-nums text-[11px]">{fmtAge(r.lastOutTs)}</div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1 shrink-0">
                    <Button size="xs" variant="outline" onClick={() => focusTab(r.tabId)}>Focus</Button>
                    <Button size="xs" variant="outline" onClick={() => pingTab(r.tabId)}>Ping</Button>
                    <Button size="xs" variant="destructive" onClick={() => closeTabSafe(r.tabId)}>Close</Button>
                  </div>
                </div>

                {/* Inspector row */}
                {openRow === r.tabId && (
                  <div className="px-3 pb-3">
                    <div className="rounded-md border bg-accent/10 p-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] font-medium mb-1">Binding</div>
                          <JSONBox value={r.binding} />
                        </div>
                        <div>
                          <div className="text-[11px] font-medium mb-1">Manifest</div>
                          <JSONBox value={r.manifest} />
                        </div>
                      </div>
                      <Separator />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] font-medium mb-1">Last Envelope (Page→Console)</div>
                          <JSONBox value={r.lastInEnv ?? '—'} />
                        </div>
                        <div>
                          <div className="text-[11px] font-medium mb-1">Last Envelope (Console→Page)</div>
                          <JSONBox value={r.lastOutEnv ?? '—'} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        {groups.size === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground border-t">
            No AI tabs are currently open.
          </div>
        )}
      </Card>

      {/* Legend */}
      <Card className="p-3 space-y-2">
        <h2 className="text-xs font-semibold">Legend</h2>
        <div className="text-[11px] space-y-1 text-muted-foreground">
          <div><strong>Tab</strong> — Console tab name and <code>tabId</code> (pill). Highlighted pill = active tab.</div>
          <div><strong>Route</strong> — Next.js route bound to the tab.</div>
          <div><strong>Binding</strong> — Binding summary with <code>pageId</code>. Use “Inspect” to view raw <code>binding</code> and <code>manifest</code>, plus last envelopes.</div>
          <div className="flex flex-wrap items-center gap-2">
            <strong>Status</strong>
            <span>— last bus activity:</span>
            <span className="inline-flex items-center gap-1"><Badge className="bg-emerald-600 text-white w-[90px] justify-center">Healthy</Badge> <span>&lt;5s</span></span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Badge className="bg-amber-500 text-white w-[90px] justify-center">Stale</Badge> <span>&lt;30s</span></span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Badge className="bg-red-600 text-white w-[90px] justify-center">Disconnected</Badge> <span>≥30s</span></span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Badge className="bg-muted w-[90px] justify-center">Idle</Badge> <span>no events</span></span>
          </div>
          <div><strong>Page→Console / Console→Page</strong> — Age since last envelope (mm:ss).</div>
        </div>
      </Card>
    </div>
  );
}