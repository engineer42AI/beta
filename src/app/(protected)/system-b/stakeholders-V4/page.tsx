"use client";

import * as React from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  ConnectionMode,
  Edge,
  Node,
  Panel,
  NodeProps, // ✅ add this
  Connection,
} from "reactflow";
import "reactflow/dist/style.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { motion } from "framer-motion";
import { Users, Settings2, ShieldCheck, FileText, Map, Plus, Download, Trash2, CheckCircle, Sparkles, Building2, Sandwich } from "lucide-react";

/* =========================================================
   Types (ARP4754B mapped, title-first – no personal names)
========================================================= */


type StakeKind =
  | "Customer" | "Operator" | "Flight Crew" | "Cabin Crew" | "Maintenance"
  | "Air Traffic" | "Regulator" | "Manufacturer" | "Airport" | "Emergency"
  | "Passenger" | "Environmental" | "Program Mgmt" | "Other";

type Relationship = "End-User" | "Regulator" | "Support" | "Supplier" | "Investor" | "Other";

type InterfaceType = "Operational" | "Maintenance" | "Information" | "Organizational" | "Regulatory" | "Financial" | "Other";

type Concern = "Safety" | "Security" | "Environmental";

type SystemContext = "SystemA_Product" | "SystemB_Environment" | "SystemC_Enterprise";

type AcceptanceCriterion = { id: string; text: string; sourceRef?: string };

type Need = { id: string; text: string; perf?: string; traceIds?: string[] };

type Constraint = { id: string; text: string; category: "Regulatory"|"Economic"|"Environmental"|"Physical"|"Other"; binding: boolean };

type InterfaceLink = { id: string; to: SystemContext; type: InterfaceType; note?: string };

type ValidationInfo = {
  inOSED: boolean;
  reviews: { SRR?: boolean; PDR?: boolean; CDR?: boolean };
  evidence?: { label: string; url?: string }[];
};

type SystemNodeData = { label: string };
type StakeNodeData  = { label: string; kind: string };

type RFNodeData = SystemNodeData | StakeNodeData;
type RFNode = Node<RFNodeData, "system" | "stake">;
type RFEdge = Edge;

type Stakeholder = {
  id: string;
  title: string;           // e.g., "Pilot-in-Command"
  kind: StakeKind;         // functional bucket per ARP4754B
  relationship: Relationship;
  organization?: string;   // e.g., Airline X, EASA, Airport Y

  influence: 1|2|3|4|5;    // influence on decisions
  priority: 1|2|3|4|5;     // resolution priority in conflicts

  needs: Need[];
  constraints: Constraint[];
  concerns: Concern[];
  acceptance: AcceptanceCriterion[]; // how the stakeholder will judge success

  // recorded via the Context Map edges
  interfaces: InterfaceLink[];

  // validation / OSED linkage (lightweight)
  validation: ValidationInfo;

  // trace hints
  systemContext: SystemContext[]; // which systems this stakeholder influences

  createdAt: string; updatedAt: string;
};

/* =========================================================
   In-memory model + persistence
========================================================= */

const STORAGE_KEY = "e42.v4.stakeholders";

const nowIso = () => new Date().toISOString();
const nid = () => Math.random().toString(36).slice(2,10);

// Title-based archetypes (no personal names)
const ARCHETYPES: Array<Partial<Stakeholder> & {label: string}> = [
  { label: "Pilot-in-Command", title: "Pilot-in-Command", kind: "Flight Crew", relationship: "End-User" },
  { label: "Line Maintenance Lead", title: "Line Maintenance Lead", kind: "Maintenance", relationship: "Support" },
  { label: "Cabin Crew Lead", title: "Cabin Crew Lead", kind: "Cabin Crew", relationship: "End-User" },
  { label: "Dispatcher", title: "Dispatcher", kind: "Operator", relationship: "Support" },
  { label: "Certification Authority PCM", title: "Certification Authority PCM", kind: "Regulator", relationship: "Regulator", organization: "CAA / EASA / FAA" },
  { label: "Operator Program Manager", title: "Operator Program Manager", kind: "Program Mgmt", relationship: "Investor" },
  { label: "Airport Operations", title: "Airport Operations", kind: "Airport", relationship: "Support" },
  { label: "Air Traffic Services", title: "Air Traffic Services", kind: "Air Traffic", relationship: "Support" },
  { label: "Environmental Compliance", title: "Environmental Compliance", kind: "Environmental", relationship: "Other" },
  { label: "Supplier – Avionics", title: "Supplier – Avionics", kind: "Manufacturer", relationship: "Supplier" },
];

function makeStake(seed: Partial<Stakeholder>): Stakeholder {
  return {
    id: nid(),
    title: seed.title ?? "",
    kind: (seed.kind ?? "Other") as StakeKind,
    relationship: (seed.relationship ?? "Other") as Relationship,
    organization: seed.organization ?? "",
    influence: (seed.influence as any) ?? 3,
    priority: (seed.priority as any) ?? 3,
    needs: seed.needs ?? [],
    constraints: seed.constraints ?? [],
    concerns: seed.concerns ?? [],
    acceptance: seed.acceptance ?? [],
    interfaces: seed.interfaces ?? [],
    validation: seed.validation ?? { inOSED:false, reviews:{}, evidence:[] },
    systemContext: seed.systemContext ?? ["SystemA_Product","SystemB_Environment","SystemC_Enterprise"],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function toJSONL(rows: Stakeholder[]) {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

/* =========================================================
   React Flow: custom nodes
========================================================= */

function SystemNode({ data }: NodeProps<SystemNodeData>) {
  return (
    <div className="rounded-2xl border bg-card text-card-foreground shadow px-4 py-3 min-w-[160px]">
      <div className="text-sm font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4"/> {data.label}</div>
      <div className="text-[11px] text-muted-foreground">Connect crew to record Interfaces.</div>
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Left} />
      <Handle type="source" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function StakeToken({ data }: NodeProps<StakeNodeData>) {
  return (
    <motion.div layout whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}
      className="rounded-full border bg-background shadow-sm px-3 py-1 text-xs flex items-center gap-2">
      <Users className="h-3.5 w-3.5"/>
      <span className="font-medium">{data.label}</span>
      <span className="text-[10px] px-2 py-0.5 rounded-full border bg-muted/40">{data.kind}</span>
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Right} />
    </motion.div>
  );
}

const nodeTypes = { system: SystemNode, stake: StakeToken };

/* =========================================================
   Helpers
========================================================= */

function CoveredPill({ items }: { items: Stakeholder[] }) {
  const kinds = new Set(items.map(i=>i.kind));
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="text-xs flex items-center gap-2 border rounded-full px-2 py-1">
            <CheckCircle className="h-3.5 w-3.5"/>
            <span className="font-medium">Coverage</span>
            <Badge variant="secondary" className="rounded-full">{kinds.size} kinds</Badge>
            <Badge variant="outline" className="rounded-full">{items.length} titles</Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="max-w-[220px] text-xs">
            Number of stakeholder kinds and titles captured.
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* =========================================================
   Page
========================================================= */

export default function StakeholdersCrewBuilderPage() {
  const [items, setItems] = React.useState<Stakeholder[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [showPersonas, setShowPersonas] = React.useState(false); // optional UX toggle (titles-first)

  // load/save
  React.useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setItems(JSON.parse(raw));
  }, []);
  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  /* ---------- Actions ---------- */
  function addFromTemplate(t: (typeof ARCHETYPES)[number]) {
    const s = makeStake(t);
    setItems((p) => p.concat(s));
    setSelectedId(s.id);
  }
  function removeStake(id: string) {
    setItems((p) => p.filter(x => x.id !== id));
    setSelectedId((cur)=> (cur===id? null : cur));
  }

  /* ---------- Flow Map ---------- */
  const initialNodes: RFNode[] = [
      { id: "SYS-A", type: "system", position: { x: 160, y: 180 }, data: { label: "System A – Product" } },
      { id: "SYS-B", type: "system", position: { x: 520, y: 100 }, data: { label: "System B – Environment" } },
      { id: "SYS-C", type: "system", position: { x: 520, y: 300 }, data: { label: "System C – Enterprise" } },
  ];

  function pinToMap(s: Stakeholder) {
    const exists = nodes.find((n) => n.id === s.id);
    if (exists) return setSelectedId(s.id);
    setNodes((nds) =>
      nds.concat({
        id: s.id,
        type: "stake",
        position: { x: 820, y: 140 + Math.random() * 220 },
        data: { label: s.title || "Stakeholder", kind: s.kind },
      })
    );
    setSelectedId(s.id);
  }

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNodeData>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);

  function onConnect(params: Connection) {
    if (!params.source || !params.target) return;
    setEdges((eds) => addEdge({ ...params, animated: true, label: "Interface" }, eds));
    // record interface into stakeholder
    const stakeId = ["SYS-A","SYS-B","SYS-C"].includes(params.source) ? params.target : params.source;
    const sys = (params.source === "SYS-A" || params.target === "SYS-A") ? "SystemA_Product" :
                (params.source === "SYS-B" || params.target === "SYS-B") ? "SystemB_Environment" :
                "SystemC_Enterprise";
    setItems((prev) => prev.map((s) => s.id === stakeId
      ? { ...s, interfaces: s.interfaces.concat({ id: nid(), to: sys, type: "Operational" }), updatedAt: nowIso() }
      : s));
  }

  const sel = items.find((s) => s.id === selectedId) ?? null;
  function patch(upd: (p: Stakeholder) => Stakeholder) {
    if (!sel) return;
    setItems((prev) => prev.map((s) => (s.id === sel.id ? { ...upd(s), updatedAt: nowIso() } : s)));
  }

  function exportJSONL() {
    const txt = toJSONL(items);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "application/jsonl" }));
    a.download = "stakeholders-crew.jsonl";
    a.click();
  }

  const filtered = items.filter((s) =>
    [s.title, s.kind, s.organization || ""].join("\n").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_1fr]">
      {/* Header */}
      <div className="h-12 px-4 border-b flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4"/>
          <span>Stakeholders — Crew Builder (ARP4754B)</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <CoveredPill items={items} />
          <Button size="sm" variant="secondary" onClick={exportJSONL}><Download className="h-4 w-4 mr-1"/>Export</Button>
          <Button size="sm" variant="secondary" onClick={() => { localStorage.removeItem(STORAGE_KEY); setItems([]); }}><Trash2 className="h-4 w-4 mr-1"/>Clear</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 min-h-0">
        {/* ROSTER */}
        <aside className="col-span-3 border-r p-3 overflow-auto space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold">Add by Title</div>
            <div className="flex items-center gap-2 text-xs">
              <span>Personas</span>
              <Switch checked={showPersonas} onCheckedChange={setShowPersonas} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {ARCHETYPES.map((t) => (
              <Button key={t.label} size="sm" variant="secondary" onClick={() => addFromTemplate(t)}>
                <Plus className="h-3.5 w-3.5 mr-1"/> {t.label}
              </Button>
            ))}
          </div>

          <div className="pt-3 border-t space-y-2">
            <div className="text-xs font-semibold flex items-center gap-2">
              <span>Roster</span>
              <Input placeholder="Search titles, kinds, org…" value={query} onChange={(e)=>setQuery(e.target.value)} className="h-7 text-xs"/>
            </div>
            {filtered.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge variant="secondary" className="rounded-full">{s.kind}</Badge>
                    <span className="truncate">{s.title || "Untitled"}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5"/>{s.organization || "—"}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => { setSelectedId(s.id); }}>Inspect</Button>
                    <Button size="sm" variant="secondary" onClick={() => pinToMap(s)}><Map className="h-3.5 w-3.5 mr-1"/>Pin</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeStake(s.id)}><Trash2 className="h-3.5 w-3.5"/></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!filtered.length && <div className="text-xs text-muted-foreground">Add a few stakeholders to begin.</div>}
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
                <Controls />
                <Background gap={24} size={1} />
                <Panel position="top-center" className="rounded border bg-background px-3 py-1 text-xs">
                  Drag titles near the systems and connect edges to record <b>Interfaces</b> (Operational / Info / Maint / …).
                </Panel>
              </ReactFlow>
            </div>
          </ReactFlowProvider>
        </main>

        {/* INSPECTOR */}
        <aside className="col-span-3 border-l p-3">
          <div className="rounded-2xl border p-3 h-full flex flex-col">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4"/>Inspector</div>
            {!sel ? (
              <div className="text-sm text-muted-foreground">Select a title from the roster or map.</div>
            ) : (
              <div className="flex-1 overflow-auto space-y-3">
                {/* Summary */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="text-xs font-medium">Title</label>
                    <Input value={sel.title} onChange={(e) => patch((p)=>({ ...p, title: e.target.value }))} className="h-8 text-sm"/>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Kind</label>
                    <select className="w-full rounded border bg-transparent px-2 py-1.5 text-sm"
                      value={sel.kind} onChange={(e)=>patch((p)=>({ ...p, kind: e.target.value as any }))}>
                      {(["Customer","Operator","Flight Crew","Cabin Crew","Maintenance","Air Traffic","Regulator","Manufacturer","Airport","Emergency","Passenger","Environmental","Program Mgmt","Other"] as StakeKind[]).map(k => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Relationship</label>
                    <select className="w-full rounded border bg-transparent px-2 py-1.5 text-sm"
                      value={sel.relationship} onChange={(e)=>patch((p)=>({ ...p, relationship: e.target.value as any }))}>
                      {(["End-User","Regulator","Support","Supplier","Investor","Other"] as Relationship[]).map(k => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Organization</label>
                    <Input value={sel.organization ?? ""} onChange={(e)=>patch((p)=>({ ...p, organization: e.target.value }))} className="h-8 text-sm"/>
                  </div>
                  <div className="grid grid-cols-2 gap-4 items-center">
                    <div>
                      <label className="text-xs font-medium">Influence</label>
                      <Slider value={[sel.influence]} min={1} max={5} step={1} onValueChange={(v)=>patch((p)=>({ ...p, influence: v[0] as 1|2|3|4|5 }))}/>
                    </div>
                    <div>
                      <label className="text-xs font-medium">Priority</label>
                      <Slider value={[sel.priority]} min={1} max={5} step={1} onValueChange={(v)=>patch((p)=>({ ...p, priority: v[0] as 1|2|3|4|5 }))}/>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Needs & Acceptance */}
                <Tabs defaultValue="needs">
                  <TabsList className="grid grid-cols-3">
                    <TabsTrigger value="needs">Needs</TabsTrigger>
                    <TabsTrigger value="constraints">Constraints</TabsTrigger>
                    <TabsTrigger value="acceptance">Acceptance</TabsTrigger>
                  </TabsList>

                  <TabsContent value="needs" className="space-y-2">
                    {(sel.needs ?? []).map((n,i)=> (
                      <div key={n.id} className="flex gap-2">
                        <Input className="flex-1 h-8 text-sm" value={n.text}
                          placeholder="Need (what they expect from the system)"
                          onChange={(e)=>patch((p)=>{ const a=[...p.needs]; a[i]={...a[i], text:e.target.value}; return {...p, needs:a}; })}/>
                        <Button size="sm" variant="secondary" onClick={()=>patch((p)=>({ ...p, needs: p.needs.filter(x=>x.id!==n.id) }))}>-</Button>
                      </div>
                    ))}
                    <Button size="sm" variant="secondary" onClick={()=>patch((p)=>({ ...p, needs: [...p.needs, { id:nid(), text:"" }] }))}>+ add need</Button>
                  </TabsContent>

                  <TabsContent value="constraints" className="space-y-2">
                    {(sel.constraints ?? []).map((c,i)=> (
                      <div key={c.id} className="grid grid-cols-5 gap-2 items-center">
                        <Input className="col-span-3 h-8 text-sm" value={c.text}
                          placeholder="Constraint (regulatory, environmental, economic, physical…)"
                          onChange={(e)=>patch((p)=>{ const a=[...p.constraints]; a[i]={...a[i], text:e.target.value}; return {...p, constraints:a}; })}/>
                        <select className="col-span-1 rounded border bg-transparent px-2 py-1.5 text-sm" value={c.category}
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
                  </TabsContent>

                  <TabsContent value="acceptance" className="space-y-2">
                    {(sel.acceptance ?? []).map((a,i)=> (
                      <div key={a.id} className="flex gap-2">
                        <Input className="flex-1 h-8 text-sm" value={a.text}
                          placeholder="Acceptance criterion (how this stakeholder will judge success)"
                          onChange={(e)=>patch((p)=>{ const arr=[...p.acceptance]; arr[i]={...arr[i], text:e.target.value}; return {...p, acceptance:arr}; })}/>
                        <Input className="w-40 h-8 text-xs" value={a.sourceRef ?? ""} placeholder="source ref (opt)"
                          onChange={(e)=>patch((p)=>{ const arr=[...p.acceptance]; arr[i]={...arr[i], sourceRef:e.target.value}; return {...p, acceptance:arr}; })}/>
                        <Button size="sm" variant="secondary" onClick={()=>patch((p)=>({ ...p, acceptance: p.acceptance.filter(x=>x.id!==a.id) }))}>-</Button>
                      </div>
                    ))}
                    <Button size="sm" variant="secondary" onClick={()=>patch((p)=>({ ...p, acceptance: [...p.acceptance, { id:nid(), text:"" }] }))}>+ add criterion</Button>
                  </TabsContent>
                </Tabs>

                {/* Interfaces (edges from map) */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold">Interfaces (map-generated)</div>
                  {(sel.interfaces ?? []).map((it)=> (
                    <div key={it.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="rounded-full">{it.to.replace("System","System ")}</Badge>
                      <select className="rounded border bg-transparent px-2 py-1 text-xs" value={it.type}
                        onChange={(e)=>patch((p)=>({ ...p, interfaces: p.interfaces.map(x=>x.id===it.id? {...x, type: e.target.value as InterfaceType}: x) }))}>
                        {["Operational","Maintenance","Information","Organizational","Regulatory","Financial","Other"].map(x=> <option key={x}>{x}</option>)}
                      </select>
                      <Input className="flex-1 h-8 text-sm" placeholder="note…" value={it.note ?? ""}
                        onChange={(e)=>patch((p)=>({ ...p, interfaces: p.interfaces.map(x=>x.id===it.id? {...x, note:e.target.value}: x) }))}/>
                    </div>
                  ))}
                  {!sel.interfaces.length && <div className="text-xs text-muted-foreground">Create by connecting on the map.</div>}
                </div>

                {/* Concerns + Validation */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs font-semibold">Concerns</div>
                    {(["Safety","Security","Environmental"] as Concern[]).map(k=> (
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
                    {(["SRR","PDR","CDR"] as const).map(r=> (
                      <label key={r} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={(sel.validation.reviews as any)[r] ?? false}
                          onChange={(e)=>patch((p)=>({ ...p, validation:{...p.validation, reviews:{...p.validation.reviews,[r]:e.target.checked}} }))}/>
                        {r}
                      </label>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* System Context tags */}
                <div>
                  <div className="text-xs font-semibold">System Context</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(["SystemA_Product","SystemB_Environment","SystemC_Enterprise"] as SystemContext[]).map(ctx=> (
                      <Badge key={ctx} variant={sel.systemContext.includes(ctx)? "default":"outline"} className="cursor-pointer rounded-full"
                        onClick={()=>patch((p)=> ({...p, systemContext: p.systemContext.includes(ctx)? p.systemContext.filter(x=>x!==ctx) : [...p.systemContext, ctx] }))}>
                        {ctx.replace("System","System ")}
                      </Badge>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Footer helper – ARP4754B capture checklist */}
      <div className="border-t px-4 py-2 text-[11px] text-muted-foreground flex items-center gap-4">
        <FileText className="h-3.5 w-3.5"/>
        <span className="hidden md:inline">Capture for each title: role/kind, relationship, organization; needs; constraints; interfaces; acceptance; concerns; validation/OSED; system context.</span>
        <span className="ml-auto">Tip: Think of this as building your crew for validation and safety assessment.</span>
      </div>
    </div>
  );
}
