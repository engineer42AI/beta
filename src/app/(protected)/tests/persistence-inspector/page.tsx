// src/app/(protected)/system-b/persistence-inspector/page.tsx
'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useConsoleStore } from '@/stores/console-store';
import { usePageConfigStore } from '@/stores/pageConfig-store';

/** ---------- Types ---------- */
type LSItem = { key: string; size: number; raw: string | null; parsed?: any };

const CONSOLE_KEYS = new Set(['console-v1', 'console-v2', 'console-v3']);
const PAGECFG_KEY = 'page-config-v1'; // zustand-persist key for page configs

/** Quick fingerprint for local (same-tab) changes that bypass store subscriptions */
function fingerprintLocalStorage(): string {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)!);
    keys.sort();
    let acc = `${keys.length}|`;
    for (const k of keys) {
      const v = localStorage.getItem(k);
      acc += `${k}:${v?.length ?? 0}|`;
    }
    return acc;
  } catch {
    return Math.random().toString(36);
  }
}

export default function PersistenceInspectorPage() {
  const [items, setItems] = useState<LSItem[]>([]);
  const [ts, setTs] = useState(() => new Date().toISOString());
  const [liveMode, setLiveMode] = useState(true);
  const lastFpRef = useRef<string>('');

  /** ---- stores ---- */
  const aiBindings = useConsoleStore((s) => s.aiBindings);
  const tabsSnapshot = useConsoleStore((s) => s.tabs);
  const activeTabSnapshot = useConsoleStore((s) => s.activeTabId);

  const pageConfigsObj = usePageConfigStore((s) => s.configs);
  const listPageConfigKeys = usePageConfigStore((s) => s.listKeys);
  const clearPageConfig = usePageConfigStore((s) => s.clearConfig);
  const clearAllPageConfigs = usePageConfigStore((s) => s.clearAll);
  const clearByTabId = usePageConfigStore((s) => (s as any).clearByTabId)?.bind?.(usePageConfigStore.getState());

  /** ---- load localStorage snapshot (for raw blobs + other keys) ---- */
  const refreshLocal = useCallback(() => {
    const list: LSItem[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        const raw = localStorage.getItem(k);
        let parsed: any | undefined = undefined;
        try { parsed = raw ? JSON.parse(raw) : undefined; } catch { parsed = undefined; }
        list.push({ key: k, size: (raw?.length ?? 0), raw, parsed });
      }
    } catch { /* ignore */ }
    list.sort((a, b) => {
      const rank = (k: string) =>
        CONSOLE_KEYS.has(k) ? 0 : k === PAGECFG_KEY ? 1 : 2;
      const ra = rank(a.key), rb = rank(b.key);
      if (ra !== rb) return ra - rb;
      return a.key.localeCompare(b.key);
    });
    setItems(list);
    setTs(new Date().toISOString());
    lastFpRef.current = fingerprintLocalStorage();
  }, []);

  useEffect(() => { refreshLocal(); }, [refreshLocal]);

  // cross-tab updates
  useEffect(() => {
    const onStorage = () => refreshLocal();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshLocal]);

  // same-tab updates from console-store (tabs/bindings/layout changes) → refresh local snapshot for raw blobs
  useEffect(() => { refreshLocal(); }, [refreshLocal, aiBindings, tabsSnapshot, activeTabSnapshot]);

  // Live mode: poll to detect local changes that bypass store subscriptions (e.g., third-party code poking localStorage)
  useEffect(() => {
    if (!liveMode) return;
    const id = window.setInterval(() => {
      const fp = fingerprintLocalStorage();
      if (fp !== lastFpRef.current) refreshLocal();
    }, 300);
    return () => window.clearInterval(id);
  }, [liveMode, refreshLocal]);

  /** ---- derive groupings ---- */
  const consoleStoreItem = useMemo(
    () => items.find((i) => CONSOLE_KEYS.has(i.key)),
    [items]
  );

  const pageConfigStoreItem = useMemo(
    () => items.find((i) => i.key === PAGECFG_KEY),
    [items]
  );

  const otherLS = useMemo(
    () => items.filter((i) => !CONSOLE_KEYS.has(i.key) && i.key !== PAGECFG_KEY),
    [items]
  );

  /** ---- page-config rows (from zustand store) ---- */
  const pageCfgRows = useMemo(() => {
    const keys = listPageConfigKeys();
    keys.sort();
    return keys.map((k) => {
      const val = (pageConfigsObj as any)[k];
      const size = (() => {
        try { return (JSON.stringify(val)?.length ?? 0); } catch { return 0; }
      })();
      return { key: k, size, value: val };
    });
  }, [pageConfigsObj, listPageConfigKeys]);

  /** ---- Live bindings (read-only) ---- */
  const liveBindingKeys = useMemo(() => {
    const out = new Set<string>();
    for (const [tabId, b] of Object.entries(aiBindings ?? {})) {
      const route = (b as any)?.route;
      if (!route) continue;
      out.add(`${route}::${tabId}`);
    }
    return out;
  }, [aiBindings]);

  /** ---- UI ---- */
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Persistence Inspector</h1>
            <p className="text-sm text-muted-foreground">
              Live view of persisted data. Sections show the <em>raw</em> localStorage blobs
              and a structured view of Page Configs from the Zustand store. No background GC is used; configs are cleared when tabs close.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Updated: {ts}</Badge>
            <Button size="sm" variant={liveMode ? 'default' : 'outline'} onClick={() => setLiveMode(v => !v)}>
              {liveMode ? 'Live: On' : 'Live: Off'}
            </Button>
          </div>
        </div>
      </header>

      <section className="space-y-4">
        {/* ---- Live Bindings (read-only) ---- */}
        <Card className="p-4 space-y-2">
          <SectionHeader label="Live Bindings" subtitle="route::tabId derived from console store (read-only)" />
          {Array.from(liveBindingKeys).length === 0 && (
            <div className="text-xs text-muted-foreground">No live bindings.</div>
          )}
          {Array.from(liveBindingKeys).map((k) => (
            <div key={k} className="flex items-center justify-between rounded border px-2 py-1">
              <code className="text-xs">{k}</code>
              <Badge variant="outline">active</Badge>
            </div>
          ))}
        </Card>

        {/* ---- Console Store (raw) ---- */}
        <Card className="p-4">
          <SectionHeader label="Console Store (raw)" subtitle="zustand persist JSON under console-v*" />
          {consoleStoreItem ? (
            <EntryCard item={consoleStoreItem} />
          ) : (
            <div className="text-xs text-muted-foreground">No console store found.</div>
          )}
        </Card>

        {/* ---- Page Configs: structured (from store) ---- */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeader label="Page Configs" subtitle="per (route::tabId), sourced from Zustand store" />
            <div className="flex items-center gap-2">
              <Badge variant="outline">{pageCfgRows.length} bindings</Badge>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (!confirm('Delete ALL page-config entries (Zustand store)? This cannot be undone.')) return;
                  try { clearAllPageConfigs(); } catch {}
                  refreshLocal();
                }}
              >
                Clear ALL
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {pageCfgRows.map((row) => (
              <PageConfigRow
                key={row.key}
                bindingKey={row.key}
                size={row.size}
                value={row.value}
                onDelete={() => {
                  const [route, tabId] = row.key.split('::');
                  if (!route || !tabId) return;
                  if (!confirm(`Delete page-config for "${row.key}"?`)) return;
                  clearPageConfig(route, tabId);
                  refreshLocal();
                }}
                onDeleteAllForTab={() => {
                  const [, tabId] = row.key.split('::');
                  if (!tabId || !clearByTabId) return;
                  if (!confirm(`Delete ALL page-config entries for tabId "${tabId}" across routes?`)) return;
                  try { clearByTabId(tabId); } catch {}
                  refreshLocal();
                }}
              />
            ))}
            {pageCfgRows.length === 0 && (
              <div className="text-xs text-muted-foreground">No page-config entries.</div>
            )}
          </div>
        </Card>

        {/* ---- Page Config Store (raw blob) ---- */}
        <Card className="p-4">
          <SectionHeader label="Page Config Store (raw)" subtitle={`zustand persist JSON under ${PAGECFG_KEY}`} />
          {pageConfigStoreItem ? (
            <EntryCard item={pageConfigStoreItem} />
          ) : (
            <div className="text-xs text-muted-foreground">No page-config store blob in localStorage.</div>
          )}
        </Card>

        {/* ---- Other keys (everything else) ---- */}
        <Card className="p-4 space-y-2">
          <SectionHeader label="Other Keys (raw)" subtitle="any remaining localStorage entries" />
          {otherLS.length === 0 && (
            <div className="text-xs text-muted-foreground">No other keys.</div>
          )}
          {otherLS.map((it) => (
            <EntryRow key={it.key} item={it} onDeleted={refreshLocal} />
          ))}
        </Card>
      </section>
    </div>
  );
}

/* ================= UI Bits ================= */

function SectionHeader({ label, subtitle }: { label: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-base font-semibold">{label}</h2>
      {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

function EntryCard({ item }: { item: LSItem }) {
  return (
    <div className="rounded-md border">
      <EntryHeader item={item} />
      <div className="p-2">
        <JSONBox value={item.parsed ?? item.raw} />
      </div>
    </div>
  );
}

function EntryRow({ item, onDeleted }: { item: LSItem; onDeleted: () => void }) {
  return (
    <div className="rounded-md border">
      <EntryHeader item={item} onDeleted={onDeleted} />
      <Collapsible>
        <div className="px-2 pb-2">
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="outline">Inspect</Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="p-2 pt-0">
            <JSONBox value={item.parsed ?? item.raw} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function PageConfigRow({
  bindingKey,
  size,
  value,
  onDelete,
  onDeleteAllForTab,
}: {
  bindingKey: string;
  size: number;
  value: any;
  onDelete: () => void;
  onDeleteAllForTab: () => void;
}) {
  const [open, setOpen] = useState(false);
  const parts = bindingKey.split('::');
  const route = parts[0] ?? '—';
  const tabId = parts[1] ?? '—';

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between p-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <code className="text-xs">{bindingKey}</code>
          <Badge variant="outline">{(size / 1024).toFixed(1)} KB</Badge>
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/40">
            route: <code>{route}</code>
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/40">
            tabId: <code>{tabId}</code>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <CopyButtons value={value} />
          <Button size="sm" variant="outline" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide' : 'Inspect'}
          </Button>
          <Button size="sm" variant="outline" onClick={onDeleteAllForTab} title="Delete all route entries for this tabId">
            Delete (tabId)
          </Button>
          <Button size="sm" variant="destructive" onClick={onDelete}>
            Delete (this key)
          </Button>
        </div>
      </div>
      {open && (
        <div className="p-2">
          <JSONBox value={value} />
        </div>
      )}
    </div>
  );
}

function EntryHeader({ item, onDeleted }: { item: LSItem; onDeleted?: () => void }) {
  const remove = useCallback(() => {
    if (!confirm(`Delete "${item.key}"?`)) return;
    try { localStorage.removeItem(item.key); } catch {}
    onDeleted?.();
  }, [item.key, onDeleted]);

  return (
    <div className="flex items-center justify-between p-2 border-b bg-muted/30">
      <div className="flex items-center gap-2">
        <code className="text-xs">{item.key}</code>
        <Badge variant="outline">{(item.size / 1024).toFixed(1)} KB</Badge>
      </div>
      <div className="flex items-center gap-2">
        <CopyButtons value={item.parsed ?? item.raw} />
        {onDeleted && (
          <Button size="sm" variant="destructive" onClick={remove}>Delete</Button>
        )}
      </div>
    </div>
  );
}

function CopyButtons({ value }: { value: any }) {
  const exact = useMemo(() => stringifyExact(value), [value]);
  const stable = useMemo(() => stringifyStable(value), [value]);
  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => copy(exact)}>Copy (exact)</Button>
      <Button size="sm" variant="outline" onClick={() => copy(stable)}>Copy (stable)</Button>
    </div>
  );
}

/* ================= JSON Viewer ================= */

function JSONBox({ value }: { value: any }) {
  return (
    <div className="rounded border bg-background p-2 max-h-96 overflow-auto">
      <JSONView value={value} />
    </div>
  );
}

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
        onClick={() => setOpen((v) => !v)}
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

/* ================= Stringify helpers ================= */

function stringifyExact(value: any): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (_k, val) => {
        if (typeof val === 'bigint') return val.toString();
        if (val && typeof val === 'object') {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      },
      2
    ) ?? '';
  } catch {
    try { return JSON.stringify(value) ?? ''; } catch { return ''; }
  }
}

function stringifyStable(value: any): string {
  const seen = new WeakSet();
  const replacer = (_k: string, val: any) => {
    if (typeof val === 'bigint') return val.toString();
    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
      if (Array.isArray(val)) return val;
      const out: Record<string, any> = {};
      for (const k of Object.keys(val).sort()) out[k] = val[k];
      return out;
    }
    return val;
  };
  try { return JSON.stringify(value, replacer, 2) ?? ''; } catch { return ''; }
}