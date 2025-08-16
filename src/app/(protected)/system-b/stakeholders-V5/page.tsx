"use client";

import React, { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Download, Upload, Plus, Save, Users, Target, Workflow, ClipboardCheck, Lightbulb, Trash2, ChevronRight, Info, Settings2, Map, FileText, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

// -----------------------------
// Types & Constants
// -----------------------------

type InfluenceLevel = 1 | 2 | 3 | 4 | 5;

type StakeholderCategory =
  | "Customer/Purchaser"
  | "Operator (Flight/Cabin)"
  | "Maintenance/MRO"
  | "Manufacturing/Production"
  | "Supplier/Partner"
  | "Regulatory/Authority"
  | "Safety/Compliance"
  | "Support/Logistics"
  | "Airport/ATC/Community"
  | "Program/PM/Finance"
  | "Environment/Sustainability"
  | "Disposal/Recycling";

interface Persona {
  id: string;
  name: string; // e.g., "Maria – Line Maintenance Lead"
  goals: string[];
  painPoints: string[];
  scenarios: string[]; // typical ops scenarios
  environment: string; // operating context
  decisionDrivers: string[];
  trainingLevel?: string;
  quote?: string;
}

interface NeedConstraint {
  id: string;
  type: "Need" | "Constraint" | "Acceptance Criterion";
  text: string;
  source?: string; // doc, meeting, reg ref
}

interface InterfaceDesc {
  id: string;
  kind: "Physical" | "Functional" | "Information" | "Human-Computer" | "Process";
  description: string;
}

interface Stakeholder {
  id: string;
  name: string;
  category: StakeholderCategory;
  role: string; // why they matter
  influence: InfluenceLevel; // how strong their sway is
  interest: InfluenceLevel; // how much they care
  contact?: string;
  notes?: string;
  personas: Persona[];
  items: NeedConstraint[]; // needs/constraints/acceptance criteria
  interfaces: InterfaceDesc[];
  priority?: "Low" | "Medium" | "High";
  validationOwner?: string; // who signs validation
  includeInFHA: boolean; // hint for HF & ops hazards
}

// -----------------------------
// Helpers
// -----------------------------

const uid = () => Math.random().toString(36).slice(2, 10);

const CATEGORIES: StakeholderCategory[] = [
  "Customer/Purchaser",
  "Operator (Flight/Cabin)",
  "Maintenance/MRO",
  "Manufacturing/Production",
  "Supplier/Partner",
  "Regulatory/Authority",
  "Safety/Compliance",
  "Support/Logistics",
  "Airport/ATC/Community",
  "Program/PM/Finance",
  "Environment/Sustainability",
  "Disposal/Recycling",
];

const ARP4754B_CHECKPOINTS = [
  {
    id: "scope",
    title: "Scope & Context captured",
    hint:
      "System purpose, operational context, and boundaries identified so stakeholder needs can be derived coherently.",
  },
  {
    id: "comprehensive",
    title: "Comprehensive stakeholder set",
    hint:
      "Includes operators, maintainers, manufacturing, suppliers, regulators, enterprise, environment, and community.",
  },
  {
    id: "needs",
    title: "Needs/Constraints/Acceptance criteria",
    hint: "Explicitly captured and linkable to requirements and validation.",
  },
  {
    id: "interfaces",
    title: "Interfaces identified",
    hint: "Physical, functional, information, HCI, and process interfaces captured for each relevant stakeholder.",
  },
  {
    id: "priority",
    title: "Priority & Influence resolved",
    hint: "Interest vs influence assessed to drive trade-off and escalation paths.",
  },
  {
    id: "validation",
    title: "Validation ownership",
    hint: "Named representatives who will judge fitness of needs at validation milestones.",
  },
];

// -----------------------------
// Small UI Primitives
// -----------------------------

function FieldLabel({ children, tooltip }: { children: React.ReactNode; tooltip?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-sm font-medium">{children}</Label>
      {tooltip && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-2xl bg-muted px-2.5 py-1 text-xs">{children}</span>;
}

// -----------------------------
// Influence/Interest Matrix
// -----------------------------

function InfluenceInterestMatrix({
  stakeholders,
  onSet,
}: {
  stakeholders: Stakeholder[];
  onSet: (id: string, influence: number, interest: number) => void;
}) {
  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Map className="h-4 w-4"/> Influence × Interest</CardTitle>
        <CardDescription>Use this to prioritize engagement strategies.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-6 gap-2 items-center">
          <div />
          {[1,2,3,4,5].map((i)=> (
            <div key={i} className="text-center text-xs text-muted-foreground">{i}</div>
          ))}
          {stakeholders.map((s)=> (
            <React.Fragment key={s.id}>
              <div className="text-xs font-medium truncate" title={s.name}>{s.name}</div>
              {[1,2,3,4,5].map((i)=> (
                <button
                  key={i}
                  className={`h-8 rounded-md border ${s.influence===i?"bg-primary text-primary-foreground":"bg-background"}`}
                  onClick={()=> onSet(s.id, i, s.interest)}
                  title={`Influence ${i}`}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
        <Separator className="my-3" />
        <div className="grid grid-cols-6 gap-2 items-center">
          <div />
          {[1,2,3,4,5].map((i)=> (
            <div key={i} className="text-center text-xs text-muted-foreground">{i}</div>
          ))}
          {stakeholders.map((s)=> (
            <React.Fragment key={s.id+"i"}>
              <div className="text-xs font-medium truncate" title={s.name}>{s.name}</div>
              {[1,2,3,4,5].map((i)=> (
                <button
                  key={i}
                  className={`h-8 rounded-md border ${s.interest===i?"bg-primary text-primary-foreground":"bg-background"}`}
                  onClick={()=> onSet(s.id, s.influence, i)}
                  title={`Interest ${i}`}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------
// Stakeholder Card
// -----------------------------

function StakeholderCard({
  s,
  onUpdate,
  onDelete,
}: {
  s: Stakeholder;
  onUpdate: (s: Stakeholder) => void;
  onDelete: (id: string) => void;
}) {
  const [local, setLocal] = useState<Stakeholder>(s);
  useEffect(()=> setLocal(s), [s]);

  const completeness = useMemo(()=>{
    const needs = local.items.some(i=>i.type==="Need");
    const acc = local.items.some(i=>i.type==="Acceptance Criterion");
    const intr = local.interfaces.length>0;
    const persona = local.personas.length>0;
    return [needs, acc, intr, persona].filter(Boolean).length/4;
  },[local]);

  return (
    <Card className="group overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              <Input
                value={local.name}
                onChange={(e)=> setLocal({...local, name: e.target.value})}
                className="h-8 w-[18rem]"
              />
              <Badge variant="secondary" className="ml-2">{local.category}</Badge>
            </CardTitle>
            <CardDescription className="mt-1 flex flex-wrap gap-2 items-center">
              <FieldLabel tooltip="Why this stakeholder matters for the system.">Role</FieldLabel>
              <Input value={local.role} onChange={(e)=> setLocal({...local, role: e.target.value})} className="h-8" />
              <FieldLabel tooltip="Who will sign validation of needs for this stakeholder.">Validation Owner</FieldLabel>
              <Input placeholder="Name / Org" value={local.validationOwner||""} onChange={(e)=> setLocal({...local, validationOwner: e.target.value})} className="h-8 w-[14rem]" />
              <FieldLabel tooltip="Include human-factors/ops hazards from this persona in FHA.">FHA</FieldLabel>
              <Switch checked={local.includeInFHA} onCheckedChange={(v)=> setLocal({...local, includeInFHA: v})} />
              <Pill>Influence {local.influence}/5</Pill>
              <Pill>Interest {local.interest}/5</Pill>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <Button variant="destructive" size="icon" onClick={()=> onDelete(local.id)}><Trash2 className="h-4 w-4"/></Button>
            <Button size="icon" onClick={()=> onUpdate(local)} title="Save"><Save className="h-4 w-4"/></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Needs / Constraints / Acceptance */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4"/>
            <h4 className="font-semibold">Needs & Criteria</h4>
            <Badge variant="outline">{local.items.length}</Badge>
          </div>
          <div className="space-y-2">
            {local.items.map((it, idx)=> (
              <div key={it.id} className="rounded-xl border p-2">
                <div className="flex items-center gap-2">
                  <select
                    className="border rounded-md px-2 py-1 text-xs"
                    value={it.type}
                    onChange={(e)=>{
                      const next = [...local.items];
                      next[idx] = { ...it, type: e.target.value as NeedConstraint["type"] };
                      setLocal({...local, items: next});
                    }}
                  >
                    <option>Need</option>
                    <option>Constraint</option>
                    <option>Acceptance Criterion</option>
                  </select>
                  <Input
                    value={it.text}
                    onChange={(e)=>{
                      const next = [...local.items];
                      next[idx] = { ...it, text: e.target.value };
                      setLocal({...local, items: next});
                    }}
                    placeholder="e.g., Line-replaceable within 15 minutes"
                  />
                  <Input
                    className="w-40"
                    placeholder="Source/Ref"
                    value={it.source||""}
                    onChange={(e)=>{
                      const next = [...local.items];
                      next[idx] = { ...it, source: e.target.value };
                      setLocal({...local, items: next});
                    }}
                  />
                  <Button variant="ghost" size="icon" onClick={()=> {
                    const next = local.items.filter(x=> x.id!==it.id);
                    setLocal({...local, items: next});
                  }}><Trash2 className="h-4 w-4"/></Button>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={()=> setLocal({...local, items: [...local.items, { id: uid(), type: "Need", text: "", source: ""}]})}>
              <Plus className="h-4 w-4 mr-1"/> Add item
            </Button>
          </div>
        </div>
        {/* Interfaces */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Workflow className="h-4 w-4"/>
            <h4 className="font-semibold">Interfaces</h4>
            <Badge variant="outline">{local.interfaces.length}</Badge>
          </div>
          <div className="space-y-2">
            {local.interfaces.map((it, idx)=> (
              <div key={it.id} className="rounded-xl border p-2">
                <div className="flex items-center gap-2">
                  <select
                    className="border rounded-md px-2 py-1 text-xs"
                    value={it.kind}
                    onChange={(e)=>{
                      const next = [...local.interfaces];
                      next[idx] = { ...it, kind: e.target.value as InterfaceDesc["kind"] };
                      setLocal({...local, interfaces: next});
                    }}
                  >
                    <option>Physical</option>
                    <option>Functional</option>
                    <option>Information</option>
                    <option>Human-Computer</option>
                    <option>Process</option>
                  </select>
                  <Input
                    value={it.description}
                    onChange={(e)=>{
                      const next = [...local.interfaces];
                      next[idx] = { ...it, description: e.target.value };
                      setLocal({...local, interfaces: next});
                    }}
                    placeholder="e.g., Access panel for LRU removal"
                  />
                  <Button variant="ghost" size="icon" onClick={()=> {
                    const next = local.interfaces.filter(x=> x.id!==it.id);
                    setLocal({...local, interfaces: next});
                  }}><Trash2 className="h-4 w-4"/></Button>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={()=> setLocal({...local, interfaces: [...local.interfaces, { id: uid(), kind: "Physical", description: ""}]})}>
              <Plus className="h-4 w-4 mr-1"/> Add interface
            </Button>
          </div>
        </div>
        {/* Personas */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4"/>
            <h4 className="font-semibold">Persona(s)</h4>
            <Badge variant="outline">{local.personas.length}</Badge>
          </div>
          <div className="space-y-3">
            {local.personas.map((p, idx)=> (
              <div key={p.id} className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={p.name} onChange={(e)=>{
                    const next = [...local.personas];
                    next[idx] = {...p, name: e.target.value};
                    setLocal({...local, personas: next});
                  }} placeholder="Name – Role"/>
                  <Button variant="ghost" size="icon" onClick={()=> {
                    const next = local.personas.filter(x=> x.id!==p.id);
                    setLocal({...local, personas: next});
                  }}><Trash2 className="h-4 w-4"/></Button>
                </div>
                <Textarea
                  placeholder="Goals (comma-separated)"
                  value={p.goals.join(", ")}
                  onChange={(e)=>{
                    const next = [...local.personas];
                    next[idx] = { ...p, goals: e.target.value.split(",").map(t=>t.trim()).filter(Boolean)};
                    setLocal({...local, personas: next});
                  }}
                />
                <Textarea
                  placeholder="Pain points (comma-separated)"
                  value={p.painPoints.join(", ")}
                  onChange={(e)=>{
                    const next = [...local.personas];
                    next[idx] = { ...p, painPoints: e.target.value.split(",").map(t=>t.trim()).filter(Boolean)};
                    setLocal({...local, personas: next});
                  }}
                />
                <Textarea
                  placeholder="Typical scenarios (comma-separated)"
                  value={p.scenarios.join(", ")}
                  onChange={(e)=>{
                    const next = [...local.personas];
                    next[idx] = { ...p, scenarios: e.target.value.split(",").map(t=>t.trim()).filter(Boolean)};
                    setLocal({...local, personas: next});
                  }}
                />
                <Input placeholder="Operating environment"
                  value={p.environment}
                  onChange={(e)=>{
                    const next = [...local.personas];
                    next[idx] = { ...p, environment: e.target.value };
                    setLocal({...local, personas: next});
                  }}
                />
                <Textarea
                  placeholder="Decision drivers (comma-separated)"
                  value={p.decisionDrivers.join(", ")}
                  onChange={(e)=>{
                    const next = [...local.personas];
                    next[idx] = { ...p, decisionDrivers: e.target.value.split(",").map(t=>t.trim()).filter(Boolean)};
                    setLocal({...local, personas: next});
                  }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Training level" value={p.trainingLevel||""} onChange={(e)=>{
                    const next = [...local.personas];
                    next[idx] = { ...p, trainingLevel: e.target.value };
                    setLocal({...local, personas: next});
                  }}/>
                  <Input placeholder="Quote / mindset" value={p.quote||""} onChange={(e)=>{
                    const next = [...local.personas];
                    next[idx] = { ...p, quote: e.target.value };
                    setLocal({...local, personas: next});
                  }}/>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={()=> setLocal({...local, personas: [...local.personas, { id: uid(), name: "", goals: [], painPoints: [], scenarios: [], environment: "", decisionDrivers: []}]})}>
                <Plus className="h-4 w-4 mr-1"/> Add persona
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm"><Sparkles className="h-4 w-4 mr-1"/> Quick persona seed</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Persona seeds (examples)</DialogTitle>
                    <DialogDescription>Insert a ready-made skeleton and tailor it.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-2">
                    {[
                      {
                        name: "Maria – Line Maintenance Lead",
                        goals: ["Maximize availability", "Meet A-check SLA"],
                        pain: ["Limited ramp time", "Cold weather access"],
                        scen: ["Night-time LRU swap", "Avionics fault isolate"],
                        env: "Open ramp, low light, high noise",
                        drivers: ["Safety", "Turnaround time"],
                      },
                      {
                        name: "Jon – Captain",
                        goals: ["Safe, stable handling", "Low workload"],
                        pain: ["Alert fatigue", "Ambiguous modes"],
                        scen: ["Rejected takeoff", "IMC approach"],
                        env: "Flight deck, high workload phases",
                        drivers: ["Safety", "Procedural clarity"],
                      },
                    ].map((seed)=> (
                      <Button key={seed.name} variant="secondary" onClick={()=>{
                        setLocal({
                          ...local,
                          personas: [
                            ...local.personas,
                            {
                              id: uid(),
                              name: seed.name,
                              goals: seed.goals,
                              painPoints: seed.pain,
                              scenarios: seed.scen,
                              environment: seed.env,
                              decisionDrivers: seed.drivers,
                            },
                          ],
                        });
                      }}>{seed.name}</Button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <div className="text-xs text-muted-foreground">Completeness: {Math.round(completeness*100)}%</div>
        <div className="flex items-center gap-2">
          <select className="border rounded-md px-2 py-1 text-xs" value={local.priority||"Medium"} onChange={(e)=> setLocal({...local, priority: e.target.value as Stakeholder["priority"]})}>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </select>
          <Button onClick={()=> onUpdate(local)}><Save className="h-4 w-4 mr-1"/> Save Stakeholder</Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// -----------------------------
// Export / Import helpers
// -----------------------------

function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// -----------------------------
// Main Page
// -----------------------------

export default function StakeholderIdentificationPage() {
  const [projectName, setProjectName] = useState("20PAX Fuel Cell PGS");
  const [systemContext, setSystemContext] = useState("Aircraft-level power generation and thermal management supporting zero-emission operations.");
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([{
    id: uid(),
    name: "EASA – Certification",
    category: "Regulatory/Authority",
    role: "Defines certification basis and acceptable means of compliance",
    influence: 5,
    interest: 5,
    contact: "",
    notes: "",
    personas: [],
    items: [
      { id: uid(), type: "Constraint", text: "Compliance with CS-25 applicable paragraphs", source: "CS-25" },
      { id: uid(), type: "Acceptance Criterion", text: "Demonstrate compliance to acceptable level of safety per ARP4761/ARP4754B", source: "ARP" },
    ],
    interfaces: [ { id: uid(), kind: "Process", description: "Certification plan reviews, Issue Papers, CRIs" } ],
    priority: "High",
    validationOwner: "Chief of Flight Standards",
    includeInFHA: true,
  }]);

  const [newStakeholder, setNewStakeholder] = useState<{name: string; category: StakeholderCategory}>({ name: "", category: "Operator (Flight/Cabin)"});

  const progress = useMemo(()=>{
    const checks = {
      scope: systemContext.trim().length>10,
      comprehensive: CATEGORIES.some(cat=> stakeholders.some(s=> s.category===cat)),
      needs: stakeholders.every(s=> s.items.some(i=> i.type==="Need") || s.items.some(i=> i.type==="Constraint")),
      interfaces: stakeholders.every(s=> s.interfaces.length>0),
      priority: stakeholders.every(s=> !!s.priority),
      validation: stakeholders.every(s=> !!s.validationOwner),
    };
    const score = Object.values(checks).filter(Boolean).length / ARP4754B_CHECKPOINTS.length;
    return { score, checks };
  }, [systemContext, stakeholders]);

  const addStakeholder = () => {
    if (!newStakeholder.name.trim()) return;
    setStakeholders([{
      id: uid(),
      name: newStakeholder.name.trim(),
      category: newStakeholder.category,
      role: "",
      influence: 3,
      interest: 3,
      personas: [],
      items: [],
      interfaces: [],
      includeInFHA: false,
    }, ...stakeholders]);
    setNewStakeholder({ name: "", category: newStakeholder.category });
  };

  const updateStakeholder = (next: Stakeholder) => {
    setStakeholders(prev => prev.map(s=> s.id===next.id ? next : s));
  };

  const deleteStakeholder = (id: string) => setStakeholders(prev=> prev.filter(s=> s.id!==id));

  const quickSeeds: Array<{label: string; name: string; category: StakeholderCategory; role: string;}> = [
    { label: "Pilot", name: "Flight Crew – Captain", category: "Operator (Flight/Cabin)", role: "Operates the aircraft and assesses workload & usability"},
    { label: "Maintenance", name: "MRO – Line Maintenance", category: "Maintenance/MRO", role: "Performs turnaround servicing and repairs"},
    { label: "Manufacturing", name: "Production Engineering", category: "Manufacturing/Production", role: "Defines manufacturability and tooling constraints"},
    { label: "Supplier", name: "Compressor Supplier", category: "Supplier/Partner", role: "Provides subsystem with interface constraints"},
    { label: "PM/Finance", name: "Program Management", category: "Program/PM/Finance", role: "Sets budget, schedule, risk tolerance"},
    { label: "Airport", name: "Airport Ops / ATC", category: "Airport/ATC/Community", role: "Imposes noise and ops constraints"},
  ];

  const exportPayload = useMemo(()=>({
    meta: {
      standard: "ARP4754B",
      artifact: "Stakeholder Identification",
      projectName,
      systemContext,
      generatedAt: new Date().toISOString(),
      completeness: Math.round(progress.score*100),
    },
    stakeholders,
  }), [projectName, systemContext, stakeholders, progress.score]);

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data?.stakeholders && Array.isArray(data.stakeholders)) {
          setProjectName(data.meta?.projectName || projectName);
          setSystemContext(data.meta?.systemContext || systemContext);
          setStakeholders(data.stakeholders);
        }
      } catch(e) {
        console.error("Import failed", e);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7" /> Stakeholder Identification
            <Badge variant="secondary" className="ml-2">ARP4754B-aligned</Badge>
          </h1>
          <p className="text-sm text-muted-foreground max-w-[80ch]">
            Capture stakeholders, their needs, constraints, acceptance criteria, interfaces, and personas. This page maps to ARP4754B early lifecycle guidance (concept/requirements capture) and feeds FHA, requirements, and validation planning.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={()=> downloadJSON(`${projectName.replace(/\s+/g, "_")}_stakeholders.json`, exportPayload)}>
            <Download className="h-4 w-4 mr-1"/> Export JSON
          </Button>
          <label className="inline-flex items-center gap-2 border rounded-md px-3 cursor-pointer">
            <Upload className="h-4 w-4"/>
            <span className="text-sm">Import</span>
            <input type="file" className="hidden" accept="application/json" onChange={(e)=>{
              const f = e.target.files?.[0];
              if (f) handleImport(f);
            }}/>
          </label>
        </div>
      </div>

      {/* Project Context */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5"/> Project Context & Boundaries
          </CardTitle>
          <CardDescription>Set the stage so needs are captured in the right scope.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[2fr,3fr]">
          <div className="space-y-2">
            <FieldLabel tooltip="Program mnemonic used for traceability across artifacts.">Project Name</FieldLabel>
            <Input value={projectName} onChange={(e)=> setProjectName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <FieldLabel tooltip="High-level description of the system purpose, environment, and constraints.">System Context</FieldLabel>
            <Textarea rows={3} value={systemContext} onChange={(e)=> setSystemContext(e.target.value)} />
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4"/> This context will be referenced in requirement derivation & validation.
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={progress.checks.scope?"default":"secondary"}>
              {progress.checks.scope? <CheckCircle2 className="h-3.5 w-3.5 mr-1"/> : <AlertTriangle className="h-3.5 w-3.5 mr-1"/>}
              Scope set
            </Badge>
          </div>
        </CardFooter>
      </Card>

      {/* ARP4754B Readiness Checklist */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2"><Settings2 className="h-5 w-5"/> ARP4754B Readiness</CardTitle>
          <CardDescription>Live checklist driven by your inputs.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-3">
            {ARP4754B_CHECKPOINTS.map((c) => (
              <div key={c.id} className="rounded-xl border p-3 flex items-start gap-3">
                {progress.checks[c.id as keyof typeof progress.checks] ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600"/>
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600"/>
                )}
                <div>
                  <div className="font-medium text-sm">{c.title}</div>
                  <div className="text-xs text-muted-foreground">{c.hint}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-sm">Overall completeness</div>
          <div className="mt-2">
            <Slider value={[Math.round(progress.score*100)]} max={100} step={1} disabled/>
          </div>
        </CardContent>
      </Card>

      {/* Add Stakeholder */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2"><Users className="h-5 w-5"/> Stakeholders</CardTitle>
          <CardDescription>Identify everyone who influences or is influenced by the system.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-[1fr,1fr,auto] gap-2">
            <Input placeholder="Stakeholder name (e.g., Line Maintenance)" value={newStakeholder.name} onChange={(e)=> setNewStakeholder({...newStakeholder, name: e.target.value})} />
            <select className="border rounded-md px-2 py-1" value={newStakeholder.category} onChange={(e)=> setNewStakeholder({...newStakeholder, category: e.target.value as StakeholderCategory})}>
              {CATEGORIES.map((c)=> <option key={c}>{c}</option>)}
            </select>
            <Button onClick={addStakeholder}><Plus className="h-4 w-4 mr-1"/> Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickSeeds.map(seed => (
              <Button key={seed.label} variant="secondary" size="sm" onClick={()=> setStakeholders(prev=> [
                { id: uid(), name: seed.name, category: seed.category, role: seed.role, influence: 3, interest: 4, personas: [], items: [], interfaces: [], includeInFHA: false },
                ...prev,
              ])}>{seed.label}</Button>
            ))}
          </div>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Tip: Add representatives who will validate needs later — it streamlines sign-off at the right side of the V.
        </CardFooter>
      </Card>

      {/* Matrix */}
      <InfluenceInterestMatrix
        stakeholders={stakeholders}
        onSet={(id, infl, intr)=> setStakeholders(prev=> prev.map(s=> s.id===id? {...s, influence: infl as InfluenceLevel, interest: intr as InfluenceLevel}: s))}
      />

      {/* Stakeholder list */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {stakeholders.map((s)=> (
          <motion.div key={s.id} initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}>
            <StakeholderCard s={s} onUpdate={updateStakeholder} onDelete={deleteStakeholder} />
          </motion.div>
        ))}
      </div>

      {/* Next Stage CTA */}
      <div className="flex items-center justify-between py-4">
        <div className="text-sm text-muted-foreground">
          When this page reaches a high completeness score and all high-influence stakeholders have owners, proceed to Requirements Capture.
        </div>
        <Button disabled={progress.score < 0.7}>
          Continue to Requirements <ChevronRight className="h-4 w-4 ml-1"/>
        </Button>
      </div>
      </div>
    </div>
  );
}
