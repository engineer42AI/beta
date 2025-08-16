"use client";

/**
 * B-1 Identify Stakeholders
 * - Left: Quick add + (optional) AI assist
 * - Center: View toggle -> Table | Tiles | Swimlanes (drag & drop via dnd-kit)
 * - Right: Inspector (edit the selected stakeholder)
 *
 * Drag & drop:
 *   - Drag tiles between category swimlanes
 *   - Reorder inside a lane
 *   - We persist a simple `order` field so your chosen order sticks
 *
 * You can later reuse: touchpoints -> B-5/B-6, vvRole/authority -> B-7, etc.
 */

import React from "react";
import { Button } from "@/components/ui/button";

// dnd-kit (already installed)
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  MeasuringStrategy,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* =============================================================================
   Types / Model (stable + traceable)
============================================================================= */

type StakeholderId = string;

type StakeholderCategory =
  | "Flight Crew"
  | "Cabin Crew"
  | "Dispatcher"
  | "Maintenance"
  | "Operator Mgmt"
  | "Ground Ops"
  | "Airport/Air Traffic"
  | "Regulator/Authority"
  | "Supplier"
  | "Passenger/End User"
  | "Other";

type VVRole = "Validation" | "Verification" | "Both" | "None";

type CertInteraction = {
  authority?: "EASA" | "FAA" | "CAA" | "Military" | "Other";
  interaction?: "Issue Paper" | "G-1/G-2" | "PRA/PSAC" | "TCR" | "Audit" | "General";
  cadence?: "Ad-hoc" | "Milestone" | "Monthly" | "Quarterly";
  notes?: string;
};

type MissionPhase =
  | "Preflight"
  | "Taxi"
  | "Takeoff"
  | "Climb"
  | "Cruise"
  | "Descent"
  | "Approach"
  | "Landing"
  | "Turnaround"
  | "Maintenance";

type Touchpoint = {
  id: string;
  contextPhase?: MissionPhase | "N/A";
  summary: string; // seed for B-5/B-6
  relatedInterfaces?: string[]; // tie to B-4 later
};

type EvidenceRef = { source: "Interview" | "Doc" | "Email" | "LLM"; uri?: string; note?: string };

type Stakeholder = {
  id: StakeholderId;
  name: string;
  category: StakeholderCategory;
  organization?: string;
  description?: string;
  responsibilities: string[];
  vvRole: VVRole;
  certCoord?: CertInteraction;
  touchpoints: Touchpoint[];
  phases: MissionPhase[]; // links to B-2
  status: "draft" | "proposed" | "confirmed";
  tags: string[];
  evidence: EvidenceRef[];
  createdAt: string;
  updatedAt: string;

  /** order index used for drag/reorder in a category */
  order: number;
};

/* =============================================================================
   Constants
============================================================================= */

const CATEGORIES: StakeholderCategory[] = [
  "Flight Crew",
  "Cabin Crew",
  "Dispatcher",
  "Maintenance",
  "Operator Mgmt",
  "Ground Ops",
  "Airport/Air Traffic",
  "Regulator/Authority",
  "Supplier",
  "Passenger/End User",
  "Other",
];

const PHASES: MissionPhase[] = [
  "Preflight",
  "Taxi",
  "Takeoff",
  "Climb",
  "Cruise",
  "Descent",
  "Approach",
  "Landing",
  "Turnaround",
  "Maintenance",
];

const STORAGE_KEY = "e42.stakeholders.v1";

/* =============================================================================
   Utilities
============================================================================= */

function nextId() {
  return Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function canConfirm(s: Stakeholder) {
  const baseOk = s.name.trim() && s.category && s.vvRole;
  const regOk = s.category !== "Regulator/Authority" || !!s.certCoord?.authority;
  const respOk = s.vvRole === "None" || s.responsibilities.length > 0;
  return Boolean(baseOk && regOk && respOk);
}

function toJSONL(objects: any[]) {
  return objects.map((o) => JSON.stringify(o)).join("\n");
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* =============================================================================
   Visual card used in Tiles + Swimlanes (and DragOverlay)
============================================================================= */

function StakeholderCard({
  s,
  onClick,
  onConfirm,
  onDelete,
  dragStyle,
  listeners,
  attributes,
  dragHandle,
}: {
  s: Stakeholder;
  onClick?: (id: string) => void;
  onConfirm?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** style applied while dragging (transform/transition) */
  dragStyle?: React.CSSProperties;
  /** dnd-kit bindings */
  listeners?: any;
  attributes?: any;
  /** optional separate handle element (defaults to entire card) */
  dragHandle?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border shadow-sm p-3 bg-card hover:shadow-md transition cursor-pointer flex flex-col gap-2"
      style={dragStyle}
      onClick={onClick ? () => onClick(s.id) : undefined}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm truncate">{s.name || "Unnamed"}</div>
        <span className="text-[10px] px-2 py-0.5 rounded-full border">{s.status}</span>
      </div>
      <div className="text-xs text-muted-foreground truncate">
        {s.organization || "—"}
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="text-[10px] rounded-full px-2 py-0.5 border">{s.category}</span>
        <span className="text-[10px] rounded-full px-2 py-0.5 border">{s.vvRole}</span>
        {s.certCoord?.authority && (
          <span className="text-[10px] rounded-full px-2 py-0.5 border">
            {s.certCoord.authority}
          </span>
        )}
        {s.touchpoints.length > 0 && (
          <span className="text-[10px] rounded-full px-2 py-0.5 border">
            {s.touchpoints.length} TP
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {onConfirm && (
          <Button
            size="sm"
            className="h-7"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm(s.id);
            }}
            disabled={!canConfirm(s)}
          >
            Confirm
          </Button>
        )}
        {onDelete && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(s.id);
            }}
          >
            Delete
          </Button>
        )}
        {/* Optional drag-handle icon spot */}
        {dragHandle}
      </div>
    </div>
  );
}

/* =============================================================================
   Tiles grid (non-draggable, just a responsive grid)
============================================================================= */
function TilesGrid({
  items,
  onClick,
  onConfirm,
  onDelete,
}: {
  items: Stakeholder[];
  onClick: (id: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map((s) => (
        <StakeholderCard
          key={s.id}
          s={s}
          onClick={onClick}
          onConfirm={onConfirm}
          onDelete={onDelete}
        />
      ))}
      {!items.length && (
        <div className="text-sm text-muted-foreground border rounded-lg p-6">
          No stakeholders. Use **Quick add** or the **+ Add** button.
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   Sortable card (one tile) used by dnd-kit
============================================================================= */
function SortableTile({
  s,
  onClick,
  onConfirm,
  onDelete,
}: {
  s: Stakeholder;
  onClick: (id: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  // Hook up dnd-kit for a draggable item
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: s.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef}>
      <StakeholderCard
        s={s}
        onClick={onClick}
        onConfirm={onConfirm}
        onDelete={onDelete}
        dragStyle={style}
        listeners={listeners}
        attributes={attributes}
      />
    </div>
  );
}

/* =============================================================================
   Swimlanes with drag & drop (dnd-kit)
   - lanes: Record<category, Stakeholder[]>
   - Move within a lane or across lanes
============================================================================= */
function SwimlanesDnd({
  lanes,
  draggingId,
  onClick,
  onConfirm,
  onDelete,
}: {
  lanes: Record<string, Stakeholder[]>;
  draggingId: string | null;
  onClick: (id: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const renderOverlay = () => {
    if (!draggingId) return null;
    const s = Object.values(lanes).flat().find((x) => x.id === draggingId);
    if (!s) return null;
    return (
      <div className="w-[260px]">
        <StakeholderCard s={s} />
      </div>
    );
  };

  const cats = Object.keys(lanes);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
        {cats.map((cat) => {
          const items = lanes[cat] ?? [];
          return (
            <div key={cat} className="rounded-xl border bg-background">
              <div className="px-3 py-2 text-xs font-semibold border-b">{cat}</div>

              {/* Make the whole lane a sortable context for its items */}
              <div className="p-3 flex flex-col gap-3 min-h-[84px]">
                <SortableContext
                  id={`lane-${cat}`}
                  items={items.map((i) => i.id)}
                  strategy={rectSortingStrategy}
                >
                  {items.map((s) => (
                    <SortableTile
                      key={s.id}
                      s={s}
                      onClick={onClick}
                      onConfirm={onConfirm}
                      onDelete={onDelete}
                    />
                  ))}
                </SortableContext>

                {!items.length && (
                  <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Nice preview while dragging */}
      <DragOverlay>{renderOverlay()}</DragOverlay>
    </>
  );
}

/* =============================================================================
   Page (main)
============================================================================= */

type BoardView = "table" | "tiles" | "swimlanes";

export default function StakeholdersPage() {
  const [stakeholders, setStakeholders] = React.useState<Stakeholder[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<{
    q: string;
    cat: "All" | StakeholderCategory;
    status: "All" | Stakeholder["status"];
  }>({ q: "", cat: "All", status: "All" });
  const [isMobile, setIsMobile] = React.useState(false);
  const [view, setView] = React.useState<BoardView>("swimlanes");

  // dnd-kit sensors (distance 8px before it picks up)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Which tile is being dragged (for DragOverlay)
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  // mobile detect
  React.useEffect(() => {
    const m = window.matchMedia("(max-width: 768px), (pointer:coarse)");
    const f = () => setIsMobile(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);

  // load/save
  React.useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setStakeholders(JSON.parse(raw));
  }, []);
  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stakeholders));
  }, [stakeholders]);

  // selected object
  const selected = React.useMemo(
    () => stakeholders.find((s) => s.id === selectedId) ?? null,
    [stakeholders, selectedId]
  );

  /* ---------------- actions (add/patch/remove/confirm) ---------------- */

  function add(seed: Partial<Stakeholder>) {
    const s: Stakeholder = {
      id: nextId(),
      name: seed.name ?? "",
      category: (seed.category as StakeholderCategory) ?? "Other",
      organization: seed.organization ?? "",
      description: seed.description ?? "",
      responsibilities: seed.responsibilities ?? [],
      vvRole: seed.vvRole ?? "None",
      certCoord: seed.certCoord,
      touchpoints: seed.touchpoints ?? [],
      phases: seed.phases ?? [],
      status: seed.status ?? "draft",
      tags: seed.tags ?? [],
      evidence: seed.evidence ?? [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      order: Date.now(), // simple monotonically increasing order
    };
    setStakeholders((p) => p.concat(s));
    setSelectedId(s.id);
  }

  function patch(id: string, updater: (prev: Stakeholder) => Stakeholder) {
    setStakeholders((prev) =>
      prev.map((s) => (s.id === id ? { ...updater(s), updatedAt: nowIso() } : s))
    );
  }

  function remove(id: string) {
    setStakeholders((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function confirm(id: string) {
    patch(id, (s) => ({ ...s, status: "confirmed" }));
  }

  /* ----------- AI Suggest (stub, replace with your LLM) ----------- */
  const [aiInput, setAiInput] = React.useState("");
  const [aiCandidates, setAiCandidates] = React.useState<Partial<Stakeholder>[]>([]);

  function runAISuggest() {
    const text = aiInput.toLowerCase();
    const c: Partial<Stakeholder>[] = [];
    if (/pilot|crew|cockpit/.test(text))
      c.push({
        name: "Pilot-in-Command",
        category: "Flight Crew",
        vvRole: "Validation",
        status: "proposed",
        evidence: [{ source: "LLM", note: "Heuristic" }],
      });
    if (/dispatcher|ops/.test(text))
      c.push({
        name: "Flight Dispatcher",
        category: "Dispatcher",
        vvRole: "Validation",
        status: "proposed",
        evidence: [{ source: "LLM" }],
      });
    if (/maint|mro|line/.test(text))
      c.push({
        name: "Line Maintenance Engineer",
        category: "Maintenance",
        vvRole: "Verification",
        status: "proposed",
        evidence: [{ source: "LLM" }],
      });
    if (/easa|faa|authority|cert/.test(text))
      c.push({
        name: "EASA PCM",
        category: "Regulator/Authority",
        vvRole: "None",
        certCoord: { authority: "EASA", interaction: "Issue Paper", cadence: "Milestone" },
        status: "proposed",
        evidence: [{ source: "LLM" }],
      });
    if (/cabin|attendant/.test(text))
      c.push({
        name: "Cabin Crew",
        category: "Cabin Crew",
        vvRole: "Validation",
        status: "proposed",
        evidence: [{ source: "LLM" }],
      });
    if (c.length === 0)
      c.push({
        name: "Operator Representative",
        category: "Operator Mgmt",
        vvRole: "Validation",
        status: "proposed",
        evidence: [{ source: "LLM" }],
      });
    setAiCandidates(c);
  }

  function acceptCandidate(c: Partial<Stakeholder>) {
    add(c);
    setAiCandidates((prev) => prev.filter((x) => x !== c));
  }

  /* ---------------- derived view ---------------- */

  const rows = stakeholders
    .filter((s) => {
      const q = filter.q.trim().toLowerCase();
      const inQ =
        !q ||
        [s.name, s.organization, s.category, s.vvRole, (s.tags || []).join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(q);
      const inCat = filter.cat === "All" || s.category === filter.cat;
      const inStatus = filter.status === "All" || s.status === filter.status;
      return inQ && inCat && inStatus;
    })
    // make sure consistent order inside a category
    .sort((a, b) => (a.category === b.category ? a.order - b.order : 0));

  // group for swimlanes
  const byCategory: Record<string, Stakeholder[]> = React.useMemo(() => {
    const g: Record<string, Stakeholder[]> = {};
    for (const s of rows) {
      const k = s.category || "Other";
      (g[k] ||= []).push(s);
    }
    return g;
  }, [rows]);

  const select = (id: string) => setSelectedId(id);

  /* =============================================================================
     dnd-kit handlers (move within lane or across lanes)
     - We derive the "over lane" by its SortableContext id: lane-<Category>
     - When over another item, we infer that item’s category
  ============================================================================= */

  function getCategoryFromLaneId(laneId: string) {
    return laneId.replace(/^lane-/, "") as StakeholderCategory;
  }

  function onDragStart(e: DragStartEvent) {
    const activeId = String(e.active.id);
    setDraggingId(activeId);
  }

  function onDragOver(_: DragOverEvent) {
    // optional: could show lane highlight here
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;

    setDraggingId(null);

    if (!overId || activeId === overId) return;

    const active = stakeholders.find((s) => s.id === activeId);
    if (!active) return;

    // Case A: Dropped over a lane (id starts with "lane-")
    if (overId.startsWith("lane-")) {
      const toCategory = getCategoryFromLaneId(overId);
      setStakeholders((prev) =>
        prev.map((s) =>
          s.id === activeId ? { ...s, category: toCategory, order: Date.now() } : s
        )
      );
      return;
    }

    // Case B: Dropped over another item (reorder and maybe change category)
    const overItem = stakeholders.find((s) => s.id === overId);
    if (!overItem) return;

    const sameCategory = active.category === overItem.category;
    const toCategory = overItem.category;

    // Build lists for that category, reorder indexes
    setStakeholders((prev) => {
      const list = prev
        .filter((s) => s.category === toCategory)
        .sort((a, b) => a.order - b.order)
        .map((s) => s.id);

      const fromList = prev
        .filter((s) => s.category === active.category)
        .sort((a, b) => a.order - b.order)
        .map((s) => s.id);

      // Remove active from its current list
      const from = sameCategory ? list : fromList;
      const fromIndex = from.indexOf(activeId);
      if (fromIndex >= 0) from.splice(fromIndex, 1);

      // Insert before the target item in the destination list
      const toList = list;
      const overIndex = toList.indexOf(overId);
      const insertIndex = Math.max(0, overIndex);
      toList.splice(insertIndex, 0, activeId);

      // Compute new order mapping for the destination category
      const now = Date.now();
      const newOrderMap = new Map<string, number>();
      toList.forEach((id, i) => newOrderMap.set(id, now + i)); // stable incremental order

      return prev.map((s) => {
        if (s.id === activeId) {
          return { ...s, category: toCategory, order: newOrderMap.get(activeId) ?? s.order };
        }
        if (s.category === toCategory) {
          const ord = newOrderMap.get(s.id);
          return typeof ord === "number" ? { ...s, order: ord } : s;
        }
        return s;
      });
    });
  }

  /* =============================================================================
     Render
  ============================================================================= */

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Header */}
      <div className="h-11 border-b px-3 flex items-center gap-2 bg-background">
        <div className="font-medium text-sm">B-1 Identify Stakeholders</div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => download("stakeholders.jsonl", toJSONL(stakeholders))}
          >
            Export JSONL
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => localStorage.removeItem(STORAGE_KEY)}
          >
            Clear Local
          </Button>
        </div>
      </div>

      {/* Body grid */}
      <div className="flex-1 min-h-0 grid grid-cols-12">
        {/* LEFT: Discovery / AI / templates (collapsible on mobile) */}
        {!isMobile && (
          <aside className="col-span-3 border-r overflow-auto p-3 space-y-3">
            <div className="text-xs font-semibold">Quick add</div>
            <div className="flex flex-wrap gap-2">
              {[
                { n: "Pilot-in-Command", c: "Flight Crew" as StakeholderCategory, r: "Validation" as VVRole },
                { n: "Flight Dispatcher", c: "Dispatcher" as StakeholderCategory, r: "Validation" as VVRole },
                { n: "Line Maintenance Engineer", c: "Maintenance" as StakeholderCategory, r: "Verification" as VVRole },
                { n: "EASA PCM", c: "Regulator/Authority" as StakeholderCategory, r: "None" as VVRole },
                { n: "Cabin Crew", c: "Cabin Crew" as StakeholderCategory, r: "Validation" as VVRole },
                { n: "Operator Representative", c: "Operator Mgmt" as StakeholderCategory, r: "Validation" as VVRole },
              ].map((x) => (
                <Button
                  key={x.n}
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    add({ name: x.n, category: x.c, vvRole: x.r, status: "draft" })
                  }
                >
                  + {x.n}
                </Button>
              ))}
            </div>

            <div className="pt-3 border-t">
              <div className="text-xs font-semibold mb-1">
                AI Suggest (paste org/mission text)
              </div>
              <textarea
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                className="w-full rounded border bg-transparent p-2 text-sm"
                rows={4}
              />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" onClick={runAISuggest}>
                  Suggest
                </Button>
                {!!aiCandidates.length && (
                  <span className="text-xs text-muted-foreground">
                    {aiCandidates.length} candidate(s)
                  </span>
                )}
              </div>

              {!!aiCandidates.length && (
                <div className="mt-2 space-y-2">
                  {aiCandidates.map((c, i) => (
                    <div key={i} className="rounded border p-2 text-sm">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.category} • {c.vvRole ?? "—"}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => acceptCandidate(c)}>
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setAiCandidates((prev) => prev.filter((x) => x !== c))
                          }
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* CENTER: Register (switchable views) */}
        <main
          className={`${isMobile ? "col-span-12" : "col-span-6"} overflow-auto p-3`}
        >
          {/* Filters + View toggle */}
          <div className="mb-3 flex items-center gap-2">
            <input
              placeholder="Search…"
              className="rounded border bg-transparent px-2 py-1 text-sm w-48"
              value={filter.q}
              onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            />
            <select
              className="rounded border bg-transparent px-2 py-1 text-sm"
              value={filter.cat}
              onChange={(e) => setFilter({ ...filter, cat: e.target.value as any })}
            >
              <option>All</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              className="rounded border bg-transparent px-2 py-1 text-sm"
              value={filter.status}
              onChange={(e) =>
                setFilter({ ...filter, status: e.target.value as any })
              }
            >
              <option>All</option>
              <option>draft</option>
              <option>proposed</option>
              <option>confirmed</option>
            </select>

            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant={view === "table" ? "default" : "secondary"}
                onClick={() => setView("table")}
              >
                Table
              </Button>
              <Button
                size="sm"
                variant={view === "tiles" ? "default" : "secondary"}
                onClick={() => setView("tiles")}
              >
                Tiles
              </Button>
              <Button
                size="sm"
                variant={view === "swimlanes" ? "default" : "secondary"}
                onClick={() => setView("swimlanes")}
              >
                Swimlanes
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  add({
                    name: "New stakeholder",
                    status: "draft",
                    vvRole: "None",
                    category: "Other",
                  })
                }
              >
                + Add
              </Button>
            </div>
          </div>

          {/* View content */}
          {view === "table" && (
            <div className="rounded-lg border overflow-hidden">
              {/* Minimal table to keep self-contained. Replace with your full table if you like. */}
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Org</th>
                    <th className="px-3 py-2">V&V</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">TP</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      className={`border-t hover:bg-muted/10 cursor-pointer ${
                        s.id === selectedId ? "bg-muted/20" : ""
                      }`}
                      onClick={() => select(s.id)}
                    >
                      <td className="px-3 py-2">{s.name}</td>
                      <td className="px-3 py-2">{s.category}</td>
                      <td className="px-3 py-2">{s.organization ?? "—"}</td>
                      <td className="px-3 py-2">{s.vvRole}</td>
                      <td className="px-3 py-2">{s.status}</td>
                      <td className="px-3 py-2 text-center">
                        {s.touchpoints.length}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              confirm(s.id);
                            }}
                            disabled={!canConfirm(s)}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(s.id);
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td
                        colSpan={7}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        No stakeholders yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {view === "tiles" && (
            <TilesGrid
              items={rows}
              onClick={select}
              onDelete={remove}
              onConfirm={confirm}
            />
          )}

          {view === "swimlanes" && (
            // dnd-kit root; we handle moves in onDragEnd above
            <DndContext
              sensors={sensors}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              // helps measure correctly on large boards
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            >
              <SwimlanesDnd
                lanes={byCategory}
                draggingId={draggingId}
                onClick={select}
                onDelete={remove}
                onConfirm={confirm}
              />
            </DndContext>
          )}
        </main>

        {/* RIGHT: Inspector */}
        {!isMobile && (
          <aside className="col-span-3 border-l p-3">
            <div
              className="
                rounded-lg border shadow-lg bg-white dark:bg-neutral-900
                p-3 flex flex-col
                [width:clamp(280px,70vw,500px)]
                [height:clamp(260px,60vh,560px)]
                max-w-[calc(100%-8px)] max-h-[calc(100%-8px)]
              "
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Node Inspector</div>
                <div className="text-xs text-muted-foreground">
                  {selected ? `#${selected.id}` : "No selection"}
                </div>
              </div>

              <div className="flex-1 overflow-auto space-y-3">
                {!selected ? (
                  <div className="text-sm text-muted-foreground">
                    Select a stakeholder to edit.
                  </div>
                ) : (
                  <>
                    <details className="rounded border p-2" open>
                      <summary className="cursor-pointer text-sm font-medium mb-1">
                        Raw data
                      </summary>
                      <pre className="text-xs whitespace-pre-wrap break-words rounded p-2 bg-white/60 dark:bg-neutral-800/60 max-h-28 overflow-auto">
                        {JSON.stringify(selected, null, 2)}
                      </pre>
                    </details>

                    {/* Summary */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Name</label>
                      <input
                        className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                        value={selected.name}
                        onChange={(e) =>
                          patch(selected.id, (p) => ({ ...p, name: e.target.value }))
                        }
                      />
                      <label className="text-xs font-medium">Organization</label>
                      <input
                        className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                        value={selected.organization ?? ""}
                        onChange={(e) =>
                          patch(selected.id, (p) => ({
                            ...p,
                            organization: e.target.value,
                          }))
                        }
                      />
                      <label className="text-xs font-medium">Description</label>
                      <textarea
                        rows={3}
                        className="w-full rounded border bg-transparent px-2 py-1 text-sm resize-y"
                        value={selected.description ?? ""}
                        onChange={(e) =>
                          patch(selected.id, (p) => ({
                            ...p,
                            description: e.target.value,
                          }))
                        }
                      />
                    </div>

                    {/* Responsibilities */}
                    <div className="space-y-2">
                      <div className="text-xs font-medium">Responsibilities</div>
                      {(selected.responsibilities ?? []).map((r, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            className="flex-1 rounded border bg-transparent px-2 py-1 text-sm"
                            value={r}
                            onChange={(e) =>
                              patch(selected.id, (p) => {
                                const arr = [...p.responsibilities];
                                arr[i] = e.target.value;
                                return { ...p, responsibilities: arr };
                              })
                            }
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              patch(selected.id, (p) => ({
                                ...p,
                                responsibilities: p.responsibilities.filter(
                                  (_: string, j: number) => j !== i
                                ),
                              }))
                            }
                          >
                            -
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          patch(selected.id, (p) => ({
                            ...p,
                            responsibilities: [...p.responsibilities, ""],
                          }))
                        }
                      >
                        + add
                      </Button>
                    </div>

                    {/* V&V & Cert */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs font-medium">V&V Role</div>
                        <select
                          className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.vvRole}
                          onChange={(e) =>
                            patch(selected.id, (p) => ({
                              ...p,
                              vvRole: e.target.value as VVRole,
                            }))
                          }
                        >
                          {["Validation", "Verification", "Both", "None"].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs font-medium">Authority</div>
                        <select
                          className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.certCoord?.authority ?? ""}
                          onChange={(e) =>
                            patch(selected.id, (p) => ({
                              ...p,
                              certCoord: { ...(p.certCoord ?? {}), authority: e.target.value as any },
                            }))
                          }
                        >
                          <option value=""></option>
                          {["EASA", "FAA", "CAA", "Military", "Other"].map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs font-medium">Interaction</div>
                        <select
                          className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.certCoord?.interaction ?? ""}
                          onChange={(e) =>
                            patch(selected.id, (p) => ({
                              ...p,
                              certCoord: { ...(p.certCoord ?? {}), interaction: e.target.value as any },
                            }))
                          }
                        >
                          <option value=""></option>
                          {["Issue Paper", "G-1/G-2", "PRA/PSAC", "TCR", "Audit", "General"].map(
                            (a) => (
                              <option key={a}>{a}</option>
                            )
                          )}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs font-medium">Cadence</div>
                        <select
                          className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.certCoord?.cadence ?? ""}
                          onChange={(e) =>
                            patch(selected.id, (p) => ({
                              ...p,
                              certCoord: { ...(p.certCoord ?? {}), cadence: e.target.value as any },
                            }))
                          }
                        >
                          <option value=""></option>
                          {["Ad-hoc", "Milestone", "Monthly", "Quarterly"].map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Touchpoints */}
                    <div className="space-y-2">
                      <div className="text-xs font-medium">Touchpoints (phase + one-liner)</div>
                      {(selected.touchpoints ?? []).map((t, i) => (
                        <div key={t.id} className="grid grid-cols-5 gap-2">
                          <select
                            className="col-span-2 rounded border bg-transparent px-2 py-1 text-sm"
                            value={t.contextPhase ?? "N/A"}
                            onChange={(e) =>
                              patch(selected.id, (p) => {
                                const arr = [...p.touchpoints];
                                arr[i] = {
                                  ...arr[i],
                                  contextPhase: e.target.value as any,
                                };
                                return { ...p, touchpoints: arr };
                              })
                            }
                          >
                            <option>N/A</option>
                            {PHASES.map((ph) => (
                              <option key={ph}>{ph}</option>
                            ))}
                          </select>
                          <input
                            className="col-span-3 rounded border bg-transparent px-2 py-1 text-sm"
                            value={t.summary}
                            onChange={(e) =>
                              patch(selected.id, (p) => {
                                const arr = [...p.touchpoints];
                                arr[i] = { ...arr[i], summary: e.target.value };
                                return { ...p, touchpoints: arr };
                              })
                            }
                          />
                          <div className="col-span-5 -mt-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                patch(selected.id, (p) => ({
                                  ...p,
                                  touchpoints: p.touchpoints.filter((x) => x.id !== t.id),
                                }))
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          patch(selected.id, (p) => ({
                            ...p,
                            touchpoints: [
                              ...p.touchpoints,
                              { id: nextId(), contextPhase: "N/A", summary: "" },
                            ],
                          }))
                        }
                      >
                        + Add touchpoint
                      </Button>
                    </div>

                    {/* Tags & Status */}
                    <div className="space-y-2">
                      <div className="text-xs font-medium">Tags (comma separated)</div>
                      <input
                        className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                        value={selected.tags.join(", ")}
                        onChange={(e) =>
                          patch(selected.id, (p) => ({
                            ...p,
                            tags: e.target.value
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean),
                          }))
                        }
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => confirm(selected.id)}
                          disabled={!canConfirm(selected)}
                        >
                          Mark Confirmed
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => remove(selected.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
