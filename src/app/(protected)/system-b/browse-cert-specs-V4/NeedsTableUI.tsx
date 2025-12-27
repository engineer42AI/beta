// src/app/(protected)/system-b/browse-cert-specs-V4/NeedsTableUI.tsx
"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { AlertTriangle, Search, BookOpen, FileText } from "lucide-react";

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
  need_id: string;        // stable internal id
  need_code?: string;     // ✅ display id like N-03-01 (optional for now)
  trace_uuid: string;
  path_labels: string[];

  statement: string; // need statement (primary)
  rationale: string; // BLUF rationale (shown on expand)
  need_objective: string;  // a short summary of the need statement

  frozen_at?: string;

  relevance_rationale?: string;
  intent_summary_trace?: string;
  intent_summary_section?: string;
};

type Props =
  | {
      kind: "snapshot";
      rows: FrozenNeedRow[];
      frozenAt?: string;
    }
  | {
      kind: "stream";
      items: StreamedNeedItem[];
      frozenAt?: string;
      streaming?: boolean;
      done?: number;
      total?: number;
    };

/* ---------------- helpers ---------------- */

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

function RelevanceDot({ v }: { v: boolean | undefined }) {
  const cls =
    v === true
      ? "bg-emerald-600"
      : v === false
      ? "bg-red-500"
      : "bg-muted-foreground/40";
  const label = v === true ? "Relevant" : v === false ? "Not relevant" : "—";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${cls}`} title={label} aria-label={label} />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </span>
  );
}

function lineClampClass(n: 1 | 2 | 3 | 4) {
  return `line-clamp-${n}`;
}

/* ---------------- movable + resizable columns ---------------- */

type ColId = "exp" | "clause" | "need" | "ids";

const DEFAULT_WIDTHS: Record<ColId, number> = {
  exp: 34,
  clause: 260,
  need: 820,
  ids: 160,
};

const COL_LABEL: Record<ColId, string> = {
  exp: "",
  clause: "Clause",
  need: "Need",
  ids: "ID",
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
      localStorage.setItem(
        "e42.needsTable.colWidths.v2",
        JSON.stringify(widths)
      );
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

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

  return (
    <TooltipProvider delayDuration={200}>
        <Card className="border border-border rounded-lg overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b bg-accent/20 px-3 py-2">
            <div className="text-[12px] font-semibold text-foreground">Needs Table</div>

            <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
              {headerCount} items
            </Badge>

            {props.kind === "stream" && (
              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                {props.streaming ? "streaming…" : "ready"}
                {typeof props.done === "number" && typeof props.total === "number"
                  ? ` ${props.done}/${props.total}`
                  : ""}
              </Badge>
            )}

            {props.frozenAt && (
              <div className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                frozen {props.frozenAt}
              </div>
            )}
          </div>

          {props.kind === "snapshot" ? (
            <SnapshotTable rows={props.rows} />
          ) : (
            <StreamTable items={props.items} />
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
                  <div className="text-[10px] text-muted-foreground/70 line-clamp-2">
                    {fullPath(r.path_labels)}
                  </div>
                </td>

                <td className="px-2 py-1 align-top">
                  <RelevanceDot v={r.relevant} />
                  <div className="font-mono text-[10px] text-muted-foreground/60 mt-1">
                    {shortId(r.trace_uuid)}
                  </div>
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

/* ---------------- streamed table: NEED-focused + expandable row ---------------- */

function StreamTable({ items }: { items: StreamedNeedItem[] }) {
  // NOTE: order is only for reorderable columns (exclude exp so it stays pinned)
  const [order, setOrder] = React.useState<ColId[]>(() => {
    try {
      const raw = localStorage.getItem("e42.needsTable.colOrder.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        // ensure exp is not included (pinned)
        const allowed: ColId[] = ["clause", "need", "ids"];
        const cleaned = (Array.isArray(parsed) ? parsed : [])
          .filter((c): c is ColId => allowed.includes(c));
        return ["exp", ...cleaned];
      }
    } catch {}
    return ["exp", "clause", "need", "ids"];
  });

  // persist without exp (so we don't break older saves)
  React.useEffect(() => {
    try {
      localStorage.setItem(
        "e42.needsTable.colOrder.v1",
        JSON.stringify(order.filter((c) => c !== "exp"))
      );
    } catch {}
  }, [order]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const { widths, beginResize, setWidths } = useColumnResizer();

  // expanded rows by need_id
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const toggleRow = (needId: string) =>
    setOpen((s) => ({ ...s, [needId]: !s[needId] }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const oldIndex = order.indexOf(active.id as ColId);
    const newIndex = order.indexOf(over.id as ColId);
    if (oldIndex < 0 || newIndex < 0) return;

    setOrder((prev) => arrayMove(prev, oldIndex, newIndex));
  };

  const renderCell = (col: ColId, it: StreamedNeedItem) => {
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
              onPointerDown={(e) => {
                // prevent row selection quirks while clicking the button
                e.stopPropagation();
              }}
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
          <td key={col} className="px-2 py-1 align-top">
            <div className="text-[11px] font-medium text-foreground truncate" title={last}>
              {last}
            </div>
          </td>
        );
      }

      case "need": {
          const obj = (it.need_objective ?? "").trim();
          const shown = obj || it.statement;

          return (
            <td key={col} className="px-2 py-1 align-top">
              <div
                className="line-clamp-1 overflow-hidden"
                title={shown} // full text on hover
              >
                {shown}
              </div>
            </td>
          );
        }

      case "ids": {
        const display =
          it.need_code && it.need_code.trim() ? it.need_code.trim() : shortId(it.need_id);

        return (
          <td key={col} className="px-2 py-1 align-top text-[10px] text-muted-foreground/70">
            <div className="font-mono">{display}</div>
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

          <div className="mt-2 text-[11px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">
            {v}
          </div>
        </div>
      );
  };



  if (!items.length) {
    return (
      <div className="px-3 py-4 text-[12px] text-muted-foreground italic">
        Waiting for needs…
      </div>
    );
  }

  // Reorder should only apply to the non-exp columns (exp stays left)
  const reorderable = order.filter((c) => c !== "exp");

  return (
    <div className="w-full overflow-auto">
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
                {/* exp header: no drag handle */}
                <th className="px-1 py-1.5 border-b border-border bg-background" />

                {/* reorderable headers */}
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
              {items.map((it) => {
                const isOpen = !!open[it.need_id];

                return (
                  <React.Fragment key={it.need_id}>
                    <tr className="hover:bg-accent/10">
                      {order.map((c) => renderCell(c, it))}
                    </tr>

                    {isOpen && (
                      <tr className="bg-muted/30 dark:bg-muted/20">
                        <td colSpan={order.length} className="px-2 py-2">
                          <div className="mx-auto max-w-5xl">
                            {/* Full need statement (shown only when expanded) */}
                            <div className="mb-3 px-1">
                              <div className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wide">
                                Need statement
                              </div>
                              <div className="mt-1 text-[12px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">
                                {it.statement}
                              </div>
                            </div>

                            {/* Tiles (unchanged layout/spacing) */}
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
                                text={it.intent_summary_section}
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
  );
}