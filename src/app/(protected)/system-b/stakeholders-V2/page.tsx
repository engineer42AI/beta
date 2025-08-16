"use client";

/**
 * B-1 Identify Stakeholders — V2 (personas + visual)
 * --------------------------------------------------
 * - Personas view: card grid with avatars, goals, pains, quick confirm
 * - Matrix view: Influence × Interest (drag between quadrants)
 * - Lifecycle lanes: Discover → Draft → Confirmed (drag between lanes)
 * - Inspector: only opens when a card is selected (progressive disclosure)
 *
 * You can safely change types/fields here; downstream pages can consume the JSONL.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DndContext,
  PointerSensor,
  DragOverlay,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
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
   Types — V2 is persona-centric
============================================================================= */

type StakeholderId = string;

type PersonaArchetype =
  | "Pilot-in-Command"
  | "First Officer"
  | "Cabin Crew"
  | "Dispatcher"
  | "Line Maintenance"
  | "Operator Management"
  | "Ground Ops"
  | "Certification Authority"
  | "Supplier"
  | "Passenger"
  | "Other";

type VvRole = "Validation" | "Verification" | "Both" | "None";
type Authority = "" | "EASA" | "FAA" | "CAA" | "Military" | "Other";

type Stage = "Discover" | "Draft" | "Confirmed"; // lifecycle lanes

type Persona = {
  id: StakeholderId;
  /** identity */
  displayName: string;      // “Capt. Maria Ortega”
  archetype: PersonaArchetype;
  org?: string;             // airline, unit
  avatar?: string;          // dataURL; we generate initials if empty

  /** lightweight story */
  bio?: string;             // 1–2 sentences
  goals?: string[];         // “on-time turnarounds”
  pains?: string[];         // “unclear MEL at cold-soak”

  /** engagement attributes */
  influence: 1 | 2 | 3 | 4 | 5;   // x-axis for matrix
  interest: 1 | 2 | 3 | 4 | 5;    // y-axis for matrix
  vv: VvRole;
  authority: Authority;

  /** status & meta */
  stage: Stage;             // for Lifecycle lanes
  tags: string[];
  createdAt: string;
  updatedAt: string;
  order: number;            // stable index within a lane/quadrant
};

/* =============================================================================
   Constants
============================================================================= */

const STORAGE_KEY = "e42.stakeholders.v2";

const ARCHETYPES: PersonaArchetype[] = [
  "Pilot-in-Command",
  "First Officer",
  "Cabin Crew",
  "Dispatcher",
  "Line Maintenance",
  "Operator Management",
  "Ground Ops",
  "Certification Authority",
  "Supplier",
  "Passenger",
  "Other",
];

const STAGES: Stage[] = ["Discover", "Draft", "Confirmed"];

/* =============================================================================
   Utils
============================================================================= */

const nowIso = () => new Date().toISOString();
const nextId = () => Math.random().toString(36).slice(2, 10);

function toJSONL(objects: unknown[]) {
  return objects.map((o) => JSON.stringify(o)).join("\n");
}
function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Initials avatar (no external deps) */
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Simple confirm check — keep V2 light */
function canConfirm(p: Persona) {
  return Boolean(p.displayName.trim() && p.archetype && p.vv);
}

/* =============================================================================
   Shared Card
============================================================================= */

function PersonaCard({
  p,
  onClick,
  onConfirm,
  onDelete,
  dragStyle,
  listeners,
  attributes,
}: {
  p: Persona;
  onClick?: (id: string) => void;
  onConfirm?: (id: string) => void;
  onDelete?: (id: string) => void;
  dragStyle?: React.CSSProperties;
  listeners?: any;
  attributes?: any;
}) {
  return (
    <div
      className="rounded-xl border shadow-sm p-3 bg-card hover:shadow-md transition cursor-pointer flex flex-col gap-2"
      style={dragStyle}
      onClick={onClick ? () => onClick(p.id) : undefined}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-2">
        {/* Avatar */}
        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
          {p.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatar} alt={p.displayName} className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <span>{initials(p.displayName || p.archetype)}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{p.displayName || p.archetype}</div>
          <div className="text-[11px] text-muted-foreground truncate">{p.archetype}{p.org ? ` • ${p.org}` : ""}</div>
        </div>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border">{p.stage}</span>
      </div>

      {/* Bio */}
      {p.bio && <div className="text-xs text-muted-foreground line-clamp-2">{p.bio}</div>}

      {/* Chips */}
      <div className="flex flex-wrap gap-1">
        <span className="text-[10px] rounded-full px-2 py-0.5 border">V&V: {p.vv}</span>
        {p.authority && <span className="text-[10px] rounded-full px-2 py-0.5 border">{p.authority}</span>}
        <span className="text-[10px] rounded-full px-2 py-0.5 border">Influence {p.influence}</span>
        <span className="text-[10px] rounded-full px-2 py-0.5 border">Interest {p.interest}</span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        {onConfirm && (
          <Button
            size="sm"
            className="h-7"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm(p.id);
            }}
            disabled={!canConfirm(p)}
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
              onDelete(p.id);
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function SortablePersona({
  p,
  onClick,
  onConfirm,
  onDelete,
}: {
  p: Persona;
  onClick: (id: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: p.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef}>
      <PersonaCard
        p={p}
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
   Personas grid (simple non-draggable)
============================================================================= */

function PersonasGrid({
  items,
  onClick,
  onConfirm,
  onDelete,
}: {
  items: Persona[];
  onClick: (id: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map((p) => (
        <PersonaCard key={p.id} p={p} onClick={onClick} onConfirm={onConfirm} onDelete={onDelete} />
      ))}
      {!items.length && (
        <div className="text-sm text-muted-foreground border rounded-lg p-6">
          No stakeholders yet. Use Quick Add or + Add.
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   Influence × Interest Matrix (drag between quadrants)
   - Quadrants: High/Low thresholds at 3
============================================================================= */

type QuadKey = "HH" | "HL" | "LH" | "LL";
const INFL_THRESHOLD = 3;
const INT_THRESHOLD = 3;

function quadKey(p: Persona): QuadKey {
  const inf = p.influence >= INFL_THRESHOLD ? "H" : "L";
  const int = p.interest >= INT_THRESHOLD ? "H" : "L";
  return (inf + int) as QuadKey;
}
function quadLabel(key: QuadKey) {
  switch (key) {
    case "HH": return "Manage Closely";
    case "HL": return "Keep Satisfied";
    case "LH": return "Keep Informed";
    case "LL": return "Monitor";
  }
}

function MatrixBoard({
  groups,
  draggingId,
  onClick,
  onConfirm,
  onDelete,
}: {
  groups: Record<QuadKey, Persona[]>;
  draggingId: string | null;
  onClick: (id: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const keys: QuadKey[] = ["HH", "HL", "LH", "LL"];

  const overlay = () => {
    if (!draggingId) return null;
    const p = Object.values(groups).flat().find((x) => x.id === draggingId);
    if (!p) return null;
    return (
      <div className="w-[260px]">
        <PersonaCard p={p} />
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {keys.map((k) => (
          <div key={k} className="rounded-xl border bg-background">
            <div className="px-3 py-2 border-b text-xs font-semibold">{quadLabel(k)}</div>
            <div className="p-3 flex flex-col gap-3 min-h-[84px]">
              <SortableContext id={`quad-${k}`} items={groups[k].map((p) => p.id)} strategy={rectSortingStrategy}>
                {groups[k].map((p) => (
                  <SortablePersona key={p.id} p={p} onClick={onClick} onConfirm={onConfirm} onDelete={onDelete} />
                ))}
              </SortableContext>
              {!groups[k].length && (
                <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                  Drop here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <DragOverlay>{overlay()}</DragOverlay>
    </>
  );
}

/* =============================================================================
   Lifecycle lanes (Discover → Draft → Confirmed)
============================================================================= */

function LaneBoard({
  lanes,
  draggingId,
  onClick,
  onConfirm,
  onDelete,
}: {
  lanes: Record<Stage, Persona[]>;
  draggingId: string | null;
  onClick: (id: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const overlay = () => {
    if (!draggingId) return null;
    const p = Object.values(lanes).flat().find((x) => x.id === draggingId);
    if (!p) return null;
    return (
      <div className="w-[260px]">
        <PersonaCard p={p} />
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STAGES.map((stage) => (
          <div key={stage} className="rounded-xl border bg-background">
            <div className="px-3 py-2 border-b text-xs font-semibold">{stage}</div>
            <div className="p-3 flex flex-col gap-3 min-h-[84px]">
              <SortableContext id={`lane-${stage}`} items={lanes[stage].map((p) => p.id)} strategy={rectSortingStrategy}>
                {lanes[stage].map((p) => (
                  <SortablePersona key={p.id} p={p} onClick={onClick} onConfirm={onConfirm} onDelete={onDelete} />
                ))}
              </SortableContext>
              {!lanes[stage].length && (
                <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                  Drop here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <DragOverlay>{overlay()}</DragOverlay>
    </>
  );
}

/* =============================================================================
   Page
============================================================================= */

type View = "Personas" | "Matrix" | "Lanes";

export default function StakeholdersPageV2() {
  const [items, setItems] = React.useState<Persona[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<View>("Matrix");
  const [isMobile, setIsMobile] = React.useState(false);

  // dnd-kit
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  // responsive
  React.useEffect(() => {
    const m = window.matchMedia("(max-width: 768px), (pointer:coarse)");
    const f = () => setIsMobile(m.matches);
    f(); m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);

  // persist
  React.useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setItems(JSON.parse(raw));
  }, []);
  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const selected = React.useMemo(() => items.find((x) => x.id === selectedId) ?? null, [items, selectedId]);

  /* ---------- CRUD ---------- */

  function add(seed?: Partial<Persona>) {
    const p: Persona = {
      id: nextId(),
      displayName: seed?.displayName ?? "",
      archetype: (seed?.archetype as PersonaArchetype) ?? "Other",
      org: seed?.org ?? "",
      avatar: seed?.avatar,
      bio: seed?.bio ?? "",
      goals: seed?.goals ?? [],
      pains: seed?.pains ?? [],
      influence: (seed?.influence as Persona["influence"]) ?? 2,
      interest: (seed?.interest as Persona["interest"]) ?? 3,
      vv: (seed?.vv as VvRole) ?? "Validation",
      authority: (seed?.authority as Authority) ?? "",
      stage: (seed?.stage as Stage) ?? "Discover",
      tags: seed?.tags ?? [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      order: Date.now(),
    };
    setItems((pvs) => pvs.concat(p));
    setSelectedId(p.id);
  }

  function patch(id: string, fn: (prev: Persona) => Persona) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...fn(x), updatedAt: nowIso() } : x)));
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function confirm(id: string) {
    patch(id, (p) => ({ ...p, stage: "Confirmed" }));
  }

  /* ---------- AI Suggest (stub) ---------- */

  const [aiText, setAiText] = React.useState("");
  const [candidates, setCandidates] = React.useState<Partial<Persona>[]>([]);
  function suggest() {
    const t = aiText.toLowerCase();
    const c: Partial<Persona>[] = [];
    if (/pilot|crew/.test(t)) c.push({ displayName: "Capt. Maria Ortega", archetype: "Pilot-in-Command", bio: "Long-haul PIC focused on fatigue risk.", influence: 5, interest: 5, vv: "Validation", stage: "Draft" });
    if (/maint|mro|line/.test(t)) c.push({ displayName: "Ravi Shah", archetype: "Line Maintenance", bio: "Night-shift Line mech at EHAM.", influence: 3, interest: 4, vv: "Verification", stage: "Draft" });
    if (/easa|faa|authority|cert/.test(t)) c.push({ displayName: "EASA PCM", archetype: "Certification Authority", bio: "Programme certification manager.", influence: 4, interest: 3, vv: "None", authority: "EASA", stage: "Discover" });
    if (/dispatch|ops/.test(t)) c.push({ displayName: "Elena Petrescu", archetype: "Dispatcher", bio: "Ops desk lead for Euro short-haul.", influence: 3, interest: 4, vv: "Validation", stage: "Discover" });
    if (!c.length) c.push({ displayName: "Operator Representative", archetype: "Operator Management", bio: "Fleet performance lead.", influence: 3, interest: 3, vv: "Validation", stage: "Discover" });
    setCandidates(c);
  }
  const accept = (c: Partial<Persona>) => {
    add(c);
    setCandidates((p) => p.filter((x) => x !== c));
  };

  /* ---------- Derived data for views ---------- */

  const personas = items.sort((a, b) => a.order - b.order);

  const byStage = React.useMemo(() => {
    const m: Record<Stage, Persona[]> = { Discover: [], Draft: [], Confirmed: [] };
    personas.forEach((p) => m[p.stage].push(p));
    return m;
  }, [personas]);

  const byQuad = React.useMemo(() => {
    const g: Record<QuadKey, Persona[]> = { HH: [], HL: [], LH: [], LL: [] };
    personas.forEach((p) => g[quadKey(p)].push(p));
    (Object.keys(g) as QuadKey[]).forEach((k) => g[k].sort((a, b) => a.order - b.order));
    return g;
  }, [personas]);

  /* ---------- dnd-kit (Matrix + Lanes) ---------- */

  function overIsLane(id: string) {
    return id.startsWith("lane-");
  }
  function overIsQuad(id: string) {
    return id.startsWith("quad-");
  }

  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
  }
  function onDragOver(_e: DragOverEvent) {}
  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    setDraggingId(null);
    if (!overId || activeId === overId) return;

    const current = items.find((x) => x.id === activeId);
    if (!current) return;

    // --- Lanes: move between stages or reorder inside a stage
    if (overIsLane(overId)) {
      const newStage = overId.replace(/^lane-/, "") as Stage;
      setItems((prev) =>
        prev.map((p) => (p.id === activeId ? { ...p, stage: newStage, order: Date.now() } : p))
      );
      return;
    }

    // --- Matrix: move between quads (adjust influence/interest) or reorder
    if (overIsQuad(overId)) {
      const q = overId.replace(/^quad-/, "") as QuadKey;
      const [inf, int] = q.split("") as ["H" | "L", "H" | "L"];
      const toInfluence = inf === "H" ? 4 : 2;
      const toInterest = int === "H" ? 4 : 2;
      setItems((prev) =>
        prev.map((p) =>
          p.id === activeId ? { ...p, influence: toInfluence, interest: toInterest, order: Date.now() } : p
        )
      );
      return;
    }

    // Dropped on another item: reorder inside same container
    const overItem = items.find((x) => x.id === overId);
    if (!overItem) return;

    if (view === "Lanes") {
      const list = items
        .filter((x) => x.stage === overItem.stage)
        .sort((a, b) => a.order - b.order)
        .map((x) => x.id);

      const fromList = items
        .filter((x) => x.stage === current.stage)
        .sort((a, b) => a.order - b.order)
        .map((x) => x.id);

      const same = current.stage === overItem.stage;
      const sequence = same ? list : fromList;

      const fromIdx = sequence.indexOf(activeId);
      if (fromIdx >= 0) sequence.splice(fromIdx, 1);

      const toIdx = list.indexOf(overId);
      list.splice(Math.max(0, toIdx), 0, activeId);

      const now = Date.now();
      const ord = new Map<string, number>();
      list.forEach((id, i) => ord.set(id, now + i));

      setItems((prev) =>
        prev.map((p) => {
          if (p.id === activeId) return { ...p, stage: overItem.stage, order: ord.get(activeId) ?? p.order };
          if (p.stage === overItem.stage) {
            const o = ord.get(p.id);
            return typeof o === "number" ? { ...p, order: o } : p;
          }
          return p;
        })
      );
    }

    if (view === "Matrix") {
      const list = items
        .filter((x) => quadKey(x) === quadKey(overItem))
        .sort((a, b) => a.order - b.order)
        .map((x) => x.id);

      const fromList = items
        .filter((x) => quadKey(x) === quadKey(current))
        .sort((a, b) => a.order - b.order)
        .map((x) => x.id);

      const same = quadKey(current) === quadKey(overItem);
      const sequence = same ? list : fromList;

      const fromIdx = sequence.indexOf(activeId);
      if (fromIdx >= 0) sequence.splice(fromIdx, 1);

      const toIdx = list.indexOf(overId);
      list.splice(Math.max(0, toIdx), 0, activeId);

      const now = Date.now();
      const ord = new Map<string, number>();
      list.forEach((id, i) => ord.set(id, now + i));

      setItems((prev) =>
        prev.map((p) => {
          if (p.id === activeId) return { ...p, order: ord.get(activeId) ?? p.order };
          if (quadKey(p) === quadKey(overItem)) {
            const o = ord.get(p.id);
            return typeof o === "number" ? { ...p, order: o } : p;
          }
          return p;
        })
      );
    }
  }

  /* ---------- Render ---------- */

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Header */}
      <div className="h-11 border-b px-3 flex items-center gap-2 bg-background">
        <div className="font-medium text-sm">B-1 Identify Stakeholders — Personas</div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant={view === "Personas" ? "default" : "secondary"} onClick={() => setView("Personas")}>Personas</Button>
          <Button size="sm" variant={view === "Matrix" ? "default" : "secondary"} onClick={() => setView("Matrix")}>Matrix</Button>
          <Button size="sm" variant={view === "Lanes" ? "default" : "secondary"} onClick={() => setView("Lanes")}>Lanes</Button>
          <Button size="sm" variant="secondary" onClick={() => add({ displayName: "New persona", archetype: "Other" })}>+ Add</Button>
          <Button size="sm" variant="secondary" onClick={() => download("stakeholders.jsonl", toJSONL(items))}>Export JSONL</Button>
          <Button size="sm" variant="secondary" onClick={() => localStorage.removeItem(STORAGE_KEY)}>Clear Local</Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-12">
        {/* LEFT: Quick add + AI */}
        {!isMobile && (
          <aside className="col-span-3 border-r p-3 space-y-3 overflow-auto">
            <div className="text-xs font-semibold">Quick add</div>
            <div className="flex flex-wrap gap-2">
              {[
                { n: "Capt. Maria Ortega", a: "Pilot-in-Command" as PersonaArchetype },
                { n: "Elena Petrescu", a: "Dispatcher" as PersonaArchetype },
                { n: "Ravi Shah", a: "Line Maintenance" as PersonaArchetype },
                { n: "EASA PCM", a: "Certification Authority" as PersonaArchetype },
                { n: "Cabin Crew Lead", a: "Cabin Crew" as PersonaArchetype },
                { n: "Operator Representative", a: "Operator Management" as PersonaArchetype },
              ].map((x) => (
                <Button key={x.n} variant="secondary" size="sm" onClick={() => add({ displayName: x.n, archetype: x.a })}>
                  + {x.n}
                </Button>
              ))}
            </div>

            <div className="pt-3 border-t">
              <div className="text-xs font-semibold mb-1">AI Suggest (paste org/mission text)</div>
              <textarea className="w-full rounded border bg-transparent p-2 text-sm" rows={4} value={aiText} onChange={(e) => setAiText(e.target.value)} />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" onClick={suggest}>Suggest</Button>
                {!!candidates.length && <span className="text-xs text-muted-foreground">{candidates.length} candidate(s)</span>}
              </div>
              {!!candidates.length && (
                <div className="mt-2 space-y-2">
                  {candidates.map((c, i) => (
                    <div key={i} className="rounded border p-2 text-sm">
                      <div className="font-medium">{c.displayName || c.archetype}</div>
                      <div className="text-[11px] text-muted-foreground">{c.archetype}</div>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => accept(c)}>Add</Button>
                        <Button size="sm" variant="secondary" onClick={() => setCandidates((p) => p.filter((x) => x !== c))}>Dismiss</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* CENTER: personas/matrix/lanes */}
        <main className={`${isMobile ? "col-span-12" : "col-span-6"} overflow-auto p-3`}>
          {view === "Personas" && (
            <PersonasGrid items={personas} onClick={setSelectedId} onConfirm={confirm} onDelete={remove} />
          )}

          {view !== "Personas" && (
            <DndContext
              sensors={sensors}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            >
              {view === "Matrix" && (
                <MatrixBoard
                  groups={byQuad}
                  draggingId={draggingId}
                  onClick={setSelectedId}
                  onConfirm={confirm}
                  onDelete={remove}
                />
              )}
              {view === "Lanes" && (
                <LaneBoard
                  lanes={byStage}
                  draggingId={draggingId}
                  onClick={setSelectedId}
                  onConfirm={confirm}
                  onDelete={remove}
                />
              )}
            </DndContext>
          )}
        </main>

        {/* RIGHT: Inspector (progressive disclosure) */}
        {!isMobile && (
          <aside className="col-span-3 border-l p-3">
            <div className="rounded-lg border shadow-lg bg-white dark:bg-neutral-900 p-3 flex flex-col [width:clamp(280px,70vw,500px)] [height:clamp(260px,60vh,560px)]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Persona Inspector</div>
                <div className="text-xs text-muted-foreground">{selected ? `#${selected.id}` : "No selection"}</div>
              </div>

              <div className="flex-1 overflow-auto space-y-3">
                {!selected ? (
                  <div className="text-sm text-muted-foreground">Select a persona to edit.</div>
                ) : (
                  <>
                    {/* Identity */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <label className="text-xs font-medium">Display name</label>
                        <input className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.displayName}
                          onChange={(e) => patch(selected.id, (p) => ({ ...p, displayName: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs font-medium">Archetype</label>
                        <select className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.archetype}
                          onChange={(e) => patch(selected.id, (p) => ({ ...p, archetype: e.target.value as PersonaArchetype }))}>
                          {ARCHETYPES.map((a) => <option key={a}>{a}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium">Organization</label>
                        <input className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.org ?? ""}
                          onChange={(e) => patch(selected.id, (p) => ({ ...p, org: e.target.value }))} />
                      </div>
                    </div>

                    {/* Story */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Bio</label>
                      <textarea rows={3} className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                        value={selected.bio ?? ""}
                        onChange={(e) => patch(selected.id, (p) => ({ ...p, bio: e.target.value }))} />
                      {/* Goals */}
                      <div className="text-xs font-medium">Goals</div>
                      {(selected.goals ?? []).map((g, i) => (
                        <div key={i} className="flex gap-2">
                          <input className="flex-1 rounded border bg-transparent px-2 py-1 text-sm" value={g}
                            onChange={(e) => patch(selected.id, (p) => { const arr=[...(p.goals??[])]; arr[i]=e.target.value; return { ...p, goals: arr }; })} />
                          <Button size="sm" variant="secondary" onClick={() => patch(selected.id, (p) => ({ ...p, goals: (p.goals ?? []).filter((_, j) => j !== i) }))}>-</Button>
                        </div>
                      ))}
                      <Button size="sm" variant="secondary" onClick={() => patch(selected.id, (p) => ({ ...p, goals: [ ...(p.goals ?? []), "" ] }))}>+ add goal</Button>

                      {/* Pains */}
                      <div className="text-xs font-medium mt-2">Pains</div>
                      {(selected.pains ?? []).map((g, i) => (
                        <div key={i} className="flex gap-2">
                          <input className="flex-1 rounded border bg-transparent px-2 py-1 text-sm" value={g}
                            onChange={(e) => patch(selected.id, (p) => { const arr=[...(p.pains??[])]; arr[i]=e.target.value; return { ...p, pains: arr }; })} />
                          <Button size="sm" variant="secondary" onClick={() => patch(selected.id, (p) => ({ ...p, pains: (p.pains ?? []).filter((_, j) => j !== i) }))}>-</Button>
                        </div>
                      ))}
                      <Button size="sm" variant="secondary" onClick={() => patch(selected.id, (p) => ({ ...p, pains: [ ...(p.pains ?? []), "" ] }))}>+ add pain</Button>
                    </div>

                    {/* Engagement */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs font-medium">Influence</div>
                        <input type="range" min={1} max={5} value={selected.influence}
                          onChange={(e) => patch(selected.id, (p) => ({ ...p, influence: Number(e.target.value) as Persona["influence"] }))} />
                      </div>
                      <div>
                        <div className="text-xs font-medium">Interest</div>
                        <input type="range" min={1} max={5} value={selected.interest}
                          onChange={(e) => patch(selected.id, (p) => ({ ...p, interest: Number(e.target.value) as Persona["interest"] }))} />
                      </div>
                      <div>
                        <div className="text-xs font-medium">V&V Role</div>
                        <select className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.vv}
                          onChange={(e) => patch(selected.id, (p) => ({ ...p, vv: e.target.value as VvRole }))}>
                          {["Validation","Verification","Both","None"].map((x) => <option key={x}>{x}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs font-medium">Authority</div>
                        <select className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                          value={selected.authority}
                          onChange={(e) => patch(selected.id, (p) => ({ ...p, authority: e.target.value as Authority }))}>
                          {["", "EASA", "FAA", "CAA", "Military", "Other"].map((x) => <option key={x} value={x}>{x || "—"}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => confirm(selected.id)} disabled={!canConfirm(selected)}>Mark Confirmed</Button>
                      <Button size="sm" variant="secondary" onClick={() => remove(selected.id)}>Delete</Button>
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
