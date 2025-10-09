/** src/app/(protected)/system-b/browse-cert-specs-V4/page.tsx */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { OutlineTree, type OutlineNode, type TraceRow, type NodeStats } from "./OutlineUI";
import { usePageBusChannel } from "@/components/console/bus/useBusChannel";
import { useConsoleStore } from "@/stores/console-store";
import { usePageConfig } from "@/stores/pageConfig-store";
import { Button } from "@/components/ui/button";

import JSONView from '@uiw/react-json-view';

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

// helper to make a uuid if you need it
const makeId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);


export default function BrowseCertSpecV4Page() {
  /* ---------- route & tab binding ---------- */
  const route = usePathname() || "/";
  const { boundTabId } = usePageBusChannel("ai");

  const getBinding = useConsoleStore(s => s.getBinding);
  const setCurrentPageId = useConsoleStore(s => s.setCurrentPageId);
  const bindTabToCurrentPage = useConsoleStore(s => s.bindTabToCurrentPage);

  // 🔒 ensure pageId is stable for this tab on refresh:
  useEffect(() => {
    if (!boundTabId) return;

    const existing = getBinding(boundTabId); // { route, pageId } | undefined

    if (existing?.route === route && existing?.pageId) {
      // reuse the existing pageId so refresh doesn’t create a new one
      setCurrentPageId(existing.pageId);
    } else {
      // first time: create a pageId, publish it, and bind the tab to this page
      const newPid = makeId();
      setCurrentPageId(newPid);
      bindTabToCurrentPage(boundTabId, route);
    }
  }, [boundTabId, route, getBinding, setCurrentPageId, bindTabToCurrentPage]);


  const binding = useConsoleStore(
    s => (boundTabId ? s.getBinding(boundTabId) : undefined)
  );
  const pageId = binding?.pageId;

  const storageTabKey = boundTabId ?? undefined;
  const activeKey = `${route}::${storageTabKey ?? "—"}`;

  // ✅ DISPLAY-ONLY scoped key (tab::page) for debugging
  const displayScopedKey = boundTabId && pageId ? `${boundTabId}::${pageId}` : undefined;

  const isBound = Boolean(boundTabId && pageId);

  /* ---------- outline & traces ---------- */
  const [outline, setOutline] = useState<OutlineNode | null>(null);
  const [sectionTraces, setSectionTraces] = useState<Record<string, TraceRow[]>>({});
  const didLogOutlineRef = useRef(false);

  const [rawPayload, setRawPayload] = useState<any | null>(null);
  const [rawSize, setRawSize] = useState<number>(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [jsonOpenDepth, setJsonOpenDepth] = useState<number | boolean>(1);

  // status metrics
  const [attempt, setAttempt] = useState(0);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);

  const didRequestRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOutline = async () => {
      const ctrl = new AbortController();
      const start = performance.now();
      setAttempt((n) => n + 1);
      setLoading(true);
      setLoadError(null);
      setHttpStatus(null);
      setDurationMs(null);
      setBytes(null);

      try {
        const res = await fetch(`${BASE}/agents/cs25/outline`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        setHttpStatus(res.status);

        const data = await res.json();

        // raw payload + meta
        setRawPayload(data);
        setFetchedAt(new Date().toISOString());

        // bytes (prefer header, fallback to JSON length later)
        const headerSize = res.headers.get("content-length");
        if (headerSize) setBytes(Number(headerSize));

        // outline + traces
        setOutline(data.outline ?? null);
        setSectionTraces(data.section_traces ?? {});

        // fall back to json length if header missing
        if (!headerSize) {
          try { setBytes(JSON.stringify(data).length); } catch { /* ignore */ }
        }

        // log once
        if (!didLogOutlineRef.current) {
          // eslint-disable-next-line no-console
          console.debug("[browse-cert-specs-V4] outline loaded", {
            subparts: (data.outline?.children ?? []).length ?? 0,
            sections: Object.keys(data.section_traces ?? {}).length ?? 0,
          });
          didLogOutlineRef.current = true;
        }
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error("Outline load failed:", err);
        setLoadError(String(err?.message ?? err));
        setRawPayload({ error: String(err?.message ?? err) });
        setOutline(null);
        setSectionTraces({});
      } finally {
        setDurationMs(Math.round(performance.now() - start));
        setLoading(false);
      }

      return () => ctrl.abort();
  };

  useEffect(() => {
      if (didRequestRef.current) return; // strict mode guard
      didRequestRef.current = true;
      loadOutline();
      // no deps – run once
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backendStats = useMemo(() => {
      const outlineChildren = (rawPayload?.outline?.children ?? []) as any[];
      const subpartsCount = outlineChildren.filter((c) => c?.type === "Subpart").length;
      const sectionsCount = Object.keys(rawPayload?.section_traces ?? {}).length;
      let tracesTotal = 0;
      if (rawPayload?.section_traces) {
        for (const rows of Object.values(rawPayload.section_traces as Record<string, any[]>)) {
          tracesTotal += Array.isArray(rows) ? rows.length : 0;
        }
      }
      return { subpartsCount, sectionsCount, tracesTotal };
  }, [rawPayload]);

  /* ---------- persistence (per route + scopedTabKey) ---------- */

  // ✅ Make defaults stable so they don't re-create each render
  const defaultConfig = useMemo(() => ({ selectedTraceIds: [] as string[] }), []); // ← NEW

  const { config, update } = usePageConfig(route, storageTabKey, defaultConfig);

  // Hydration gate
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const syncingRef = useRef(false);

  /* ---------- local selections ---------- */
  const [selectedTraces, setSelectedTraces] = useState<Set<string>>(new Set());

  // When binding changes, clear local view and wait to hydrate
  useEffect(() => {
    setSelectedTraces(new Set());
    setHydratedKey(null);
  }, [activeKey]);

  // Store -> local (hydrate)
  useEffect(() => {
    const persisted = config.selectedTraceIds ?? [];
    setSelectedTraces((prev) => {
      // avoid unnecessary Set identity churn
      const next = new Set(persisted);
      let same = prev.size === next.size;
      if (same) {
        for (const id of prev) { if (!next.has(id)) { same = false; break; } }
      }
      return same ? prev : next;
    });
    setHydratedKey(activeKey);
    // eslint-disable-next-line no-console
    console.debug("[browse-cert-specs-V4] hydrated selections", {
      activeKey,
      count: persisted.length,
    });
  }, [config.selectedTraceIds, activeKey]);

  // Local -> store (after hydration, avoid loops)
  useEffect(() => {
    if (hydratedKey !== activeKey) return;
    if (syncingRef.current) return;

    const local = Array.from(selectedTraces);
    const persisted = config.selectedTraceIds ?? [];
    const same =
      local.length === persisted.length &&
      local.every((x) => persisted.includes(x));

    if (!same) {
      syncingRef.current = true;
      update({ selectedTraceIds: local });
      // eslint-disable-next-line no-console
      console.debug("[browse-cert-specs-V4] persisted selections", {
        activeKey,
        count: local.length,
      });
      queueMicrotask(() => (syncingRef.current = false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTraces, hydratedKey, activeKey]);

  /* ---------- derived UI data ---------- */
  const subparts = useMemo(
    () => ((outline?.children ?? []).filter((c) => c.type === "Subpart") as OutlineNode[]),
    [outline]
  );

  const sectionStats: Record<string, NodeStats> = useMemo(() => {
    const zero: NodeStats = { total: 0, relevant: 0, notRelevant: 0 };
    const map: Record<string, NodeStats> = {};
    for (const [sid, rows] of Object.entries(sectionTraces ?? {})) {
      const s = { ...zero };
      for (const r of rows ?? []) {
        const items = r.results ?? [];
        for (const it of items) {
          s.total += 1;
          if (it?.response?.relevant === true) s.relevant += 1;
          else if (it?.response?.relevant === false) s.notRelevant += 1;
        }
      }
      map[sid] = s;
    }
    return map;
  }, [sectionTraces]);

  /* ---------- render ---------- */
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">CS-25 — Traces by Section</h1>
        <p className="text-sm text-muted-foreground">
          Tick subparts/sections/traces to make your selections. Selections persist per tab.
        </p>
      </header>

      <section>
        <OutlineTree
          subparts={subparts}
          sectionTraces={sectionTraces}
          sectionStats={sectionStats}
          selectedTraces={selectedTraces}
          setSelectedTraces={setSelectedTraces}
        />
      </section>

      {/* ---------- Debug dashboard (binding + persistence) ---------- */}
      <section className="mt-6 space-y-4">
        {/* Binding */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="border-b px-4 py-2">
            <h2 className="text-sm font-semibold">Debug — Tab Binding</h2>
          </div>
          <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <DebugField label="Bound">
              <code>{String(isBound)}</code>
            </DebugField>
            <DebugField label="Route">
              <code className="break-all">{route}</code>
            </DebugField>
            <DebugField label="Tab ID">
              <code>{boundTabId ?? "—"}</code>
            </DebugField>
            <DebugField label="Page ID">
              <code>{pageId ?? "—"}</code>
            </DebugField>
            <DebugField label="Scoped Key (tab::page)">
              <code className="break-all">{displayScopedKey ?? "—"}</code>
            </DebugField>

            <DebugField label="Active Key (route::tab)">
              <code className="break-all">{activeKey}</code>
            </DebugField>
          </div>
          {!!binding && (
            <>
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                Binding object (from console store)
              </div>
              <pre className="m-0 max-h-56 overflow-auto px-4 py-3 text-xs bg-muted/40">
{JSON.stringify(binding, null, 2)}
              </pre>
            </>
          )}
        </div>

        {/* Persistence */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="border-b px-4 py-2">
            <h2 className="text-sm font-semibold">Debug — Persistence (this tab)</h2>
          </div>

          {/* quick meta */}
          <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <DebugField label="Hydrated">
              <code>{String(hydratedKey === activeKey)}</code>
            </DebugField>
            <DebugField label="Store Scope">
              <code className="break-all">({route}, {storageTabKey ?? "—"})</code>
            </DebugField>
            <DebugField label="Selected IDs (count)">
              <code className="tabular-nums">{config.selectedTraceIds?.length ?? 0}</code>
            </DebugField>
          </div>

          {/* toolbar */}
          <div className="border-t px-4 py-2 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Binding key:</span>
            <code className="break-all">
              {route}::{storageTabKey ?? "—"}
            </code>
            <span className="ml-3 text-muted-foreground">Size:</span>
            <code>
              {
                (() => {
                  try { return `${(JSON.stringify(config).length / 1024).toFixed(1)} KB`; }
                  catch { return "—"; }
                })()
              }
            </code>

            <div className="ml-auto flex items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  try { navigator.clipboard.writeText(JSON.stringify(config ?? {}, null, 2)); } catch {}
                }}
              >
                Copy JSON
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  try {
                    const blob = new Blob([JSON.stringify(config ?? {}, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "persisted-config.json";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                  } catch {}
                }}
              >
                Download
              </Button>
            </div>
          </div>

          {/* interactive JSON */}
          <div className="px-4 pb-3">
            <JSONView
              value={config ?? {}}
              collapsed={1}                 // expand root only; click to drill in
              displayDataTypes={false}
              enableClipboard
              shortenTextAfterLength={120}
              style={{ maxHeight: 384, overflow: 'auto', fontSize: 12 }}
            />
          </div>
        </div>

        {/* Backend payload (raw) */}
        {/* Backend payload (raw) */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="border-b px-4 py-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Debug — Backend payload</h2>

            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Status:</span>
              <code>
                {loading ? "loading…" : loadError ? "error" : rawPayload ? "ok" : "idle"}
              </code>

              <span className="ml-3 text-muted-foreground">HTTP:</span>
              <code>{httpStatus ?? "—"}</code>

              <span className="ml-3 text-muted-foreground">Duration:</span>
              <code>{durationMs != null ? `${durationMs} ms` : "—"}</code>

              <span className="ml-3 text-muted-foreground">Bytes:</span>
              <code>{bytes != null ? bytes.toLocaleString() : "—"}</code>

              <span className="ml-3 text-muted-foreground">Attempt:</span>
              <code>{attempt}</code>

              <div className="ml-3 flex items-center gap-2">
                <Button size="xs" variant="outline" onClick={loadOutline} disabled={loading}>
                  {loading ? "Loading…" : "Retry"}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    try { navigator.clipboard.writeText(JSON.stringify(rawPayload ?? {}, null, 2)); } catch {}
                  }}
                  disabled={!rawPayload}
                >
                  Copy JSON
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    try {
                      const blob = new Blob([JSON.stringify(rawPayload ?? {}, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "backend-payload.json";
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    } catch {}
                  }}
                  disabled={!rawPayload}
                >
                  Download
                </Button>
              </div>
            </div>
          </div>

          {/* quick facts (only when we have a payload) */}
          {rawPayload && (
            <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <DebugField label="Subparts">
                <code className="tabular-nums">{backendStats.subpartsCount}</code>
              </DebugField>
              <DebugField label="Sections">
                <code className="tabular-nums">{backendStats.sectionsCount}</code>
              </DebugField>
              <DebugField label="Traces (total rows)">
                <code className="tabular-nums">{backendStats.tracesTotal}</code>
              </DebugField>
            </div>
          )}

          {/* error note */}
          {loadError && (
            <div className="px-4 pb-2 text-xs text-red-600">
              {loadError}
            </div>
          )}

          {/* JSON viewer */}
          <div className="px-4 pb-3">
            <JSONView
              value={rawPayload ?? {}}
              collapsed={1}             // compact: expand root only; click to drill in
              displayDataTypes={false}
              enableClipboard
              shortenTextAfterLength={120}
              style={{ maxHeight: 384, overflow: 'auto', fontSize: 12 }}
            />
          </div>
        </div>

      </section>
    </div>
  );
}

function DebugField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-28 text-muted-foreground">{label}:</span>
      <span className="font-mono">{children}</span>
    </div>
  );
}