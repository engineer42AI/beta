"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import { create } from "zustand";
import * as Dialog from "@radix-ui/react-dialog";
import {
  DndContext,
  DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import ReactFlow, { Background, Controls, Node, Edge } from "reactflow";

/**
 * ---------------------------------------------------------------------------
 * Minimal types
 * ---------------------------------------------------------------------------
 */

type Category =
  | "Customer"
  | "Operator"
  | "Regulator"
  | "Maintainer"
  | "Manufacturing"
  | "Supplier"
  | "Support"
  | "Disposal"
  | "Program"
  | "Public";

type Persona = {
  name?: string;
  scenario?: string;
  quote?: string;
  drivers?: string[];
  painPoints?: string[];
};

type Stakeholder = {
  id: string;
  label: string; // short: "EASA", "Line Maintenance", "A320 Captain"
  category: Category;
  role?: string;
  needs?: string[];
  constraints?: string[];
  interfaces?: ("physical" | "operational" | "information")[];
  acceptance?: string;
  persona?: Persona;
  evidence?: string[]; // simple for demo
  priority?: "H" | "M" | "L";
  source?: string;
  updatedAt: string;
};

/**
 * ---------------------------------------------------------------------------
 * Demo categories (lanes)
 * ---------------------------------------------------------------------------
 */

const CATEGORIES: Category[] = [
  "Operator",
  "Regulator",
  "Maintainer",
  "Manufacturing",
  "Supplier",
  "Support",
  "Disposal",
  "Customer",
  "Program",
  "Public",
];

/**
 * ---------------------------------------------------------------------------
 * Zustand store
 * ---------------------------------------------------------------------------
 */

type Store = {
  stakeholders: Stakeholder[];
  selectedId?: string;
  mode: "board" | "link";
  addStakeholder: (partial: Partial<Stakeholder>) => void;
  moveStakeholder: (id: string, to: Category) => void;
  updateStakeholder: (id: string, patch: Partial<Stakeholder>) => void;
  deleteStakeholder: (id: string) => void;
  setSelected: (id?: string) => void;
  setMode: (m: "board" | "link") => void;
};

const useStore = create<Store>((set) => ({
  stakeholders: [
    {
      id: "s-1",
      label: "EASA",
      category: "Regulator",
      role: "Certification authority",
      needs: ["Compliance with CS-25"],
      constraints: ["Safety objectives", "Environmental limits"],
      interfaces: ["information"],
      acceptance: "Type Certificate issued",
      priority: "H",
      updatedAt: new Date().toISOString(),
    },
    {
      id: "s-2",
      label: "Line Maintenance",
      category: "Maintainer",
      role: "Overnight service & turnaround fixes",
      needs: ["Fast LRU access"],
      constraints: ["Ramp time", "Weather exposure"],
      interfaces: ["physical", "operational"],
      acceptance: "Access < 5 min, standard tooling",
      priority: "H",
      updatedAt: new Date().toISOString(),
      persona: {
        name: "Maria – Line Maintenance Lead",
        scenario: "Overnight A-check in freezing rain",
        quote: "If it's hard to reach, it gets skipped.",
        drivers: ["availability", "safety", "turn time"],
        painPoints: ["ladder access", "low light", "tooling"],
      },
    },
  ],
  selectedId: undefined,
  mode: "board",
  addStakeholder: (partial) =>
    set((s) => ({
      stakeholders: [
        ...s.stakeholders,
        {
          id: crypto.randomUUID(),
          label: partial.label || "New Stakeholder",
          category: (partial.category as Category) || "Operator",
          role: partial.role || "",
          needs: partial.needs || [],
          constraints: partial.constraints || [],
          interfaces: partial.interfaces || [],
          acceptance: partial.acceptance || "",
          persona: partial.persona || {},
          evidence: partial.evidence || [],
          priority: partial.priority || "M",
          source: partial.source || "",
          updatedAt: new Date().toISOString(),
        },
      ],
    })),
  moveStakeholder: (id, to) =>
    set((s) => ({
      stakeholders: s.stakeholders.map((sh) =>
        sh.id === id ? { ...sh, category: to, updatedAt: new Date().toISOString() } : sh
      ),
    })),
  updateStakeholder: (id, patch) =>
    set((s) => ({
      stakeholders: s.stakeholders.map((sh) =>
        sh.id === id ? { ...sh, ...patch, updatedAt: new Date().toISOString() } : sh
      ),
    })),
  deleteStakeholder: (id) =>
    set((s) => ({
      stakeholders: s.stakeholders.filter((sh) => sh.id !== id),
      selectedId: s.selectedId === id ? undefined : s.selectedId,
    })),
  setSelected: (id) => set(() => ({ selectedId: id })),
  setMode: (m) => set(() => ({ mode: m })),
}));

/**
 * ---------------------------------------------------------------------------
 * Utility: naive category guesser for quick-add
 * ---------------------------------------------------------------------------
 */

function guessCategory(input: string): Category {
  const t = input.toLowerCase();
  if (/(easa|faa|caa|authority|regulator)/.test(t)) return "Regulator";
  if (/(pilot|crew|operator|captain|ops)/.test(t)) return "Operator";
  if (/(maint|mro|line|mechanic|service)/.test(t)) return "Maintainer";
  if (/(manufact|production|fab|tool)/.test(t)) return "Manufacturing";
  if (/(supplier|vendor|partner|oem)/.test(t)) return "Supplier";
  if (/(logistic|support|spares)/.test(t)) return "Support";
  if (/(disposal|recycle|end-of-life|environment)/.test(t)) return "Disposal";
  if (/(customer|lessor|airline|owner)/.test(t)) return "Customer";
  if (/(pm|program|project|investor|management)/.test(t)) return "Program";
  if (/(public|community|noise|airport)/.test(t)) return "Public";
  return "Operator";
}

/**
 * ---------------------------------------------------------------------------
 * Quick Add Bar (Command style)
 * ---------------------------------------------------------------------------
 */

function QuickAddBar() {
  const add = useStore((s) => s.addStakeholder);
  const [value, setValue] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    add({ label: v, category: guessCategory(v) });
    setValue("");
  }

  // tiny suggestions (demo)
  const suggestions = [
    "A320 Captain",
    "Airport Noise Committee",
    "Airline Lessor",
    "Tooling Supplier",
    "CAA (UK)",
    "Fleet Ops Manager",
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, flex: 1 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Type a stakeholder name and press Enter…"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #d0d7de",
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #0b5fff",
            background: "#0b5fff",
            color: "white",
            fontWeight: 600,
          }}
        >
          Add
        </button>
      </form>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => {
              add({ label: s, category: guessCategory(s) });
            }}
            style={{
              border: "1px solid #d0d7de",
              borderRadius: 999,
              padding: "6px 10px",
              background: "white",
              fontSize: 12,
            }}
          >
            + {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * ---------------------------------------------------------------------------
 * DnD Lane + Sticker
 * ---------------------------------------------------------------------------
 */

function Lane({ category, children }: { category: Category; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: category });
  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 260,
        width: 260,
        background: isOver ? "#f1f6ff" : "#f8f9fb",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, color: "#334155" }}>{category}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function Sticker({ sh }: { sh: Stakeholder }) {
  const setSelected = useStore((s) => s.setSelected);
  const deleteStakeholder = useStore((s) => s.deleteStakeholder);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: sh.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.6 : 1,
    cursor: "grab",
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    boxShadow: "0 1px 0 rgba(16,24,40,0.04)",
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{sh.label}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <span
            title="Priority"
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
            }}
          >
            {sh.priority || "M"}
          </span>
          <button
            onClick={() => setSelected(sh.id)}
            style={{
              fontSize: 12,
              border: "1px solid #d0d7de",
              borderRadius: 6,
              padding: "2px 8px",
              background: "#f8fafc",
            }}
          >
            Edit
          </button>
          <button
            onClick={() => deleteStakeholder(sh.id)}
            style={{
              fontSize: 12,
              border: "1px solid #ffd6d6",
              borderRadius: 6,
              padding: "2px 8px",
              background: "#fff5f5",
              color: "#b42318",
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(sh.needs || []).slice(0, 2).map((n, i) => (
          <span
            key={i}
            style={{
              fontSize: 11,
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {n}
          </span>
        ))}
        {(sh.constraints || []).slice(0, 1).map((c, i) => (
          <span
            key={`c-${i}`}
            style={{
              fontSize: 11,
              background: "#fff7ed",
              border: "1px solid #ffedd5",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Right-side Sheet (Radix Dialog styled as sheet)
 * ---------------------------------------------------------------------------
 */

function StakeholderSheet() {
  const shId = useStore((s) => s.selectedId);
  const setSelected = useStore((s) => s.setSelected);
  const sh = useStore((s) => s.stakeholders.find((x) => x.id === s.selectedId));
  const update = useStore((s) => s.updateStakeholder);
  const open = Boolean(shId);

  function addToArray(field: "needs" | "constraints" | "interfaces" | "evidence" | "drivers" | "painPoints", value: string) {
    if (!sh || !value.trim()) return;
    if (field === "drivers" || field === "painPoints") {
      const persona = sh.persona || {};
      const arr = (persona[field as "drivers" | "painPoints"] || []) as string[];
      update(sh.id, { persona: { ...persona, [field]: Array.from(new Set([...arr, value.trim()])) } });
    } else if (field === "interfaces") {
      const arr = Array.from(new Set([...(sh.interfaces || []), value.trim() as any]));
      update(sh.id, { interfaces: arr });
    } else {
      const arr = Array.from(new Set([...(sh[field as "needs" | "constraints" | "evidence"] || []), value.trim()]));
      update(sh.id, { [field]: arr } as any);
    }
  }

  function removeFromArray(field: "needs" | "constraints" | "interfaces" | "evidence" | "drivers" | "painPoints", value: string) {
    if (!sh) return;
    if (field === "drivers" || field === "painPoints") {
      const persona = sh.persona || {};
      const arr = (persona[field as "drivers" | "painPoints"] || []).filter((x) => x !== value);
      update(sh.id, { persona: { ...persona, [field]: arr } });
    } else if (field === "interfaces") {
      const arr = (sh.interfaces || []).filter((x) => x !== (value as any));
      update(sh.id, { interfaces: arr });
    } else {
      const arr = (sh[field as "needs" | "constraints" | "evidence"] || []).filter((x) => x !== value);
      update(sh.id, { [field]: arr } as any);
    }
  }

  const needChips = ["Availability", "Low workload", "Turn time", "Reliability"];
  const constraintChips = ["Weight", "Cost", "Noise", "Schedule", "Safety"];
  const ifaceChips: ("physical" | "operational" | "information")[] = [
    "physical",
    "operational",
    "information",
  ];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && setSelected(undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.28)",
          }}
        />
        <Dialog.Content
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "520px",
            height: "100vh",
            background: "white",
            borderLeft: "1px solid #e5e7eb",
            padding: 20,
            overflowY: "auto",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.03), 0 10px 30px rgba(2,6,23,0.15)",
          }}
        >
          {sh && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Dialog.Title style={{ fontSize: 18, fontWeight: 700 }}>
                  {sh.label}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      padding: "6px 10px",
                      background: "#f8fafc",
                    }}
                  >
                    Close
                  </button>
                </Dialog.Close>
              </div>

              {/* Role */}
              <FieldLabel>Role</FieldLabel>
              <input
                value={sh.role || ""}
                onChange={(e) => useStore.getState().updateStakeholder(sh.id, { role: e.target.value })}
                placeholder="Short role summary…"
                style={inputStyle}
              />

              {/* Needs */}
              <FieldLabel>Needs (1–2 bullets)</FieldLabel>
              <ChipEditor
                values={sh.needs || []}
                suggestions={needChips}
                onAdd={(v) => addToArray("needs", v)}
                onRemove={(v) => removeFromArray("needs", v)}
              />

              {/* Constraints */}
              <FieldLabel>Constraints</FieldLabel>
              <ChipEditor
                values={sh.constraints || []}
                suggestions={constraintChips}
                onAdd={(v) => addToArray("constraints", v)}
                onRemove={(v) => removeFromArray("constraints", v)}
              />

              {/* Interfaces */}
              <FieldLabel>Interfaces</FieldLabel>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ifaceChips.map((c) => {
                  const active = (sh.interfaces || []).includes(c);
                  return (
                    <button
                      key={c}
                      onClick={() =>
                        active ? removeFromArray("interfaces", c) : addToArray("interfaces", c)
                      }
                      style={{
                        ...chipStyle,
                        background: active ? "#eef2ff" : "white",
                        borderColor: active ? "#c7d2fe" : "#e5e7eb",
                      }}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>

              {/* Acceptance */}
              <FieldLabel>Acceptance (1 line)</FieldLabel>
              <input
                value={sh.acceptance || ""}
                onChange={(e) => useStore.getState().updateStakeholder(sh.id, { acceptance: e.target.value })}
                placeholder='e.g., "Access < 5 min with standard tooling"'
                style={inputStyle}
              />

              {/* Persona snapshot */}
              <SectionLabel>Persona snapshot</SectionLabel>

              <FieldLabel>Name</FieldLabel>
              <input
                value={sh.persona?.name || ""}
                onChange={(e) =>
                  useStore
                    .getState()
                    .updateStakeholder(sh.id, { persona: { ...sh.persona, name: e.target.value } })
                }
                placeholder="e.g., Maria – Line Maintenance Lead"
                style={inputStyle}
              />

              <FieldLabel>Scenario</FieldLabel>
              <input
                value={sh.persona?.scenario || ""}
                onChange={(e) =>
                  useStore
                    .getState()
                    .updateStakeholder(sh.id, { persona: { ...sh.persona, scenario: e.target.value } })
                }
                placeholder="e.g., Overnight A-check in freezing rain"
                style={inputStyle}
              />

              <FieldLabel>Quote</FieldLabel>
              <input
                value={sh.persona?.quote || ""}
                onChange={(e) =>
                  useStore
                    .getState()
                    .updateStakeholder(sh.id, { persona: { ...sh.persona, quote: e.target.value } })
                }
                placeholder="Short mindset quote"
                style={inputStyle}
              />

              <FieldLabel>Drivers</FieldLabel>
              <ChipEditor
                values={sh.persona?.drivers || []}
                suggestions={["availability", "safety", "cost", "turn time"]}
                onAdd={(v) => addToArray("drivers", v)}
                onRemove={(v) => removeFromArray("drivers", v)}
              />

              <FieldLabel>Pain points</FieldLabel>
              <ChipEditor
                values={sh.persona?.painPoints || []}
                suggestions={["low light", "tooling", "ladder access", "cold weather"]}
                onAdd={(v) => addToArray("painPoints", v)}
                onRemove={(v) => removeFromArray("painPoints", v)}
              />

              {/* Evidence */}
              <SectionLabel>Evidence & Links</SectionLabel>
              <ChipEditor
                values={sh.evidence || []}
                suggestions={[]}
                placeholder="Paste a link and press Enter…"
                onAdd={(v) => addToArray("evidence", v)}
                onRemove={(v) => removeFromArray("evidence", v)}
              />

              <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                Saved • {new Date(sh.updatedAt).toLocaleString()}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{children}</div>;
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginTop: 8 }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 14,
};

const chipStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  padding: "6px 10px",
  background: "white",
  fontSize: 12,
};

function ChipEditor({
  values,
  suggestions,
  onAdd,
  onRemove,
  placeholder,
}: {
  values: string[];
  suggestions: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder?: string;
}) {
  const [val, setVal] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!val.trim()) return;
    onAdd(val.trim());
    setVal("");
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {values.map((v) => (
          <span key={v} style={{ ...chipStyle, background: "#f1f5f9", borderColor: "#e2e8f0" }}>
            {v}{" "}
            <button
              onClick={() => onRemove(v)}
              aria-label={`Remove ${v}`}
              style={{
                marginLeft: 6,
                border: "none",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {!!suggestions.length && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {suggestions.map((s) => (
            <button key={s} onClick={() => onAdd(s)} style={chipStyle}>
              + {s}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit}>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder || "Type and press Enter…"}
          style={inputStyle}
        />
      </form>
    </div>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Link Canvas (React Flow) — minimal, auto-build nodes from stakeholders
 * ---------------------------------------------------------------------------
 */

function LinkCanvas() {
  const stakeholders = useStore((s) => s.stakeholders);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // simple vertical layout-ish
    let y = 0;
    stakeholders.forEach((sh, idx) => {
      nodes.push({
        id: sh.id,
        position: { x: (idx % 3) * 300, y },
        data: { label: `${sh.label} (${sh.category})` },
        type: "default",
      });
      // connect to each "need" as a separate node
      (sh.needs || []).slice(0, 2).forEach((need, i) => {
        const nid = `${sh.id}-need-${i}`;
        nodes.push({
          id: nid,
          position: { x: (idx % 3) * 300 + 180, y: y + 70 + i * 60 },
          data: { label: `Need: ${need}` },
          type: "default",
        });
        edges.push({ id: `${sh.id}->${nid}`, source: sh.id, target: nid, animated: false });
      });
      y += 160;
    });

    return { nodes, edges };
  }, [stakeholders]);

  return (
    <div style={{ height: "60vh", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Main Page
 * ---------------------------------------------------------------------------
 */

export default function Page() {
  const stakeholders = useStore((s) => s.stakeholders);
  const move = useStore((s) => s.moveStakeholder);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(ev: DragEndEvent) {
    const id = ev.active?.id as string;
    const over = ev.over?.id as Category | undefined;
    if (id && over && CATEGORIES.includes(over)) {
      move(id, over);
    }
  }

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Stakeholders</h1>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            ARP4754A-aligned • capture → enrich → link
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setMode("board")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: mode === "board" ? "#eef2ff" : "white",
              fontWeight: 600,
            }}
          >
            Seed Board
          </button>
          <button
            onClick={() => setMode("link")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: mode === "link" ? "#eef2ff" : "white",
              fontWeight: 600,
            }}
          >
            Link View
          </button>
        </div>
      </header>

      <QuickAddBar />

      {mode === "board" ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
            {CATEGORIES.map((cat) => (
              <Lane key={cat} category={cat}>
                {stakeholders
                  .filter((s) => s.category === cat)
                  .map((s) => (
                    <Sticker key={s.id} sh={s} />
                  ))}
              </Lane>
            ))}
          </div>
        </DndContext>
      ) : (
        <LinkCanvas />
      )}

      <footer style={{ fontSize: 12, color: "#64748b" }}>
        Tip: type a stakeholder (e.g., “CAA (UK)”) and press Enter. Drag stickers between lanes. Click “Edit” to add needs, constraints, interfaces, acceptance, and a persona snapshot. Switch to “Link View” to see early relationships that feed requirements & FHA.
      </footer>

      <StakeholderSheet />
    </div>
  );
}
