// src/app/(protected)/system-b/browse-cert-specs-V4/NeedsTableUI.tsx
"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Search,
  BookOpen,
  Loader2,
  List,
  Layers,
  Compass,
  Wand2,
  Pin,
  Flag,
  Ban,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

import {
  NeedsSandboxPanel,
  type NeedsSandboxDraft,
  type NeedsSandboxApplyPatch,
  type NeedsDecisionsMap,
  type NeedsEvalsMap,
  type NeedDecisionStatus,
} from "./NeedsSandboxPanel";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** snapshot rows (frozen selection) */
export type FrozenNeedRow = {
  trace_uuid: string;
  path_labels: string[];
  relevant: boolean | undefined;
  rationale: string | undefined;
};

/** streamed needs (built from frozen selection) */
export type StreamedNeedItem = {
  need_id: string; // stable internal id
  need_code?: string; // display id like N-03-01 (optional)
  trace_uuid: string;
  path_labels: string[];

  statement: string;
  rationale: string;
  headline: string;

  frozen_at?: string;

  relevance_rationale?: string;
  intent_summary_trace?: string;
  intent_summary_section?: string;
};

/** clustering payload from backend: needsTables.clusters */
export type NeedsCluster = {
  cluster_id: string; // e.g. C-01
  size: number;
  label: string; // human label
  need_ids: string[];
};

export type NeedsClusterResult = {
  k: number;
  map: Record<string, string>; // need_id -> cluster_id
  clusters: NeedsCluster[]; // ordered (largest first)
};

export type NeedStrand =
  | "FUNCTIONAL_DESIGN_PERFORMANCE"
  | "MATERIALS"
  | "MANUFACTURING_METHOD"
  | "INTEGRATION_ENVIRONMENT"
  | "OTHER";

export type NeedsStrandsResult = {
  map: Record<string, { strand: NeedStrand; confidence?: number; reason?: string }>;
  strands?: Array<{ strand: NeedStrand; size: number }>;
};

type Props =
  | {
      kind: "snapshot";
      rows: FrozenNeedRow[];
      frozenAt?: string;
    }
  | {
      kind: "stream";
      tabId: string;
      items: StreamedNeedItem[];
      frozenAt?: string;
      streaming?: boolean;
      done?: number;
      total?: number;

      /** optional: pass once you receive needsTables.clusters */
      clusters?: NeedsClusterResult;
      strands?: NeedsStrandsResult;
    };

/* ---------------- helpers ---------------- */
function safeClone<T>(obj: T): T {
  if (obj == null) return obj;
  try {
    // @ts-ignore
    if (typeof structuredClone === "function") return structuredClone(obj);
  } catch {}
  return JSON.parse(JSON.stringify(obj));
}

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function lastLabel(path: string[]) {
  return Array.isArray(path) && path.length ? path[path.length - 1] : "—";
}

function fullPath(path: string[]) {
  return (path ?? []).join(" / ");
}

function lineClampClass(n: 1 | 2 | 3 | 4) {
  return `line-clamp-${n}`;
}

function statusMeta(status: NeedDecisionStatus) {
  switch (status) {
    case "pinned":
      return { label: "Pinned", Icon: Pin };
    case "flagged":
      return { label: "Flagged", Icon: Flag };
    case "descoped":
      return { label: "Descoped", Icon: Ban };
    default:
      return { label: "Active", Icon: Check };
  }
}

function dispatchNeedsOverlayChanged(tabId: string) {
  try {
    window.dispatchEvent(new CustomEvent("e42.needsTable.overlayChanged", { detail: { tabId } }));
  } catch {}
}
/* ---------------- movable + resizable columns ---------------- */

type ColId = "exp" | "clause" | "need" | "ids" | "status";

const DEFAULT_WIDTHS: Record<ColId, number> = {
  exp: 34,
  clause: 260,
  need: 820,
  ids: 180,
  status: 220,
};

const COL_LABEL: Record<ColId, string> = {
  exp: "",
  clause: "Clause",
  need: "Need",
  ids: "ID",
  status: "Status",
};

function clampWidth(n: number, col?: ColId) {
  const min = col === "exp" ? 28 : 140;
  const max = col === "exp" ? 60 : 1200;
  return Math.max(min, Math.min(max, n));
}

function useColumnResizer() {
  const dragRef = React.useRef<{
    col: ColId;
    startX: number;
    startW: number;
  } | null>(null);

  const [widths, setWidths] = React.useState<Record<ColId, number>>(() => {
    try {
      const raw = localStorage.getItem("e42.needsTable.colWidths.v2");
      if (raw) return { ...DEFAULT_WIDTHS, ...(JSON.parse(raw) as any) };
    } catch {}
    return { ...DEFAULT_WIDTHS };
  });

  React.useEffect(() => {
    try {
      localStorage.setItem("e42.needsTable.colWidths.v2", JSON.stringify(widths));
    } catch {}
  }, [widths]);

  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { col, startX, startW } = dragRef.current;
      const dx = e.clientX - startX;
      setWidths((prev) => ({ ...prev, [col]: clampWidth(startW + dx, col) }));
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const beginResize = (col: ColId, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      col,
      startX: e.clientX,
      startW: widths[col] ?? DEFAULT_WIDTHS[col],
    };
  };

  return { widths, beginResize, setWidths };
}

function SortableResizableTh({
  id,
  label,
  widthPx,
  onBeginResize,
}: {
  id: ColId;
  label: string;
  widthPx: number;
  onBeginResize: (id: ColId, e: React.PointerEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <th
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="relative px-2 py-1.5 text-left font-semibold text-foreground/80 select-none border-b border-border bg-background"
      title={`${label} (${Math.round(widthPx)}px)`}
    >
      <span className="inline-flex items-center gap-2 pr-3">
        <span
          className="cursor-grab active:cursor-grabbing text-muted-foreground/70"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder column"
          title="Drag to reorder column"
        >
          ⋮⋮
        </span>
        {label}
      </span>

      <span
        className="absolute top-0 right-0 h-full w-3 cursor-col-resize"
        onPointerDown={(e) => onBeginResize(id, e)}
        aria-label="Resize column"
        title="Drag to resize column"
      >
        <span className="absolute top-1 bottom-1 right-1 w-px bg-border" />
      </span>
    </th>
  );
}

/* ---------------- main component ---------------- */

export function NeedsTableUI(props: Props) {
  const headerCount = props.kind === "snapshot" ? props.rows.length : props.items.length;
  const clusterCount = props.kind === "stream" ? (props.clusters?.clusters?.length ?? 0) : 0;
  const strandCount = props.kind === "stream" ? Object.keys(props.strands?.map ?? {}).length : 0;

  return (
    <TooltipProvider delayDuration={200}>
      <Card className="w-full border border-border rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b bg-accent/20 px-3 py-2">
          <div className="text-[12px] font-semibold text-foreground">Needs Table</div>

          <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
            {headerCount} needs
          </Badge>

          {props.kind === "stream" && (
            <>
              {typeof props.done === "number" && typeof props.total === "number" && (
                <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                  <span className="inline-flex items-center gap-1.5">
                    {props.streaming && <Loader2 className="h-3 w-3 animate-spin" />}
                    certification clauses {props.done}/{props.total}
                  </span>
                </Badge>
              )}

              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                {clusterCount > 0 ? (
                  `${clusterCount} clusters`
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    clusters pending
                  </span>
                )}
              </Badge>

              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                {strandCount > 0 ? (
                  `${strandCount} tagged`
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    drivers pending
                  </span>
                )}
              </Badge>
            </>
          )}

          {props.frozenAt && (
            <div className="ml-auto text-[10px] text-muted-foreground tabular-nums">frozen {props.frozenAt}</div>
          )}
        </div>

        {props.kind === "snapshot" ? (
          <SnapshotTable rows={props.rows} />
        ) : (
          <StreamTable
            tabId={props.tabId}
            items={props.items}
            clusters={props.clusters}
            strands={props.strands}
          />
        )}
      </Card>
    </TooltipProvider>
  );
}

/* ---------------- snapshot table (unchanged-ish) ---------------- */

function SnapshotTable({ rows }: { rows: FrozenNeedRow[] }) {
  return (
    <div className="w-full overflow-auto">
      <table className="w-full border-collapse text-[11px] leading-snug">
        <colgroup>
          <col style={{ width: 260 }} />
          <col style={{ width: 140 }} />
          <col />
        </colgroup>

        <thead className="sticky top-0 z-10 bg-background">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold text-foreground/80 border-b border-border bg-background">
              Clause
            </th>
            <th className="px-2 py-1.5 text-left font-semibold text-foreground/80 border-b border-border bg-background">
              Status
            </th>
            <th className="px-2 py-1.5 text-left font-semibold text-foreground/80 border-b border-border bg-background">
              Rationale
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-4 text-[12px] text-muted-foreground italic">
                No relevant selections at freeze time.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.trace_uuid} className="hover:bg-accent/10">
                <td className="px-2 py-1 align-top">
                  <div className="font-medium text-foreground/90">{lastLabel(r.path_labels)}</div>
                  <div className="text-[10px] text-muted-foreground/70 line-clamp-2">{fullPath(r.path_labels)}</div>
                </td>

                <td className="px-2 py-1 align-top">
                  <div className="font-mono text-[10px] text-muted-foreground/60">{shortId(r.trace_uuid)}</div>
                </td>

                <td className="px-2 py-1 align-top">
                  <div className={lineClampClass(2)}>{r.rationale ?? ""}</div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- streamed table ---------------- */

function StreamTable({
  tabId,
  items,
  clusters,
  strands,
}: {
  tabId: string;
  items: StreamedNeedItem[];
  clusters?: NeedsClusterResult;
  strands?: NeedsStrandsResult;
}) {
  // NOTE: order is only for reorderable columns (exclude exp so it stays pinned)
  const [order, setOrder] = React.useState<ColId[]>(() => {
    try {
      const raw = localStorage.getItem("e42.needsTable.colOrder.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        const allowed: ColId[] = ["clause", "need", "ids", "status"];
        let cleaned = (Array.isArray(parsed) ? parsed : []).filter((c): c is ColId => allowed.includes(c));

        // ensure new cols appear even for old saved layouts
        for (const mustHave of ["clause", "need", "ids", "status"] as ColId[]) {
          if (!cleaned.includes(mustHave)) cleaned.push(mustHave);
        }

        return ["exp", ...cleaned];
      }
    } catch {}
    return ["exp", "clause", "need", "ids", "status"];
  });

  // persist without exp (so we don't break older saves)
  React.useEffect(() => {
    try {
      localStorage.setItem("e42.needsTable.colOrder.v1", JSON.stringify(order.filter((c) => c !== "exp")));
    } catch {}
  }, [order]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { widths, beginResize, setWidths } = useColumnResizer();

  // expanded rows by need_id
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const toggleRow = (needId: string) => setOpen((s) => ({ ...s, [needId]: !s[needId] }));

  // group collapsed state
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  type ViewMode = "flat" | "grouped" | "drivers";
  const [view, setView] = React.useState<ViewMode>("flat");

  const hasClusters = !!clusters?.clusters?.length;
  const hasDrivers = Object.keys(strands?.map ?? {}).length > 0;

  const collapseAllGroups = React.useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const c of clusters?.clusters ?? []) next[c.cluster_id] = true;
    next["UNCLUSTERED"] = true;
    setCollapsed(next);
  }, [clusters]);

  React.useEffect(() => {
    if (!hasClusters) return;
    setView((v) => (v === "flat" ? "grouped" : v)); // don't override user's choice
    collapseAllGroups();
  }, [hasClusters, collapseAllGroups]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const oldIndex = order.indexOf(active.id as ColId);
    const newIndex = order.indexOf(over.id as ColId);
    if (oldIndex < 0 || newIndex < 0) return;

    setOrder((prev) => arrayMove(prev, oldIndex, newIndex));
  };

  const clusterIdForNeed = React.useCallback(
    (needId: string) => clusters?.map?.[needId] || "UNCLUSTERED",
    [clusters]
  );

  const strandForNeed = React.useCallback(
    (needId: string) => (strands?.map?.[needId]?.strand as NeedStrand) ?? "OTHER",
    [strands]
  );

  /* -------- decisions + evals persistence (per tab) -------- */

  const DECISIONS_KEY = React.useMemo(() => `e42.needsTable.decisions.${tabId}.v1`, [tabId]);
  const EVALS_KEY = React.useMemo(() => `e42.needsTable.evals.${tabId}.v1`, [tabId]);

  const [decisions, setDecisions] = React.useState<NeedsDecisionsMap>(() => {
    if (!tabId) return {};
    try {
      const raw = localStorage.getItem(DECISIONS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });

  const [evals, setEvals] = React.useState<NeedsEvalsMap>(() => {
    if (!tabId) return {};
    try {
      const raw = localStorage.getItem(EVALS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });

  // reload if tabId changes (navigate between tabs)
  React.useEffect(() => {
    if (!tabId) return;
    try {
      const rawD = localStorage.getItem(DECISIONS_KEY);
      setDecisions(rawD ? JSON.parse(rawD) : {});
    } catch {
      setDecisions({});
    }
    try {
      const rawE = localStorage.getItem(EVALS_KEY);
      setEvals(rawE ? JSON.parse(rawE) : {});
    } catch {
      setEvals({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DECISIONS_KEY, EVALS_KEY]);

  // ✅ allow external workspace switcher to force-reload decisions/evals from localStorage
  React.useEffect(() => {
    if (!tabId) return;

    const handler = (e: any) => {
      const t = e?.detail?.tabId;
      if (t && t !== tabId) return;

      try {
        const rawD = localStorage.getItem(DECISIONS_KEY);
        setDecisions(rawD ? JSON.parse(rawD) : {});
      } catch {
        setDecisions({});
      }

      try {
        const rawE = localStorage.getItem(EVALS_KEY);
        setEvals(rawE ? JSON.parse(rawE) : {});
      } catch {
        setEvals({});
      }
    };

    window.addEventListener("e42.needsTable.reload", handler as any);
    return () => window.removeEventListener("e42.needsTable.reload", handler as any);
  }, [tabId, DECISIONS_KEY, EVALS_KEY]);


  React.useEffect(() => {
    if (!tabId) return;
    try {
      localStorage.setItem(DECISIONS_KEY, JSON.stringify(decisions ?? {}));
    } catch {}
    dispatchNeedsOverlayChanged(tabId);
  }, [tabId, DECISIONS_KEY, decisions]);

  React.useEffect(() => {
    if (!tabId) return;
    try {
      localStorage.setItem(EVALS_KEY, JSON.stringify(evals ?? {}));
    } catch {}
    dispatchNeedsOverlayChanged(tabId);
  }, [tabId, EVALS_KEY, evals]);

  const effectiveStatus = React.useCallback(
    (needId: string): NeedDecisionStatus => decisions?.[needId]?.status ?? "active",
    [decisions]
  );

  const [showDescoped, setShowDescoped] = React.useState(false);

  const visibleItems = React.useMemo(() => {
    // keep deterministic ordering: pinned -> flagged -> active -> descoped (then original order)
    const rank = (s: NeedDecisionStatus) =>
      s === "pinned" ? 0 : s === "flagged" ? 1 : s === "active" ? 2 : 3;

    const base = showDescoped ? items : items.filter((it) => effectiveStatus(it.need_id) !== "descoped");

    return [...base].sort((a, b) => {
      const ra = rank(effectiveStatus(a.need_id));
      const rb = rank(effectiveStatus(b.need_id));
      if (ra !== rb) return ra - rb;
      return 0;
    });
  }, [items, showDescoped, effectiveStatus]);

  const decisionCounts = React.useMemo(() => {
    let pinned = 0,
      flagged = 0,
      descoped = 0,
      active = 0;
    for (const it of items) {
      const s = effectiveStatus(it.need_id);
      if (s === "pinned") pinned += 1;
      else if (s === "flagged") flagged += 1;
      else if (s === "descoped") descoped += 1;
      else active += 1;
    }
    const evalCount = Object.keys(evals ?? {}).length;
    return { pinned, flagged, descoped, active, evals: evalCount, total: items.length };
  }, [items, effectiveStatus, evals]);

  /* -------- sandbox drawer -------- */

  const [sandboxOpen, setSandboxOpen] = React.useState(false);
  const [sandboxDraft, setSandboxDraft] = React.useState<NeedsSandboxDraft | null>(null);

  const openSandbox = React.useCallback(() => {
    setSandboxDraft({
      createdAt: new Date().toISOString(),
      view,
      // IMPORTANT: pass the FULL dataset so user can reactivate descoped items
      items: safeClone(items),
      clusters: safeClone(clusters),
      strands: safeClone(strands),
    });
    setSandboxOpen(true);
  }, [view, items, clusters, strands]);

  const onSandboxApply = React.useCallback(
    (patch: NeedsSandboxApplyPatch) => {
      // patch contains the overlay maps (persistable)
      setDecisions(patch.decisions ?? {});
      setEvals(patch.evals ?? {});
      setSandboxOpen(false);
      setSandboxDraft(null);

      // UX: if user descoped a lot, keep table clean
      // (but don't force; user can toggle Show descoped)
      // no-op beyond persistence
    },
    []
  );

  /* -------- group views -------- */

  const clusterLabelById = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of clusters?.clusters ?? []) m[c.cluster_id] = c.label;
    return m;
  }, [clusters]);

  const grouped = React.useMemo(() => {
    if (view !== "grouped" || !hasClusters) return null;

    const buckets: Record<string, StreamedNeedItem[]> = {};
    for (const it of visibleItems) {
      const cid = clusterIdForNeed(it.need_id);
      (buckets[cid] ||= []).push(it);
    }

    const orderedIds = (clusters?.clusters ?? []).map((c) => c.cluster_id);
    const hasUnclustered = !!buckets["UNCLUSTERED"]?.length;

    const groups = orderedIds
      .filter((cid) => buckets[cid]?.length)
      .map((cid) => ({
        cid,
        label: clusterLabelById[cid] || cid,
        items: buckets[cid] || [],
      }));

    if (hasUnclustered) {
      groups.push({
        cid: "UNCLUSTERED",
        label: "Unclustered",
        items: buckets["UNCLUSTERED"],
      });
    }

    return groups;
  }, [view, hasClusters, visibleItems, clusters, clusterIdForNeed, clusterLabelById]);

  const driversGrouped = React.useMemo(() => {
    if (view !== "drivers" || !hasDrivers) return null;

    const buckets: Record<string, StreamedNeedItem[]> = {};
    for (const it of visibleItems) {
      const s = strandForNeed(it.need_id);
      (buckets[s] ||= []).push(it);
    }

    const strandOrder: NeedStrand[] = [
      "FUNCTIONAL_DESIGN_PERFORMANCE",
      "MATERIALS",
      "MANUFACTURING_METHOD",
      "INTEGRATION_ENVIRONMENT",
      "OTHER",
    ];

    return strandOrder
      .filter((k) => buckets[k]?.length)
      .map((k) => ({ cid: k, label: k, items: buckets[k] }));
  }, [view, hasDrivers, visibleItems, strandForNeed]);

  /* -------- render helpers -------- */

  const renderCell = (col: ColId, it: StreamedNeedItem) => {
    const status = effectiveStatus(it.need_id);
    const eval0 = evals?.[it.need_id];
    const mutedRow = status === "descoped";

    switch (col) {
      case "exp": {
        const isOpen = !!open[it.need_id];
        return (
          <td key={col} className="px-1 py-1 align-top">
            <button
              type="button"
              className={[
                "h-5 w-5 rounded border border-border",
                "text-[12px] leading-none",
                "hover:bg-accent/30",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              ].join(" ")}
              aria-label={isOpen ? "Collapse row" : "Expand row"}
              title={isOpen ? "Collapse" : "Expand"}
              onClick={(e) => {
                e.stopPropagation();
                toggleRow(it.need_id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {isOpen ? "–" : "+"}
            </button>
          </td>
        );
      }

      case "clause": {
        const parts = Array.isArray(it.path_labels) ? it.path_labels : [];
        const last = parts.length ? parts[parts.length - 1] : "(unknown clause)";
        return (
          <td key={col} className={["px-2 py-1 align-top", mutedRow ? "opacity-70" : ""].join(" ")}>
            <div className="text-[11px] font-medium text-foreground truncate" title={last}>
              {last}
            </div>
          </td>
        );
      }

      case "need": {
        const obj = (it.headline ?? "").trim();
        const shown = obj || it.statement;
        return (
          <td key={col} className={["px-2 py-1 align-top", mutedRow ? "opacity-70" : ""].join(" ")}>
            <div className="line-clamp-1 overflow-hidden" title={shown}>
              {shown}
            </div>
          </td>
        );
      }

      case "ids": {
          const display = it.need_code && it.need_code.trim() ? it.need_code.trim() : shortId(it.need_id);

          return (
            <td key={col} className={["px-2 py-1 align-top text-[10px]", mutedRow ? "opacity-70" : ""].join(" ")}>
              <div className="font-mono text-muted-foreground/80">{display}</div>
            </td>
          );
      }

      case "status": {
          const meta = statusMeta(status);
          const SIcon = meta.Icon;

          const evalChip =
            eval0 && eval0.ok
              ? eval0.trigger
                ? `applies ${Math.round((eval0.confidence ?? 0) * 100)}%`
                : `not ${Math.round((eval0.confidence ?? 0) * 100)}%`
              : eval0 && !eval0.ok
              ? "eval error"
              : "";

          return (
            <td key={col} className={["px-2 py-1 align-top text-[10px]", mutedRow ? "opacity-70" : ""].join(" ")}>
              <div className="mt-0.5 flex flex-wrap items-center justify-end gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                  <SIcon className="h-3 w-3" />
                  {meta.label}
                </span>

                {evalChip ? (
                  <span className="rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {evalChip}
                  </span>
                ) : null}
              </div>
            </td>
          );
      }
    }
  };

  const InfoCard = ({
    title,
    tooltip,
    text,
    Icon,
    className = "",
  }: {
    title: string;
    tooltip: string;
    text?: string;
    Icon: React.ComponentType<{ className?: string }>;
    className?: string;
  }) => {
    const v = (text ?? "").trim();
    if (!v) return null;

    return (
      <div className={`rounded-md border border-border bg-background/40 p-3 ${className}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="inline-flex items-center gap-2 cursor-help select-none">
              <Icon className="h-4 w-4 text-muted-foreground/80" />
              <span className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wide">
                {title}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-xs">
            {tooltip}
          </TooltipContent>
        </Tooltip>

        <div className="mt-2 text-[11px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">{v}</div>
      </div>
    );
  };

  if (!items.length) {
    return <div className="px-3 py-4 text-[12px] text-muted-foreground italic">Waiting for needs…</div>;
  }

  const reorderable = order.filter((c) => c !== "exp");



  return (
    <>
      <div className="w-full overflow-auto">
        {/* view toggle row */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="flat" className="h-7 gap-1.5 text-[11px]">
                <List className="h-3.5 w-3.5" />
                Flat
              </TabsTrigger>

              <TabsTrigger
                value="grouped"
                disabled={!hasClusters}
                className="h-7 gap-1.5 text-[11px]"
                title={hasClusters ? "Group by clusters" : "Waiting for cluster results…"}
              >
                {!hasClusters ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                Grouped
              </TabsTrigger>

              <TabsTrigger
                value="drivers"
                disabled={!hasDrivers}
                className="h-7 gap-1.5 text-[11px]"
                title={hasDrivers ? "Group by technology drivers" : "Waiting for driver tags…"}
              >
                {!hasDrivers ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Compass className="h-3.5 w-3.5" />
                )}
                Drivers
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="ml-2 flex items-center gap-2">
            <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
              {decisionCounts.pinned} pinned
            </Badge>
            <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
              {decisionCounts.flagged} flagged
            </Badge>
            <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
              {decisionCounts.descoped} descoped
            </Badge>
            <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
              {decisionCounts.evals} evals
            </Badge>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] rounded-md border border-border/60 hover:bg-accent/20"
              onClick={() => setShowDescoped((v) => !v)}
              type="button"
              title={showDescoped ? "Hide descoped rows" : "Show descoped rows"}
            >
              {showDescoped ? <EyeOff className="h-3.5 w-3.5 mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
              {showDescoped ? "Hide descoped" : "Show descoped"}
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] rounded-md border border-border/60 hover:bg-accent/20"
                  onClick={openSandbox}
                  type="button"
                >
                  <Wand2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  Refine
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-xs">
                Open a sandbox copy to triage and narrow your working set. Apply changes back to this table.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={reorderable} strategy={horizontalListSortingStrategy}>
            <table className="w-full border-collapse text-[11px] leading-snug">
              <colgroup>
                {order.map((c) => (
                  <col key={c} style={{ width: widths[c] ?? DEFAULT_WIDTHS[c] }} />
                ))}
              </colgroup>

              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  <th className="px-1 py-1.5 border-b border-border bg-background" />
                  {reorderable.map((c) => (
                    <SortableResizableTh
                      key={c}
                      id={c}
                      label={COL_LABEL[c]}
                      widthPx={widths[c] ?? DEFAULT_WIDTHS[c]}
                      onBeginResize={beginResize}
                    />
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {/* Grouped by clusters */}
                {view === "grouped" && grouped ? (
                  grouped.map((g) => {
                    const isCollapsed = !!collapsed[g.cid];
                    const headerLabel = g.label || g.cid;

                    return (
                      <React.Fragment key={g.cid}>
                        <tr className="bg-accent/10">
                          <td colSpan={order.length} className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-[11px] px-2 py-1 rounded border border-border hover:bg-accent/20"
                                onClick={() => setCollapsed((s) => ({ ...s, [g.cid]: !s[g.cid] }))}
                              >
                                {isCollapsed ? "+" : "–"}
                              </button>

                              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                                {g.cid}
                              </Badge>

                              <div className="text-[11px] font-medium text-foreground/90">{headerLabel}</div>

                              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full ml-auto">
                                {g.items.length} needs
                              </Badge>
                            </div>
                          </td>
                        </tr>

                        {!isCollapsed &&
                          g.items.map((it) => {
                            const isOpen = !!open[it.need_id];
                            return (
                              <React.Fragment key={it.need_id}>
                                <tr className="hover:bg-accent/10">{order.map((c) => renderCell(c, it))}</tr>

                                {isOpen && (
                                  <tr className="bg-muted/30 dark:bg-muted/20">
                                    <td colSpan={order.length} className="px-2 py-2">
                                      <div className="mx-auto max-w-5xl">
                                        <div className="mb-3 px-1">
                                          <div className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wide">
                                            Need statement
                                          </div>
                                          <div className="mt-1 text-[12px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">
                                            {it.statement}
                                          </div>
                                        </div>

                                        <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                                          <InfoCard
                                            className="w-full sm:w-[280px]"
                                            title="Why this matters"
                                            tooltip="The reasoning behind why this need exists."
                                            text={it.rationale}
                                            Icon={AlertTriangle}
                                          />

                                          <InfoCard
                                            className="w-full sm:w-[280px]"
                                            title="Why this applies here"
                                            tooltip="Why this is relevant to the current context."
                                            text={it.relevance_rationale}
                                            Icon={Search}
                                          />

                                          <InfoCard
                                            className="w-full sm:w-[280px]"
                                            title="Regulatory intent"
                                            tooltip="What the regulation is trying to achieve."
                                            text={it.intent_summary_trace}
                                            Icon={BookOpen}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                      </React.Fragment>
                    );
                  })
                ) : view === "drivers" && driversGrouped ? (
                  /* Grouped by drivers */
                  driversGrouped.map((g) => {
                    const isCollapsed = !!collapsed[g.cid];
                    const headerLabel = g.label || g.cid;

                    return (
                      <React.Fragment key={g.cid}>
                        <tr className="bg-accent/10">
                          <td colSpan={order.length} className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-[11px] px-2 py-1 rounded border border-border hover:bg-accent/20"
                                onClick={() => setCollapsed((s) => ({ ...s, [g.cid]: !s[g.cid] }))}
                              >
                                {isCollapsed ? "+" : "–"}
                              </button>

                              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                                {g.cid}
                              </Badge>

                              <div className="text-[11px] font-medium text-foreground/90">{headerLabel}</div>

                              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full ml-auto">
                                {g.items.length} needs
                              </Badge>
                            </div>
                          </td>
                        </tr>

                        {!isCollapsed &&
                          g.items.map((it) => {
                            const isOpen = !!open[it.need_id];
                            return (
                              <React.Fragment key={it.need_id}>
                                <tr className="hover:bg-accent/10">{order.map((c) => renderCell(c, it))}</tr>

                                {isOpen && (
                                  <tr className="bg-muted/30 dark:bg-muted/20">
                                    <td colSpan={order.length} className="px-2 py-2">
                                      <div className="mx-auto max-w-5xl">
                                        <div className="mb-3 px-1">
                                          <div className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wide">
                                            Need statement
                                          </div>
                                          <div className="mt-1 text-[12px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">
                                            {it.statement}
                                          </div>
                                        </div>

                                        <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                                          <InfoCard
                                            className="w-full sm:w-[280px]"
                                            title="Why this matters"
                                            tooltip="The reasoning behind why this need exists."
                                            text={it.rationale}
                                            Icon={AlertTriangle}
                                          />

                                          <InfoCard
                                            className="w-full sm:w-[280px]"
                                            title="Why this applies here"
                                            tooltip="Why this is relevant to the current context."
                                            text={it.relevance_rationale}
                                            Icon={Search}
                                          />

                                          <InfoCard
                                            className="w-full sm:w-[280px]"
                                            title="Regulatory intent"
                                            tooltip="What the regulation is trying to achieve."
                                            text={it.intent_summary_trace}
                                            Icon={BookOpen}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                      </React.Fragment>
                    );
                  })
                ) : (
                  /* Flat mode */
                  visibleItems.map((it) => {
                    const isOpen = !!open[it.need_id];
                    return (
                      <React.Fragment key={it.need_id}>
                        <tr className="hover:bg-accent/10">{order.map((c) => renderCell(c, it))}</tr>

                        {isOpen && (
                          <tr className="bg-muted/30 dark:bg-muted/20">
                            <td colSpan={order.length} className="px-2 py-2">
                              <div className="mx-auto max-w-5xl">
                                <div className="mb-3 px-1">
                                  <div className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wide">
                                    Need statement
                                  </div>
                                  <div className="mt-1 text-[12px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">
                                    {it.statement}
                                  </div>
                                </div>

                                <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                                  <InfoCard
                                    className="w-full sm:w-[280px]"
                                    title="Why this matters"
                                    tooltip="The reasoning behind why this need exists."
                                    text={it.rationale}
                                    Icon={AlertTriangle}
                                  />

                                  <InfoCard
                                    className="w-full sm:w-[280px]"
                                    title="Why this applies here"
                                    tooltip="Why this is relevant to the current context."
                                    text={it.relevance_rationale}
                                    Icon={Search}
                                  />

                                  <InfoCard
                                    className="w-full sm:w-[280px]"
                                    title="Regulatory intent"
                                    tooltip="What the regulation is trying to achieve."
                                    text={it.intent_summary_trace}
                                    Icon={BookOpen}
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </SortableContext>
        </DndContext>

        <div className="px-3 py-2 text-[10px] text-muted-foreground/70 border-t border-border">
          Tip: use + to expand. Drag “⋮⋮” to reorder columns. Drag the thin right-edge handle to resize.
          <button
            className="ml-2 underline underline-offset-2 hover:text-foreground"
            onClick={() => setWidths({ ...DEFAULT_WIDTHS })}
            type="button"
          >
            reset widths
          </button>
        </div>
      </div>

      {sandboxOpen && sandboxDraft && (
        <NeedsSandboxPanel
          open
          tabId={tabId}
          draft={sandboxDraft}
          initialDecisions={decisions}
          initialEvals={evals}
          onClose={() => {
            setSandboxOpen(false);
            setSandboxDraft(null);
          }}
          onApply={onSandboxApply}
        />
      )}
    </>
  );
}