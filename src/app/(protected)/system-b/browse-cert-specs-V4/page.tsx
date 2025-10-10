/** src/app/(protected)/system-b/browse-cert-specs-V4/page.tsx */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { OutlineTree, type OutlineNode, type TraceRow, type NodeStats } from "./OutlineUI";
import { usePageBusChannel } from "@/components/console/bus/useBusChannel";
import { useConsoleStore } from "@/stores/console-store";
import { usePageConfig } from "@/stores/pageConfig-store";
import PageDebuggingDashboard from "./page_debugging_dashboard";

import { orchestrator } from "@/lib/pageOrchestrator";

import { registerOutlineHandlers, WF } from "./outline.handlers";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

const makeId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function BrowseCertSpecV4Page() {
  const route = usePathname() || "/";
  const { boundTabId } = usePageBusChannel("ai");

  const getBinding = useConsoleStore(s => s.getBinding);
  const setCurrentPageId = useConsoleStore(s => s.setCurrentPageId);
  const bindTabToCurrentPage = useConsoleStore(s => s.bindTabToCurrentPage);

  useEffect(() => {
    if (!boundTabId) return;
    const existing = getBinding(boundTabId);
    if (existing?.route === route && existing?.pageId) {
      setCurrentPageId(existing.pageId);
    } else {
      const newPid = makeId();
      setCurrentPageId(newPid);
      bindTabToCurrentPage(boundTabId, route);
    }
  }, [boundTabId, route, getBinding, setCurrentPageId, bindTabToCurrentPage]);

  const binding = useConsoleStore(s => (boundTabId ? s.getBinding(boundTabId) : undefined));
  const pageId = binding?.pageId;

  const storageTabKey = boundTabId ?? undefined;
  const activeKey = `${route}::${storageTabKey ?? "—"}`;
  const displayScopedKey = boundTabId && pageId ? `${boundTabId}::${pageId}` : undefined;
  const isBound = Boolean(boundTabId && pageId);

  /* ---------- outline & traces (now fed by orchestrator) ---------- */
  const [outline, setOutline] = useState<OutlineNode | null>(null);
  const [sectionTraces, setSectionTraces] = useState<Record<string, TraceRow[]>>({});

  const [rawPayload, setRawPayload] = useState<any | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);

  // Configure orchestrator (binding + how to handle messages to the page)
  useEffect(() => {
      if (boundTabId) { try { (orchestrator as any).purgeWireForTab?.(boundTabId); } catch {} }

      orchestrator.configure({
        getBinding: () => ({ route, pageId: pageId ?? undefined, tabId: boundTabId ?? undefined }),
        onDeliver: ({ to, channel, payload, metadata }) => {
          if (to !== "page") return;
          if (channel !== WF.OUTLINE_LOAD) return;

          const evt = metadata?.event as string | undefined;

          if (evt === "started") {
            setAttempt(n => n + 1);
            setLoading(true);
            setLoadError(null);
            setHttpStatus(null);
            setDurationMs(null);
            setBytes(null);
            return;
          }

          if (evt === "progress") {
            if (typeof metadata?.httpStatus === "number") setHttpStatus(metadata.httpStatus);
            if (typeof metadata?.bytes === "number") setBytes(metadata.bytes);
            if (typeof metadata?.durationMs === "number") setDurationMs(metadata.durationMs);
            return;
          }

          if (evt === "success") {
            // payload IS the RAW backend JSON
            const raw = payload ?? null;
            setRawPayload(raw);
            setOutline(raw?.outline ?? null);
            setSectionTraces(raw?.section_traces ?? {});
            setHttpStatus(typeof metadata?.httpStatus === "number" ? metadata.httpStatus : null);
            setBytes(typeof metadata?.bytes === "number" ? metadata.bytes : null);
            setLoading(false);
            return;
          }

          if (evt === "error") {
            setLoading(false);
            setLoadError(metadata?.message ?? "Unknown error");
            setHttpStatus(typeof metadata?.httpStatus === "number" ? metadata.httpStatus : null);
            return;
          }
        },
      });

      // (re)register page handlers
      registerOutlineHandlers();

      return () => {
        orchestrator.unregisterAllHandlers();
      };
  }, [route, pageId, boundTabId]);

  const didRequestRef = useRef(false);

  // once per bind (your didRequestRef logic is fine)
  useEffect(() => {
      if (!pageId || !boundTabId) return;
      if (didRequestRef.current) return;
      didRequestRef.current = true;
      orchestrator.deliver({
        from: "page",
        to: "orchestrator",
        channel: WF.OUTLINE_LOAD,   // simple instruction
        payload: null,
        metadata: undefined,
      });
  }, [pageId, boundTabId, route]);

  /* ---------- persistence & selections (unchanged) ---------- */
  const defaultConfig = useMemo(() => ({ selectedTraceIds: [] as string[] }), []);
  const { config, update } = usePageConfig(route, storageTabKey, defaultConfig);

  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const [selectedTraces, setSelectedTraces] = useState<Set<string>>(new Set());

  useEffect(() => { setSelectedTraces(new Set()); setHydratedKey(null); }, [activeKey]);

  useEffect(() => {
    const persisted = config.selectedTraceIds ?? [];
    setSelectedTraces(prev => {
      const next = new Set(persisted);
      let same = prev.size === next.size;
      if (same) for (const id of prev) { if (!next.has(id)) { same = false; break; } }
      return same ? prev : next;
    });
    setHydratedKey(activeKey);
    // eslint-disable-next-line no-console
    console.debug("[V4] hydrated selections", { activeKey, count: persisted.length });
  }, [config.selectedTraceIds, activeKey]);

  useEffect(() => {
    if (hydratedKey !== activeKey) return;
    if (syncingRef.current) return;
    const local = Array.from(selectedTraces);
    const persisted = config.selectedTraceIds ?? [];
    const same = local.length === persisted.length && local.every(x => persisted.includes(x));
    if (!same) {
      syncingRef.current = true;
      update({ selectedTraceIds: local });
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
         {loadError ? (
           <div className="text-sm text-red-600">
             {loadError}
           </div>
         ) : !isBound ? (
           <div className="text-sm text-muted-foreground">Open an AI tab to begin…</div>
         ) : loading ? (
           <div className="text-sm text-muted-foreground">Loading outline…</div>
         ) : outline ? (
           <OutlineTree
             subparts={subparts}
             sectionTraces={sectionTraces}
             sectionStats={sectionStats}
             selectedTraces={selectedTraces}
             setSelectedTraces={setSelectedTraces}
           />
         ) : (
           <div className="text-sm text-muted-foreground">No outline loaded.</div>
         )}
      </section>

      {/* Debug dashboard you already have; it will reflect the orchestrator pulses */}
      <PageDebuggingDashboard
        isBound={Boolean(boundTabId && pageId)}
        route={route}
        boundTabId={boundTabId ?? null}
        pageId={pageId}
        displayScopedKey={displayScopedKey}
        activeKey={activeKey}
        binding={binding}
        hydratedKey={hydratedKey}
        storageTabKey={storageTabKey}
        config={{ selectedTraceIds: Array.from(selectedTraces) }}
        backendStats={useMemo(() => {
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
        }, [rawPayload])}
        rawPayload={rawPayload}
        httpStatus={httpStatus}
        durationMs={durationMs}
        bytes={bytes}
        attempt={attempt}
        loading={loading}
        loadError={loadError}
        loadOutline={() => {
          // manual reload via orchestrator
          setAttempt(n => n + 1);
          setLoading(true);
          setLoadError(null);
          setHttpStatus(null);
          setDurationMs(null);
          setBytes(null);
          orchestrator.deliver({
            from: "page",
            to: "orchestrator",
            channel: CH.PAGE_OUTLINE_LOAD,
            payload: { url: `${BASE}${BACKEND_ENDPOINTS.outline}` },
          });
        }}
      />
    </div>
  );
}