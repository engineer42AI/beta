"use client";

import * as React from "react";
import {
  Background, Controls, Handle, MiniMap, Position,
  ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState, ConnectionMode, Edge, Node, Panel
} from "reactflow";
import "reactflow/dist/style.css";
import { Button } from "@/components/ui/button";



/* =========================================================
   Types (ARP4754B mapped)
========================================================= */

type StakeKind =
  | "Customer" | "Operator" | "Flight Crew" | "Cabin Crew" | "Maintenance"
  | "Air Traffic" | "Regulator" | "Manufacturer" | "Airport" | "Emergency"
  | "Passenger" | "Environmental" | "Program Mgmt" | "Other";

type InterfaceType = "Operational" | "Maintenance" | "Information";
type Concern = "Safety" | "Security" | "Environmental";

type Stakeholder = {
  id: string;
  name: string;            // “Capt. Maria Ortega”
  role: string;            // “Pilot-in-Command”
  kind: StakeKind;         // functional bucket per ARP
  relationship: "End-User" | "Regulator" | "Support" | "Supplier" | "Investor" | "Other";
  organization?: string;

  influence: 1|2|3|4|5;   // priority/influence for decisions
  priority: 1|2|3|4|5;

  needs: { id: string; text: string; perf?: string; traceIds?: string[] }[];
  constraints: { id: string; text: string; category: "Regulatory"|"Economic"|"Environmental"|"Physical"|"Other"; binding: boolean }[];
  concerns: Concern[];

  // filled via the Context Map edges
  interfaces: { id: string; to: "SystemB"; type: InterfaceType; note?: string }[];

  // validation / OSED linkage (lightweight)
  validation: {
    inOSED: boolean;
    reviews: { SRR?: boolean; PDR?: boolean; CDR?: boolean };
    evidence?: { label: string; url?: string }[];
  };

  createdAt: string; updatedAt: string;
};

/* =========================================================
   In-memory model + persistence
========================================================= */

const STORAGE_KEY = "e42.v3.stakeholders";

const ARCHETYPES: Array<Partial<Stakeholder> & {label: string}> = [
  { label: "Pilot-in-Command", name: "Capt. Maria Ortega", role: "Pilot-in-Command", kind: "Flight Crew", relationship: "End-User" },
  { label: "Dispatcher",       name: "Elena Petrescu",     role: "Dispatcher",       kind: "Operator",    relationship: "Support" },
  { label: "Line Maint",       name: "Ravi Shah",          role: "Line Maintenance", kind: "Maintenance", relationship: "Support" },
  { label: "EASA PCM",         name: "EASA PCM",           role: "Programme PCM",    kind: "Regulator",   relationship: "Regulator", organization: "EASA" },
  { label: "Cabin Crew",       name: "Cabin Crew Lead",    role: "Cabin Crew Lead",  kind: "Cabin Crew",  relationship: "End-User" },
  { label: "Operator Rep",     name: "Operator Rep",       role: "Fleet Performance",kind: "Program Mgmt",relationship: "Investor" },
];

const nowIso = () => new Date().toISOString();
const nid = () => Math.random().toString(36).slice(2,10);

function makeStake(seed: Partial<Stakeholder>): Stakeholder {
  return {
    id: nid(),
    name: seed.name ?? "",
    role: seed.role ?? "",
    kind: (seed.kind ?? "Other") as StakeKind,
    relationship: (seed.relationship ?? "Other") as Stakeholder["relationship"],
    organization: seed.organization ?? "",
    influence: (seed.influence as any) ?? 3,
    priority: (seed.priority as any) ?? 3,
    needs: seed.needs ?? [],
    constraints: seed.constraints ?? [],
    concerns: seed.concerns ?? [],
    interfaces: seed.interfaces ?? [],
    validation: seed.validation ?? { inOSED:false, reviews:{}, evidence:[] },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function toJSONL(rows: Stakeholder[]) {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

/* =========================================================
   React Flow: custom node for System + Stakeholder tokens
========================================================= */

function SystemNode() {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow px-4 py-3">
      <div className="text-sm font-semibold">System B</div>
      <div className="text-xs text-muted-foreground">Drag stakeholders near and connect to record an Interface.</div>
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Left} />
      <Handle type="source" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function StakeToken({ data }: { data: { label: string; kind: string } }) {
  return (
    <div className="rounded-full border bg-background shadow-sm px-3 py-1 text-xs flex items-center gap-2">
      <span className="font-medium">{data.label}</span>
      <span className="text-[10px] px-2 py-0.5 rounded-full border">{data.kind}</span>
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { system: SystemNode, stake: StakeToken };

/* =========================================================
   Page
========================================================= */

export default function StakeholdersV3Page() {
  const [items, setItems] = React.useState<Stakeholder[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // load/save
  React.useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setItems(JSON.parse(raw));
  }, []);
  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  /* ---------- Roster (left) ---------- */
  function addFromTemplate(t: (typeof ARCHETYPES)[number]) {
    const s = makeStake(t);
    setItems((p) => p.concat(s));
    setSelectedId(s.id);
  }

  /* ---------- Context Map (center) ---------- */
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([
      { id: "SYSTEM", type: "system", position: { x: 600, y: 260 }, data: {} },
  ]);

  type CtxEdgeData = {}; // or your edge data shape
  const [edges, setEdges, onEdgesChange] = useEdgesState<CtxEdgeData>([]);

  // add stake token to canvas when user clicks "Pin to map"
  function pinToMap(s: Stakeholder) {
    const exists = nodes.find((n) => n.id === s.id);
    if (exists) return setSelectedId(s.id);
    setNodes((nds) => nds.concat({
      id: s.id,
      type: "stake",
      position: { x: 240, y: 240 + Math.random() * 160 },
      data: { label: s.name || s.role || "Stakeholder", kind: s.kind },
    }));
    setSelectedId(s.id);
  }

  // When user connects SYSTEM ↔ stakeholder, create an Interface record
  function onConnect(params: any) {
    setEdges((eds) => addEdge({ ...params, animated: true, label: "Operational" }, eds));
    // record interface into stakeholder
    const stakeId = params.source === "SYSTEM" ? params.target : params.source;
    setItems((prev) =>
      prev.map((s) =>
        s.id === stakeId
          ? { ...s, interfaces: s.interfaces.concat({ id: nid(), to: "SystemB", type: "Operational" }) , updatedAt: nowIso() }
          : s
      )
    );
  }

  /* ---------- Inspector (right) ---------- */
  const sel = items.find((s) => s.id === selectedId) ?? null;
  function patch(upd: (p: Stakeholder) => Stakeholder) {
    if (!sel) return;
    setItems((prev) => prev.map((s) => (s.id === sel.id ? { ...upd(s), updatedAt: nowIso() } : s)));
  }

  /* ---------- Export ---------- */
  function exportJSONL() {
    const txt = toJSONL(items);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "application/jsonl" }));
    a.download = "stakeholders-v3.jsonl";
    a.click();
  }

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_1fr]">
      {/* Header */}
      <div className="h-11 px-3 border-b flex items-center gap-2">
        <div className="font-medium text-sm">B-1 Stakeholders — Team Builder & Context</div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={exportJSONL}>Export JSONL</Button>
          <Button size="sm" variant="secondary" onClick={() => { localStorage.removeItem(STORAGE_KEY); setItems([]); }}>Clear Local</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 min-h-0">
        {/* ROSTER */}
        <aside className="col-span-3 border-r p-3 overflow-auto space-y-3">
          <div className="text-xs font-semibold">Quick add</div>
          <div className="flex flex-wrap gap-2">
            {ARCHETYPES.map((t) => (
              <Button key={t.label} size="sm" variant="secondary" onClick={() => addFromTemplate(t)}>
                + {t.label}
              </Button>
            ))}
          </div>

          <div className="pt-3 border-t space-y-2">
            <div className="text-xs font-semibold">Roster</div>
            {items.map((s) => (
              <div key={s.id} className="rounded-lg border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{s.name || s.role || "Unnamed"}</div>
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border">{s.kind}</span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{s.relationship}{s.organization ? ` • ${s.organization}` : ""}</div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => { setSelectedId(s.id); }}>Inspect</Button>
                  <Button size="sm" variant="secondary" onClick={() => pinToMap(s)}>Pin to map</Button>
                </div>
              </div>
            ))}
            {!items.length && <div className="text-xs text-muted-foreground">Add a few stakeholders to begin.</div>}
          </div>
        </aside>

        {/* CONTEXT MAP */}
        <main className="col-span-6">
          <ReactFlowProvider>
            <div className="h-full">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                connectionMode={ConnectionMode.Loose}
                fitView
              >
                {/* <MiniMap /> */}
                <Controls />
                <Background gap={24} size={1} />
                <Panel position="top-center" className="rounded border bg-background px-3 py-1 text-xs">
                  Drag people near the system and connect edges to record <b>Interfaces</b>. Click a person to edit details.
                </Panel>
              </ReactFlow>
            </div>
          </ReactFlowProvider>
        </main>

        {/* INSPECTOR */}
        <aside className="col-span-3 border-l p-3">
          <div className="rounded-lg border p-3 h-full flex flex-col">
            <div className="text-sm font-semibold mb-2">Inspector</div>
            {!sel ? (
              <div className="text-sm text-muted-foreground">Select a stakeholder from the roster or map.</div>
            ) : (
              <div className="flex-1 overflow-auto space-y-3">
                {/* Summary */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="text-xs font-medium">Name</label>
                    <input className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                      value={sel.name} onChange={(e) => patch((p)=>({ ...p, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Role</label>
                    <input className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                      value={sel.role} onChange={(e) => patch((p)=>({ ...p, role: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Kind</label>
                    <select className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                      value={sel.kind} onChange={(e)=>patch((p)=>({ ...p, kind: e.target.value as any }))}>
                      {(["Customer","Operator","Flight Crew","Cabin Crew","Maintenance","Air Traffic","Regulator","Manufacturer","Airport","Emergency","Passenger","Environmental","Program Mgmt","Other"] as StakeKind[]).map(k => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Relationship</label>
                    <select className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                      value={sel.relationship} onChange={(e)=>patch((p)=>({ ...p, relationship: e.target.value as any }))}>
                      {(["End-User","Regulator","Support","Supplier","Investor","Other"] as const).map(k => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Organization</label>
                    <input className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                      value={sel.organization ?? ""} onChange={(e)=>patch((p)=>({ ...p, organization: e.target.value }))} />
                  </div>
                </div>

                {/* Needs */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold">Operational Needs</div>
                  {(sel.needs ?? []).map((n,i)=>(
                    <div key={n.id} className="flex gap-2">
                      <input className="flex-1 rounded border bg-transparent px-2 py-1 text-sm" value={n.text}
                        onChange={(e)=>patch((p)=>{ const a=[...p.needs]; a[i]={...a[i], text:e.target.value}; return {...p, needs:a}; })}/>
                      <Button size="sm" variant="secondary" onClick={()=>patch((p)=>({ ...p, needs: p.needs.filter(x=>x.id!==n.id) }))}>-</Button>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={()=>patch((p)=>({ ...p, needs: [...p.needs, { id:nid(), text:"" }] }))}>+ add need</Button>
                </div>

                {/* Constraints */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold">Constraints</div>
                  {(sel.constraints ?? []).map((c,i)=>(
                    <div key={c.id} className="grid grid-cols-5 gap-2">
                      <input className="col-span-3 rounded border bg-transparent px-2 py-1 text-sm" value={c.text}
                        onChange={(e)=>patch((p)=>{ const a=[...p.constraints]; a[i]={...a[i], text:e.target.value}; return {...p, constraints:a}; })}/>
                      <select className="col-span-1 rounded border bg-transparent px-2 py-1 text-sm" value={c.category}
                        onChange={(e)=>patch((p)=>{ const a=[...p.constraints]; a[i]={...a[i], category:e.target.value as any}; return {...p, constraints:a}; })}>
                        {["Regulatory","Economic","Environmental","Physical","Other"].map(x=> <option key={x}>{x}</option>)}
                      </select>
                      <label className="col-span-1 text-xs flex items-center gap-1">
                        <input type="checkbox" checked={c.binding} onChange={(e)=>patch((p)=>{ const a=[...p.constraints]; a[i]={...a[i], binding:e.target.checked}; return {...p, constraints:a}; })}/>
                        binding
                      </label>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={()=>patch((p)=>({ ...p, constraints: [...p.constraints, { id:nid(), text:"", category:"Regulatory", binding:false }] }))}>+ add constraint</Button>
                </div>

                {/* Interfaces (edges from map) */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold">Interfaces to System</div>
                  {(sel.interfaces ?? []).map((it)=>(
                    <div key={it.id} className="flex items-center gap-2 text-sm">
                      <span className="text-[10px] px-2 py-0.5 rounded-full border">{it.type}</span>
                      <input className="flex-1 rounded border bg-transparent px-2 py-1 text-sm" placeholder="note…" value={it.note ?? ""}
                        onChange={(e)=>patch((p)=>({ ...p, interfaces: p.interfaces.map(x=>x.id===it.id? {...x, note:e.target.value}: x) }))}/>
                    </div>
                  ))}
                  {!sel.interfaces.length && <div className="text-xs text-muted-foreground">Create by connecting on the map.</div>}
                </div>

                {/* Concerns + Validation */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs font-semibold">Concerns</div>
                    {(["Safety","Security","Environmental"] as Concern[]).map(k=>(
                      <label key={k} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={sel.concerns.includes(k)} onChange={(e)=>patch((p)=>({ ...p, concerns: e.target.checked ? [...p.concerns,k] : p.concerns.filter(x=>x!==k) }))}/>
                        {k}
                      </label>
                    ))}
                  </div>
                  <div>
                    <div className="text-xs font-semibold">Validation</div>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={sel.validation.inOSED} onChange={(e)=>patch((p)=>({ ...p, validation:{...p.validation, inOSED:e.target.checked} }))}/>
                      Included in OSED
                    </label>
                    <div className="text-[11px] mt-1">Reviews</div>
                    {(["SRR","PDR","CDR"] as const).map(r=>(
                      <label key={r} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={(sel.validation.reviews as any)[r] ?? false}
                          onChange={(e)=>patch((p)=>({ ...p, validation:{...p.validation, reviews:{...p.validation.reviews,[r]:e.target.checked}} }))}/>
                        {r}
                      </label>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
