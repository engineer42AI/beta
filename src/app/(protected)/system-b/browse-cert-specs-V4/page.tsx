/** src/app/(protected)/system-b/browse-cert-specs-V4/page.tsx */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import {
  OutlineTree,
  type OutlineNode,
  type TraceRow,
  type NodeStats,
} from "./OutlineUI";

import { usePageBusChannel } from "@/components/console/bus/useBusChannel";
import { useConsoleStore } from "@/stores/console-store";
import { usePageConfig } from "@/stores/pageConfig-store";
import PageDebuggingDashboard from "./page_debugging_dashboard";

import { useCS25TraceStore } from "./stores/cs25-trace-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { orchestrator } from "@/lib/pageOrchestrator";
import { registerOutlineHandlers, WF } from "./outline.handlers";
import {
  registerAgentLangGraphHandlers,
  AGENT,
} from "./agent_langgraph.handlers";

import { NeedsTableUI, type FrozenNeedRow } from "./NeedsTableUI";
import { NeedsSnapshotCta } from "./NeedsSnapshotCta";

import { registerNeedsHandlers, NEEDS_WF } from "./needs.handlers";

import { IS_PROD } from "@/lib/env";

/* ----------------- helpers ----------------- */

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function buildLookup(seed: Record<string, TraceRow[]>) {
  const map: Record<string, { section_uuid: string; index: number }> = {};
  Object.entries(seed ?? {}).forEach(([section_uuid, rows]) => {
    (rows ?? []).forEach((row, index) => {
      if (row?.trace_uuid)
        map[row.trace_uuid] = {
          section_uuid,
          index,
        };
    });
  });
  return map;
}

function applyTraceResult(
  prev: Record<string, TraceRow[]>,
  lookup: Record<string, { section_uuid: string; index: number }>,
  item: any
) {
  const tId: string | undefined = item?.trace_uuid;
  if (!tId) return prev;

  // fast path
  let loc = lookup[tId];

  // fallback scan
  if (!loc) {
    for (const [section_uuid, rows] of Object.entries(prev)) {
      const idx = (rows ?? []).findIndex((r) => r?.trace_uuid === tId);
      if (idx >= 0) {
        loc = { section_uuid, index: idx };
        break;
      }
    }
  }

  // append if section_uuid present but row not found
  if (!loc && item?.section_uuid) {
    const section_uuid: string = item.section_uuid;
    const rows = Array.isArray(prev[section_uuid])
      ? [...prev[section_uuid]]
      : [];
    const newRow: TraceRow = {
      trace_uuid: tId,
      bottom_uuid: item.bottom_uuid ?? "",
      bottom_paragraph_id: item.bottom_paragraph_id,
      path_labels: item.path_labels ?? [],
      results: [item],
    };
    const next = { ...prev, [section_uuid]: [...rows, newRow] };
    const index = next[section_uuid].length - 1;
    lookup[tId] = { section_uuid, index };
    return next;
  }

  if (!loc) return prev;

  // merge into existing row
  const next = { ...prev };
  const arr = Array.isArray(next[loc.section_uuid])
    ? [...next[loc.section_uuid]]
    : [];
  const row = { ...(arr[loc.index] || {}) } as TraceRow;
  const old = Array.isArray(row.results) ? row.results : [];
  row.results = [...old, item];
  arr[loc.index] = row;
  next[loc.section_uuid] = arr;
  return next;
}

/* ----------------- component ----------------- */

export default function BrowseCertSpecV4Page() {
  /* route + tab first (consumed below) */
  const route = usePathname() || "/";
  const { boundTabId } = usePageBusChannel("ai");

  /* UI: show/hide debug dashboard */
  const isDev = !IS_PROD;

  const [showDebug, setShowDebug] = useState(false);

  /* trace-store hydration gate */
  const [traceStoreHydrated, setTraceStoreHydrated] = useState(
    () => (useCS25TraceStore as any)?.persist?.hasHydrated?.() ?? true
  );
  useEffect(() => {
    const p = (useCS25TraceStore as any)?.persist;
    if (!p) return;
    if (p.hasHydrated()) {
      setTraceStoreHydrated(true);
      return;
    }
    const unsub = p.onFinishHydration?.(() => setTraceStoreHydrated(true));
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  /* console binding + pageId (must be ready before effects that reference pageId) */
  const getBinding = useConsoleStore((s) => s.getBinding);
  const setCurrentPageId = useConsoleStore((s) => s.setCurrentPageId);
  const bindTabToCurrentPage = useConsoleStore((s) => s.bindTabToCurrentPage);

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
  }, [
    boundTabId,
    route,
    getBinding,
    setCurrentPageId,
    bindTabToCurrentPage,
  ]);

  const binding = useConsoleStore((s) =>
    boundTabId ? s.getBinding(boundTabId) : undefined
  );
  const pageId = binding?.pageId;

  /* persisted-trace selector for THIS tab (triggers re-render when slice changes) */
  const tracesForTab = useCS25TraceStore((s) => {
    if (!boundTabId) return undefined;
    return s.byKey[`${route}::${boundTabId}`]?.traces;
  });

  const storageTabKey = boundTabId ?? undefined;
  const activeKey = `${route}::${storageTabKey ?? "—"}`;
  const displayScopedKey =
    boundTabId && pageId ? `${boundTabId}::${pageId}` : undefined;
  const isBound = Boolean(boundTabId && pageId);

  /* outline + UI state */
  const [outline, setOutline] = useState<OutlineNode | null>(null);
  const [sectionTraces, setSectionTraces] = useState<
    Record<string, TraceRow[]>
  >({});
  const [rawPayload, setRawPayload] = useState<any | null>(null);

  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);

  const traceLookupRef = useRef<
    Record<string, { section_uuid: string; index: number }>
  >({});
  const pendingResultsRef = useRef<any[]>([]);
  const outlineReadyRef = useRef(false);

  /* FREEZE / NEEDS TABLE STATE (per tab) */
  type TabFreezeState = {
    mode: "draft" | "frozen";
    snapshot?: {
      rows: FrozenNeedRow[];
      at: string;
    };
  };

  const [freezeByKey, setFreezeByKey] = useState<
    Record<string, TabFreezeState>
  >({});

  const currentFreeze: TabFreezeState =
    freezeByKey[activeKey] ?? { mode: "draft" };
  const isFrozen = currentFreeze.mode === "frozen";
  const currentSnapshot = currentFreeze.snapshot ?? null;

  /* FUNCTIONS: trace helpers */

  function extractLatestResultLocal(row: TraceRow) {
    const latest =
      row.results && row.results.length
        ? row.results[row.results.length - 1]
        : undefined;
    const rel: boolean | undefined = latest?.response?.relevant;
    const rat: string | undefined = latest?.response?.rationale;
    return { relevant: rel, rationale: rat };
  }

  function normalizeTracePathLocal(labels: string[]): string[] {
    if (!labels || labels.length === 0) return [];
    const rest = labels.slice(1); // drop root/top-level
    return rest.map((l) =>
      l.replace(/\(([A-Za-z]+)\)/g, (_, g1) => `(${g1.toLowerCase()})`)
    );
  }

  /* FUNCTIONS: orchestrator <-> backend sync for freeze */

  function sendFreezeToAgent(payload: {
    selections_frozen: boolean;
    selections_frozen_at: string;
    snapshotRows: FrozenNeedRow[];
  }) {
    orchestrator.deliver({
      from: "page",
      to: "orchestrator",
      channel: NEEDS_WF.SYNC,
      payload,
      metadata: {
        reason: "needs_table_sync",
      },
    });
  }

  // Freeze: user finalizes and we build snapshot from AI relevance === true
  function freezeSelectionNow() {
    if (!activeKey) return;

    const ts = new Date();
    const tsStr = ts.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const snapRows: FrozenNeedRow[] = [];

    for (const [, rows] of Object.entries(sectionTraces ?? {})) {
      if (!Array.isArray(rows)) continue;
      for (const tr of rows) {
        const { relevant, rationale } = extractLatestResultLocal(tr);
        if (relevant !== true) continue; // ONLY AI-marked relevant
        const pathNorm = normalizeTracePathLocal(tr.path_labels || []);
        snapRows.push({
          trace_uuid: tr.trace_uuid,
          path_labels: pathNorm,
          relevant,
          rationale,
        });
      }
    }

    // Locally update per-tab freeze state
    setFreezeByKey((prev) => ({
      ...prev,
      [activeKey]: {
        mode: "frozen",
        snapshot: {
          rows: snapRows,
          at: tsStr,
        },
      },
    }));

    // Sync freeze + snapshot to backend (Redis + agent state)
    sendFreezeToAgent({
      selections_frozen: true,
      selections_frozen_at: tsStr,
      snapshotRows: snapRows,
    });
  }

  // Unfreeze: allow editing again
  function unfreezeForEditing() {
    if (!activeKey) return;

    setFreezeByKey((prev) => {
      const oldState = prev[activeKey];
      return {
        ...prev,
        [activeKey]: {
          mode: "draft",
          snapshot: oldState?.snapshot, // keep last snapshot around
        },
      };
    });

    // Tell backend we unlocked
    sendFreezeToAgent({
      selections_frozen: false,
      selections_frozen_at: "",
      snapshotRows: [],
    });
  }

  /* orchestrator wiring */
  useEffect(() => {

    if (boundTabId) {
      try {
        (orchestrator as any).purgeWireForTab?.(boundTabId);
      } catch {}
    }

    outlineReadyRef.current = false;
    pendingResultsRef.current = [];
    traceLookupRef.current = {};

    orchestrator.configure({
      getBinding: () => ({
        route,
        pageId: pageId ?? undefined,
        tabId: boundTabId ?? undefined,
      }),
      onDeliver: ({ to, channel, payload, metadata }) => {
        if (to === "page" && channel === AGENT.TRACE_RESULT) {
          const mTab = (metadata as any)?.tabId;
          const mPage = (metadata as any)?.pageId;
          if (!boundTabId || !pageId) return;
          if (mTab !== boundTabId || mPage !== pageId) return;

          // write to persisted trace store
          try {
            const it = payload ?? {};
            useCS25TraceStore.getState().upsert(route, boundTabId, {
              trace_uuid: it.trace_uuid,
              relevant: it?.response?.relevant,
              rationale: it?.response?.rationale,
              total_cost: it?.usage?.total_cost,
              run_id: it?.run_id,
            });
          } catch {}

          // also merge live into UI
          setSectionTraces((prev) =>
            applyTraceResult(prev, traceLookupRef.current, payload)
          );
          return;
        }

        if (to !== "page" || channel !== WF.OUTLINE_LOAD) return;

        const evt = metadata?.event as string | undefined;

        if (evt === "started") {
          setAttempt((n) => n + 1);
          setLoading(true);
          setLoadError(null);
          setHttpStatus(null);
          setDurationMs(null);
          setBytes(null);
          return;
        }

        if (evt === "progress") {
          if (typeof metadata?.httpStatus === "number")
            setHttpStatus(metadata.httpStatus);
          if (typeof metadata?.bytes === "number") setBytes(metadata.bytes);
          if (typeof metadata?.durationMs === "number")
            setDurationMs(metadata.durationMs);
          return;
        }

        if (evt === "success") {
          const raw = payload ?? null;
          setRawPayload(raw);
          setOutline(raw?.outline ?? null);
          setSectionTraces(raw?.section_traces ?? {});

          // seed lookup
          const seed = (raw?.section_traces ?? {}) as Record<
            string,
            TraceRow[]
          >;
          const lookup = buildLookup(seed);
          traceLookupRef.current = lookup;

          // mark outline ready / flush pending
          outlineReadyRef.current = true;
          if (pendingResultsRef.current.length) {
            setSectionTraces((prev) => {
              let next = prev;
              for (const item of pendingResultsRef.current) {
                next = applyTraceResult(next, traceLookupRef.current, item);
              }
              return next;
            });
            pendingResultsRef.current = [];
          }

          setHttpStatus(
            typeof metadata?.httpStatus === "number"
              ? metadata.httpStatus
              : null
          );
          setBytes(
            typeof metadata?.bytes === "number" ? metadata.bytes : null
          );
          setLoading(false);
          return;
        }

        if (evt === "error") {
          setLoading(false);
          setLoadError(metadata?.message ?? "Unknown error");
          setHttpStatus(
            typeof metadata?.httpStatus === "number"
              ? metadata.httpStatus
              : null
          );
          return;
        }
      },
    });

    registerOutlineHandlers();
    registerAgentLangGraphHandlers();
    registerNeedsHandlers();

    return () => {
      // no-op: handlers are idempotent and guarded
    };
  }, [route, pageId, boundTabId]);

  /* once-per-bind OUTLINE_LOAD */
  const didRequestRef = useRef(false);
  useEffect(() => {
    didRequestRef.current = false;
  }, [boundTabId, route]);

  useEffect(() => {
    if (!pageId || !boundTabId) return;
    if (didRequestRef.current) return;
    didRequestRef.current = true;
    orchestrator.deliver({
      from: "page",
      to: "orchestrator",
      channel: WF.OUTLINE_LOAD,
      payload: null,
      metadata: undefined,
    });
  }, [pageId, boundTabId, route]);

  useEffect(() => {
      if (!boundTabId || !pageId) return;
      (orchestrator as any).patch?.({
        binding: { route, pageId, tabId: boundTabId },
      });
  }, [route, pageId, boundTabId]);

  /* rehydrate outline UI when tab changes OR this tab's trace slice changes */
  useEffect(() => {
    if (!boundTabId) return;
    if (!outline) return; // need the outline seed
    if (!traceStoreHydrated) return; // wait for persist

    const seed = (rawPayload?.section_traces ?? {}) as Record<
      string,
      TraceRow[]
    >;
    const lookup = buildLookup(seed);

    let next = seed;
    if (tracesForTab && Object.keys(tracesForTab).length) {
      for (const [tId, stored] of Object.entries(tracesForTab)) {
        next = applyTraceResult(next, lookup, {
          trace_uuid: tId,
          response: {
            relevant: stored.relevant,
            rationale: stored.rationale,
          },
          usage:
            stored.total_cost != null
              ? { total_cost: stored.total_cost }
              : undefined,
          run_id: stored.run_id,
        });
      }
    }

    traceLookupRef.current = lookup;
    setSectionTraces(next);
  }, [
    boundTabId,
    outline,
    traceStoreHydrated,
    tracesForTab,
    rawPayload,
    route,
  ]);

  /* selections persist per (route, tabId) */
  const defaultConfig = useMemo(
    () => ({ selectedTraceIds: [] as string[] }),
    []
  );
  const { config, update } = usePageConfig(route, storageTabKey, defaultConfig);

  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const [selectedTraces, setSelectedTraces] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    setSelectedTraces(new Set());
    setHydratedKey(null);
  }, [activeKey]);

  useEffect(() => {
    const persisted = config.selectedTraceIds ?? [];
    setSelectedTraces((prev) => {
      const next = new Set(persisted);
      let same = prev.size === next.size;
      if (same)
        for (const id of prev) {
          if (!next.has(id)) {
            same = false;
            break;
          }
        }
      return same ? prev : next;
    });
    setHydratedKey(activeKey);
    // eslint-disable-next-line no-console
    console.debug("[V4] hydrated selections", {
      activeKey,
      count: persisted.length,
    });
  }, [config.selectedTraceIds, activeKey]);

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
      queueMicrotask(() => (syncingRef.current = false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTraces, hydratedKey, activeKey]);

  /* derived */
  const subparts = useMemo(
    () =>
      ((outline?.children ?? []).filter(
        (c) => c.type === "Subpart"
      ) as OutlineNode[]),
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

  const backendStats = useMemo(() => {
    const outlineChildren = (rawPayload?.outline?.children ?? []) as any[];
    const subpartsCount = outlineChildren.filter(
      (c) => c?.type === "Subpart"
    ).length;
    const sectionsCount = Object.keys(
      rawPayload?.section_traces ?? {}
    ).length;
    let tracesTotal = 0;
    if (rawPayload?.section_traces) {
      for (const rows of Object.values(
        rawPayload.section_traces as Record<string, any[]>
      )) {
        tracesTotal += Array.isArray(rows) ? rows.length : 0;
      }
    }
    return { subpartsCount, sectionsCount, tracesTotal };
  }, [rawPayload]);


  const relevantRows = useMemo<FrozenNeedRow[]>(() => {
      const out: FrozenNeedRow[] = [];
      for (const rows of Object.values(sectionTraces ?? {})) {
        if (!Array.isArray(rows)) continue;
        for (const tr of rows) {
          const latest = tr.results?.length ? tr.results[tr.results.length - 1] : undefined;
          const relevant = latest?.response?.relevant as boolean | undefined;
          if (relevant !== true) continue; // only AI-marked relevant
          const rationale = latest?.response?.rationale as string | undefined;
          const parts =
            (tr.path_labels ?? []).slice(1).map(l =>
              l.replace(/\(([A-Za-z]+)\)/g, (_, g1) => `(${g1.toLowerCase()})`)
            );
          out.push({
            trace_uuid: tr.trace_uuid,
            path_labels: parts,
            relevant,
            rationale,
          });
        }
      }
      return out;
  }, [sectionTraces]);


  /* render */
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3 justify-between">
          <div>
            <h1 className="text-xl font-semibold">CS-25</h1>
            <p className="text-sm text-muted-foreground">
              Explore
            </p>
          </div>

          {/* right-side controls (status + show debug) */}
          <div className="flex items-center gap-2">
              {isDev && (
                <>
                  <Badge variant="outline" className="text-[11px]">
                    {isBound ? "bound" : "unbound"}
                  </Badge>

                  {typeof httpStatus === "number" && (
                    <Badge variant="outline" className="text-[11px]">
                      HTTP {httpStatus}
                    </Badge>
                  )}

                  {loading && (
                    <Badge variant="outline" className="text-[11px]">
                      loading…
                    </Badge>
                  )}

                  <Button
                    variant={showDebug ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-[12px]"
                    onClick={() => setShowDebug((v) => !v)}
                  >
                    {showDebug ? "Hide debug" : "Show debug"}
                  </Button>
                </>
              )}
          </div>
        </div>
      </header>

      <section>
        {loadError ? (
          <div className="text-sm text-red-600">{loadError}</div>
        ) : !isBound ? (
          <div className="text-sm text-muted-foreground">
            Open an AI tab to begin…
          </div>
        ) : loading ? (
          <div className="text-sm text-muted-foreground">
            Loading outline…
          </div>
        ) : outline ? (
          <>
            <OutlineTree
              subparts={subparts}
              sectionTraces={sectionTraces}
              sectionStats={sectionStats}
              selectedTraces={selectedTraces}
              setSelectedTraces={setSelectedTraces}
              disabled={isFrozen}
            />

            {/* BELOW OUTLINE:
                either CTA (not frozen yet) or the frozen Needs Table
             */}
            <div className="mt-8">
              {isFrozen && currentSnapshot ? (
                <>
                  <NeedsTableUI
                    rows={currentSnapshot.rows}
                    frozenAt={currentSnapshot.at}
                  />

                  <div className="mt-3 flex flex-col items-center gap-2">
                    <p className="text-[11px] text-muted-foreground leading-snug text-center max-w-[50ch]">
                      Snapshot captured for this tab. These items (clause ↔
                      rationale) form your initial Compliance Needs.
                    </p>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-[12px]"
                      onClick={unfreezeForEditing}
                    >
                      Edit Selection
                    </Button>
                  </div>
                </>
              ) : (
                <NeedsSnapshotCta
                  rows={relevantRows}
                  onFreeze={freezeSelectionNow}
                />
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">
            No outline loaded.
          </div>
        )}
      </section>

      {/* ⬇️ render debugging dashboard only when toggled on */}
      {isDev && showDebug && (
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
          backendStats={backendStats}
          rawPayload={rawPayload}
          httpStatus={httpStatus}
          durationMs={durationMs}
          bytes={bytes}
          attempt={attempt}
          loading={loading}
          loadError={loadError}
          loadOutline={() => {
            setAttempt((n) => n + 1);
            setLoading(true);
            setLoadError(null);
            setHttpStatus(null);
            setDurationMs(null);
            setBytes(null);
            orchestrator.deliver({
              from: "page",
              to: "orchestrator",
              channel: WF.OUTLINE_LOAD,
              payload: null,
            });
          }}
        />
      )}
    </div>
  );
}