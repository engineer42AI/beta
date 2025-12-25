/** src/app/(protected)/system-b/certification-basis-V1/page.tsx */
"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Plus, Sparkles, SplitSquareHorizontal, Merge, Lock, Unlock, AlertTriangle, Info } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * MVP: Single-page progressive flow for a Certification Basis Tool
 * - Keeps lifecycle implicit (readiness & freezing) rather than a state machine
 * - Sections reveal as user provides info
 * - Uses local mock data (no API). Replace suggest* functions with real calls.
 */

type Moc = "Analysis" | "Test" | "Inspection" | "Simulation" | "Similarity" | "Engineering judgement";

type Regulation = {
  id: string; // e.g., CS 25.1309
  title: string;
  why: string;
  tags: string[];
};

type ComplianceItem = {
  id: string;
  name: string;
  regulations: Regulation[];
  proposedMoc: Moc[];
  novelty: boolean | null;
  complexity: boolean | null;
  criticality: "Potentially critical" | "Likely non-critical" | null;
  assumptions: string;
  status: {
    scope: boolean;
    regs: boolean;
    method: boolean;
    assumptions: boolean;
    frozen: boolean;
  };
};

const reveal = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, y: 6, transition: { duration: 0.15 } },
};

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function readinessScore(item: ComplianceItem) {
  const vals = Object.entries(item.status)
    .filter(([k]) => k !== "frozen")
    .map(([, v]) => (v ? 1 : 0));
  const score = vals.reduce((a, b) => a + b, 0);
  return { score, total: vals.length };
}

function confidenceLabel({ score, total }: { score: number; total: number }) {
  const pct = total === 0 ? 0 : score / total;
  if (pct >= 0.9) return { label: "High readiness", tone: "default" as const };
  if (pct >= 0.6) return { label: "Medium readiness", tone: "secondary" as const };
  return { label: "Low readiness", tone: "outline" as const };
}

function classNames(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ");
}

const MOCK_REGS: Regulation[] = [
  {
    id: "CS 25.1309",
    title: "Equipment, systems and installations",
    why: "System-level safety objectives, failure conditions, and design assurance expectations.",
    tags: ["Systems", "Safety"],
  },
  {
    id: "CS 25.1301",
    title: "Function and installation",
    why: "Basic suitability and correct functioning of installed equipment.",
    tags: ["Systems"],
  },
  {
    id: "CS 25.1351",
    title: "General — Electrical systems and equipment",
    why: "Electrical system design and installation fundamentals.",
    tags: ["Electrical"],
  },
  {
    id: "CS 25.1353",
    title: "Electrical equipment and installations",
    why: "Installation rules for electrical equipment, protection, and integration.",
    tags: ["Electrical"],
  },
  {
    id: "CS 25.1529",
    title: "Instructions for Continued Airworthiness",
    why: "ICA expectations and deliverables supporting safe in-service operation.",
    tags: ["ICAs"],
  },
];

function suggestRegulations(scopeText: string, ata: string | null): Regulation[] {
  // MVP heuristic: return a small, defensible list.
  // Replace with backend call that runs your applicability agent(s).
  const text = scopeText.toLowerCase();
  const picked: Regulation[] = [];
  if (text.includes("electrical") || text.includes("power") || ata === "ATA 24") {
    picked.push(MOCK_REGS.find((r) => r.id === "CS 25.1351")!);
    picked.push(MOCK_REGS.find((r) => r.id === "CS 25.1353")!);
  }
  if (text.includes("safety") || text.includes("failure") || text.includes("architecture")) {
    picked.push(MOCK_REGS.find((r) => r.id === "CS 25.1309")!);
  }
  // Always include 1301 as a general anchor when systems are involved
  picked.push(MOCK_REGS.find((r) => r.id === "CS 25.1301")!);

  // Keep unique
  return Array.from(new Map(picked.map((r) => [r.id, r])).values()).slice(0, 6);
}

function groupIntoComplianceItems(regs: Regulation[]): ComplianceItem[] {
  // MVP: simple grouping by tag families.
  const systems = regs.filter((r) => r.tags.includes("Systems") || r.tags.includes("Safety"));
  const electrical = regs.filter((r) => r.tags.includes("Electrical"));
  const icas = regs.filter((r) => r.tags.includes("ICAs"));

  const items: ComplianceItem[] = [];

  if (systems.length) {
    items.push({
      id: uid("cdi"),
      name: "System safety & installation (initial)",
      regulations: systems,
      proposedMoc: ["Analysis", "Engineering judgement"],
      novelty: null,
      complexity: null,
      criticality: "Potentially critical",
      assumptions: "",
      status: { scope: true, regs: true, method: false, assumptions: false, frozen: false },
    });
  }
  if (electrical.length) {
    items.push({
      id: uid("cdi"),
      name: "Electrical power system compliance (initial)",
      regulations: electrical,
      proposedMoc: ["Analysis", "Test"],
      novelty: null,
      complexity: null,
      criticality: null,
      assumptions: "",
      status: { scope: true, regs: true, method: false, assumptions: false, frozen: false },
    });
  }
  if (icas.length) {
    items.push({
      id: uid("cdi"),
      name: "ICA deliverables (initial)",
      regulations: icas,
      proposedMoc: ["Inspection", "Engineering judgement"],
      novelty: null,
      complexity: null,
      criticality: "Likely non-critical",
      assumptions: "",
      status: { scope: true, regs: true, method: false, assumptions: false, frozen: false },
    });
  }

  // Fallback: if only one pile, return a single CDI
  if (!items.length && regs.length) {
    items.push({
      id: uid("cdi"),
      name: "Compliance item (initial)",
      regulations: regs,
      proposedMoc: ["Analysis"],
      novelty: null,
      complexity: null,
      criticality: null,
      assumptions: "",
      status: { scope: true, regs: true, method: false, assumptions: false, frozen: false },
    });
  }

  return items;
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        ok ? "bg-muted/30" : "bg-background"
      )}
    >
      <span
        className={classNames(
          "inline-block h-1.5 w-1.5 rounded-full",
          ok ? "bg-foreground" : "bg-muted-foreground"
        )}
      />
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}

function SectionHeader({
  step,
  title,
  hint,
  done,
}: {
  step: string;
  title: string;
  hint: string;
  done?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="rounded-full">
            {step}
          </Badge>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {done ? (
            <Badge variant="default" className="rounded-full">
              <Check className="mr-1 h-3.5 w-3.5" /> Done
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function MocPicker({
  value,
  onChange,
  disabled,
}: {
  value: Moc[];
  onChange: (next: Moc[]) => void;
  disabled?: boolean;
}) {
  const all: Moc[] = [
    "Analysis",
    "Test",
    "Inspection",
    "Simulation",
    "Similarity",
    "Engineering judgement",
  ];
  return (
    <div className={classNames("grid grid-cols-2 gap-2", disabled && "opacity-60")}
      aria-disabled={disabled}
    >
      {all.map((m) => {
        const checked = value.includes(m);
        return (
          <label
            key={m}
            className={classNames(
              "flex cursor-pointer items-center gap-2 rounded-xl border p-2 hover:bg-muted/40",
              checked && "bg-muted/30"
            )}
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={(c) => {
                if (disabled) return;
                const isOn = Boolean(c);
                const next = isOn ? Array.from(new Set([...value, m])) : value.filter((x) => x !== m);
                onChange(next);
              }}
            />
            <span className="text-sm">{m}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function Page() {
  const [projectName, setProjectName] = React.useState("CS-25 Certification Basis");
  const [productType, setProductType] = React.useState<"New" | "Change">("Change");
  const [ata, setAta] = React.useState<string | null>("ATA 24");
  const [scopeText, setScopeText] = React.useState<string>("");
  const [scopeLocked, setScopeLocked] = React.useState(false);

  const [regs, setRegs] = React.useState<Regulation[]>([]);
  const [selectedRegIds, setSelectedRegIds] = React.useState<Set<string>>(new Set());

  const [items, setItems] = React.useState<ComplianceItem[]>([]);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const scopeDone = scopeText.trim().length >= 60; // simple heuristic
  const regsReady = selectedRegIds.size > 0;
  const itemsReady = items.length > 0;

  React.useEffect(() => {
    if (!scopeDone) return;
    // Suggest regs when scope becomes meaningful.
    const suggested = suggestRegulations(scopeText, ata);
    setRegs(suggested);
    // Default-select suggestions.
    setSelectedRegIds(new Set(suggested.map((r) => r.id)));
  }, [scopeDone, scopeText, ata]);

  React.useEffect(() => {
    if (!regsReady) return;
    const chosen = regs.filter((r) => selectedRegIds.has(r.id));
    setItems(groupIntoComplianceItems(chosen));
  }, [regsReady, regs, selectedRegIds]);

  const selectedRegs = React.useMemo(
    () => regs.filter((r) => selectedRegIds.has(r.id)),
    [regs, selectedRegIds]
  );

  function toggleReg(id: string) {
    setSelectedRegIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateItem(id: string, patch: Partial<ComplianceItem>) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        // Derive readiness flags
        next.status = {
          ...next.status,
          regs: next.regulations.length > 0,
          method: (next.proposedMoc?.length ?? 0) > 0 && next.novelty !== null && next.complexity !== null,
          assumptions: (next.assumptions?.trim().length ?? 0) >= 20,
        };
        return next;
      })
    );
  }

  function splitItem(id: string) {
    setItems((prev) => {
      const it = prev.find((x) => x.id === id);
      if (!it) return prev;
      if (it.regulations.length < 2) return prev;
      const [a, ...rest] = it.regulations;
      const left: ComplianceItem = {
        ...it,
        id: uid("cdi"),
        name: `${it.name} — Part A`,
        regulations: [a],
        status: { ...it.status, frozen: false },
      };
      const right: ComplianceItem = {
        ...it,
        id: uid("cdi"),
        name: `${it.name} — Part B`,
        regulations: rest,
        status: { ...it.status, frozen: false },
      };
      return prev.filter((x) => x.id !== id).concat([left, right]);
    });
  }

  function mergeItems() {
    setItems((prev) => {
      if (prev.length < 2) return prev;
      const allRegs = Array.from(new Map(prev.flatMap((x) => x.regulations).map((r) => [r.id, r])).values());
      const merged: ComplianceItem = {
        id: uid("cdi"),
        name: "Merged compliance item (draft)",
        regulations: allRegs,
        proposedMoc: Array.from(new Set(prev.flatMap((x) => x.proposedMoc))),
        novelty: null,
        complexity: null,
        criticality: null,
        assumptions: "",
        status: { scope: true, regs: true, method: false, assumptions: false, frozen: false },
      };
      return [merged];
    });
  }

  function freezeItem(id: string) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const r = readinessScore(it);
        // MVP rule: only freeze if method+assumptions are present
        const canFreeze = it.status.method && it.status.assumptions && r.score >= 3;
        if (!canFreeze) return it;
        return { ...it, status: { ...it.status, frozen: true } };
      })
    );
  }

  function unfreezeItem(id: string) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status: { ...it.status, frozen: false } } : it))
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-10">
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                <Sparkles className="h-3.5 w-3.5" />
                Certification Basis Tool · CS-25
              </div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{projectName}</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Start with scope, get a defensible CS-25 shortlist, then shape those into compliance items (CDIs) without
                forcing premature completeness.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                className="w-full sm:w-[280px]"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name"
              />
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 px-3 py-2 shadow-sm">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium">Advanced</div>
                  <div className="text-xs text-muted-foreground">Show lifecycle & traceability</div>
                </div>
                <Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
              </div>
            </div>
          </div>

          <Separator className="my-8" />

          {/* Step 1: Define scope */}
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <SectionHeader
                step="1"
                title="Define scope"
                hint="Describe the change or system. Keep it engineering-specific: function, interfaces, environment, novelty."
                done={scopeDone}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Project type</Label>
                  <Select value={productType} onValueChange={(v) => setProductType(v as any)}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="New">New Type</SelectItem>
                      <SelectItem value="Change">Change / STC / Major change</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>System area (optional)</Label>
                  <Select value={ata ?? undefined} onValueChange={(v) => setAta(v)}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Pick ATA" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ATA 24">ATA 24 — Electrical Power</SelectItem>
                      <SelectItem value="ATA 21">ATA 21 — Air Conditioning</SelectItem>
                      <SelectItem value="ATA 27">ATA 27 — Flight Controls</SelectItem>
                      <SelectItem value="ATA 28">ATA 28 — Fuel</SelectItem>
                      <SelectItem value="ATA 32">ATA 32 — Landing Gear</SelectItem>
                      <SelectItem value="ATA 00">Unknown / Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Lock scope</Label>
                  <div className="flex items-center gap-3 rounded-xl border p-3">
                    <Switch
                      checked={scopeLocked}
                      onCheckedChange={(v) => setScopeLocked(v)}
                      disabled={!scopeDone}
                    />
                    <div className="text-sm">
                      <div className="font-medium">Freeze inputs for consistency</div>
                      <div className="text-xs text-muted-foreground">You can unlock later if assumptions change.</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Scope description</Label>
                  <span className="text-xs text-muted-foreground">
                    {scopeText.trim().length} chars · aim for ~100+
                  </span>
                </div>
                <Textarea
                  className="min-h-[140px] rounded-2xl"
                  value={scopeText}
                  onChange={(e) => !scopeLocked && setScopeText(e.target.value)}
                  placeholder={
                    "Example: Modify ATA24 electrical power distribution to add a 28VDC emergency bus, new contactor logic, and updated load shedding. Interfaces: ESS bus, avionics loads, battery, cockpit indications. Operating conditions: dispatch with one generator inop, cold soak. Reuse: existing harness routing. Novelty: new electronic breaker."
                  }
                  disabled={scopeLocked}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Pill ok={scopeText.trim().length >= 60} label="Sufficient detail" />
                  <Pill ok={Boolean(ata)} label="System context" />
                  <Pill ok={productType === "Change" || productType === "New"} label="Project type" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 2: Identify CS-25 regulations */}
          <AnimatePresence>
            {scopeDone && (
              <motion.div variants={reveal} initial="hidden" animate="show" exit="exit" className="mt-6">
                <Card className="rounded-2xl shadow-sm">
                  <CardHeader>
                    <SectionHeader
                      step="2"
                      title="Identify applicable CS-25 regulations"
                      hint="Review the shortlist and adjust. Keep it tight and defensible."
                      done={regsReady}
                    />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-3 rounded-2xl border bg-background/60 p-4">
                      <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div className="text-sm">
                        <div className="font-medium">MVP behaviour</div>
                        <div className="text-muted-foreground">
                          This page uses a placeholder ruleset. In your production build, replace this with your
                          applicability agent(s) and evidence-backed citations.
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      {regs.map((r) => {
                        const checked = selectedRegIds.has(r.id);
                        return (
                          <div
                            key={r.id}
                            className={classNames(
                              "flex items-start justify-between gap-3 rounded-2xl border p-4",
                              checked ? "bg-muted/30" : "bg-background"
                            )}
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="flex cursor-pointer items-center gap-2">
                                  <Checkbox checked={checked} onCheckedChange={() => toggleReg(r.id)} disabled={scopeLocked} />
                                  <span className="font-medium">{r.id}</span>
                                </label>
                                <span className="text-sm text-muted-foreground">{r.title}</span>
                              </div>
                              <p className="text-sm text-muted-foreground">{r.why}</p>
                              <div className="flex flex-wrap gap-2">
                                {r.tags.map((t) => (
                                  <Badge key={t} variant="outline" className="rounded-full">
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant={checked ? "secondary" : "outline"}
                                  className="shrink-0 rounded-xl"
                                  onClick={() => toggleReg(r.id)}
                                  disabled={scopeLocked}
                                >
                                  {checked ? "Included" : "Include"}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {scopeLocked ? "Unlock scope to edit selections" : "Toggle inclusion"}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        Selected: <span className="font-medium text-foreground">{selectedRegIds.size}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => setSelectedRegIds(new Set(regs.map((r) => r.id)))}
                          disabled={scopeLocked}
                        >
                          Select all
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => setSelectedRegIds(new Set())}
                          disabled={scopeLocked}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 3: Group into compliance items (CDIs) */}
          <AnimatePresence>
            {regsReady && (
              <motion.div variants={reveal} initial="hidden" animate="show" exit="exit" className="mt-6">
                <Card className="rounded-2xl shadow-sm">
                  <CardHeader>
                    <SectionHeader
                      step="3"
                      title="Group into compliance items"
                      hint="These groupings are what your team will typically treat as CDIs. Keep them meaningful and reviewable."
                      done={itemsReady}
                    />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-full">
                          {items.length} items
                        </Badge>
                        <Badge variant="outline" className="rounded-full">
                          {selectedRegs.length} regs covered
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="rounded-xl"
                          onClick={mergeItems}
                          disabled={scopeLocked || items.length < 2}
                        >
                          <Merge className="mr-2 h-4 w-4" /> Merge all
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-xl"
                          onClick={() =>
                            setItems((prev) =>
                              prev.concat({
                                id: uid("cdi"),
                                name: "New compliance item",
                                regulations: [],
                                proposedMoc: [],
                                novelty: null,
                                complexity: null,
                                criticality: null,
                                assumptions: "",
                                status: { scope: true, regs: false, method: false, assumptions: false, frozen: false },
                              })
                            )
                          }
                          disabled={scopeLocked}
                        >
                          <Plus className="mr-2 h-4 w-4" /> Add item
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4">
                      {items.map((it) => {
                        const r = readinessScore(it);
                        const conf = confidenceLabel(r);
                        return (
                          <Card key={it.id} className="rounded-2xl border shadow-none">
                            <CardHeader className="pb-3">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="space-y-1">
                                  <CardTitle className="text-base">{it.name}</CardTitle>
                                  <CardDescription>
                                    {it.regulations.length ? (
                                      <span>
                                        Covers <span className="font-medium text-foreground">{it.regulations.length}</span> regs.
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">No regulations assigned yet.</span>
                                    )}
                                  </CardDescription>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant={conf.tone} className="rounded-full">
                                      {conf.label}
                                    </Badge>
                                    {it.status.frozen ? (
                                      <Badge variant="default" className="rounded-full">
                                        <Lock className="mr-1 h-3.5 w-3.5" /> Frozen
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="rounded-full">
                                        <Unlock className="mr-1 h-3.5 w-3.5" /> Editable
                                      </Badge>
                                    )}
                                    {it.criticality ? (
                                      <Badge variant="outline" className="rounded-full">
                                        {it.criticality}
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    className="rounded-xl"
                                    onClick={() => splitItem(it.id)}
                                    disabled={scopeLocked || it.status.frozen || it.regulations.length < 2}
                                  >
                                    <SplitSquareHorizontal className="mr-2 h-4 w-4" /> Split
                                  </Button>
                                  {!it.status.frozen ? (
                                    <Button
                                      className="rounded-xl"
                                      onClick={() => freezeItem(it.id)}
                                      disabled={scopeLocked}
                                    >
                                      <Lock className="mr-2 h-4 w-4" /> Freeze
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="secondary"
                                      className="rounded-xl"
                                      onClick={() => unfreezeItem(it.id)}
                                      disabled={scopeLocked}
                                    >
                                      <Unlock className="mr-2 h-4 w-4" /> Unfreeze
                                    </Button>
                                  )}
                                </div>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-2">
                                <Pill ok={it.status.scope} label="Scope" />
                                <Pill ok={it.status.regs} label="Regs" />
                                <Pill ok={it.status.method} label="Method" />
                                <Pill ok={it.status.assumptions} label="Assumptions" />
                              </div>

                              {showAdvanced && (
                                <div className="mt-3 flex items-start gap-3 rounded-2xl border bg-background/60 p-3">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                  <div className="text-sm">
                                    <div className="font-medium">Lifecycle (implicit)</div>
                                    <div className="text-muted-foreground">
                                      This item is treated as <span className="font-medium">planning</span> until it is frozen.
                                      Freezing is your baseline point for audit and downstream evidence.
                                    </div>
                                  </div>
                                </div>
                              )}
                            </CardHeader>

                            <CardContent className="space-y-5">
                              {/* Assign regulations */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <Label>Assigned regulations</Label>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="outline"
                                        className="h-8 rounded-xl"
                                        disabled={scopeLocked || it.status.frozen}
                                        onClick={() => {
                                          // Quick add all selected regs
                                          updateItem(it.id, {
                                            regulations: selectedRegs,
                                            status: { ...it.status, regs: selectedRegs.length > 0 },
                                          });
                                        }}
                                      >
                                        <ChevronRight className="mr-2 h-4 w-4" /> Use selected
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Assign all regs from Step 2</TooltipContent>
                                  </Tooltip>
                                </div>

                                <div className="grid gap-2 md:grid-cols-2">
                                  {selectedRegs.map((r) => {
                                    const checked = it.regulations.some((x) => x.id === r.id);
                                    return (
                                      <label
                                        key={`${it.id}_${r.id}`}
                                        className={classNames(
                                          "flex items-start gap-2 rounded-xl border p-3 hover:bg-muted/40",
                                          checked && "bg-muted/30"
                                        )}
                                      >
                                        <Checkbox
                                          checked={checked}
                                          disabled={scopeLocked || it.status.frozen}
                                          onCheckedChange={(c) => {
                                            if (scopeLocked || it.status.frozen) return;
                                            const on = Boolean(c);
                                            const nextRegs = on
                                              ? Array.from(
                                                  new Map(
                                                    [...it.regulations, r].map((rr) => [rr.id, rr])
                                                  ).values()
                                                )
                                              : it.regulations.filter((rr) => rr.id !== r.id);
                                            updateItem(it.id, { regulations: nextRegs });
                                          }}
                                        />
                                        <div className="min-w-0">
                                          <div className="text-sm font-medium">{r.id}</div>
                                          <div className="text-xs text-muted-foreground line-clamp-2">{r.title}</div>
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>

                              <Separator />

                              {/* Method */}
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <Label>Compliance approach</Label>
                                  <Badge variant="outline" className="rounded-full">
                                    MoC & risk signals
                                  </Badge>
                                </div>

                                <MocPicker
                                  value={it.proposedMoc}
                                  onChange={(next) => updateItem(it.id, { proposedMoc: next })}
                                  disabled={scopeLocked || it.status.frozen}
                                />

                                <div className="grid gap-3 md:grid-cols-3">
                                  <div className="space-y-2 rounded-2xl border p-3">
                                    <div className="flex items-center justify-between">
                                      <Label>Novelty</Label>
                                      <Badge variant="outline" className="rounded-full">binary</Badge>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant={it.novelty === true ? "default" : "outline"}
                                        className="rounded-xl"
                                        disabled={scopeLocked || it.status.frozen}
                                        onClick={() => updateItem(it.id, { novelty: true })}
                                      >
                                        Novel
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant={it.novelty === false ? "default" : "outline"}
                                        className="rounded-xl"
                                        disabled={scopeLocked || it.status.frozen}
                                        onClick={() => updateItem(it.id, { novelty: false })}
                                      >
                                        Not novel
                                      </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      New tech, new MoC, new integration, or new interpretation.
                                    </p>
                                  </div>

                                  <div className="space-y-2 rounded-2xl border p-3">
                                    <div className="flex items-center justify-between">
                                      <Label>Complexity</Label>
                                      <Badge variant="outline" className="rounded-full">binary</Badge>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant={it.complexity === true ? "default" : "outline"}
                                        className="rounded-xl"
                                        disabled={scopeLocked || it.status.frozen}
                                        onClick={() => updateItem(it.id, { complexity: true })}
                                      >
                                        Complex
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant={it.complexity === false ? "default" : "outline"}
                                        className="rounded-xl"
                                        disabled={scopeLocked || it.status.frozen}
                                        onClick={() => updateItem(it.id, { complexity: false })}
                                      >
                                        Not complex
                                      </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      Subjective compliance, tricky tests, sensitive analyses, heavy integration.
                                    </p>
                                  </div>

                                  <div className="space-y-2 rounded-2xl border p-3">
                                    <div className="flex items-center justify-between">
                                      <Label>Criticality</Label>
                                      <Badge variant="outline" className="rounded-full">coarse</Badge>
                                    </div>
                                    <Select
                                      value={it.criticality ?? ""}
                                      onValueChange={(v) =>
                                        updateItem(it.id, {
                                          criticality: v as any,
                                        })
                                      }
                                    >
                                      <SelectTrigger className="rounded-xl" disabled={scopeLocked || it.status.frozen}>
                                        <SelectValue placeholder="Select" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="Potentially critical">Potentially critical</SelectItem>
                                        <SelectItem value="Likely non-critical">Likely non-critical</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                      A miss could materially affect safety or environment.
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <Separator />

                              {/* Assumptions */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label>Assumptions & rationale</Label>
                                  <Badge variant="outline" className="rounded-full">
                                    visible to reviewers
                                  </Badge>
                                </div>
                                <Textarea
                                  className="min-h-[110px] rounded-2xl"
                                  value={it.assumptions}
                                  disabled={scopeLocked || it.status.frozen}
                                  onChange={(e) => updateItem(it.id, { assumptions: e.target.value })}
                                  placeholder={
                                    "State key assumptions (architecture, interfaces, operating conditions), and why the chosen MoC is appropriate. Keep it short but explicit."
                                  }
                                />
                                <div className="text-xs text-muted-foreground">
                                  Tip: auditors care less about certainty and more about explicit assumptions + controlled change.
                                </div>
                              </div>

                              {showAdvanced && (
                                <Accordion type="single" collapsible className="rounded-2xl border">
                                  <AccordionItem value="trace" className="border-none">
                                    <AccordionTrigger className="px-4">
                                      Lifecycle & traceability (optional)
                                    </AccordionTrigger>
                                    <AccordionContent className="px-4 pb-4">
                                      <div className="space-y-3 text-sm">
                                        <div className="flex flex-wrap gap-2">
                                          <Badge variant="outline" className="rounded-full">Planned</Badge>
                                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                          <Badge variant="outline" className="rounded-full">Agreed</Badge>
                                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                          <Badge variant="outline" className="rounded-full">In progress</Badge>
                                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                          <Badge variant="outline" className="rounded-full">Complete</Badge>
                                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                          <Badge variant={it.status.frozen ? "default" : "outline"} className="rounded-full">
                                            Frozen
                                          </Badge>
                                        </div>
                                        <p className="text-muted-foreground">
                                          In the MVP, this is informational. In your full product, each transition should generate a
                                          trace record (who/what/when/why) and freeze outputs for auditability.
                                        </p>
                                      </div>
                                    </AccordionContent>
                                  </AccordionItem>
                                </Accordion>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 4: Review & readiness */}
          <AnimatePresence>
            {itemsReady && (
              <motion.div variants={reveal} initial="hidden" animate="show" exit="exit" className="mt-6">
                <Card className="rounded-2xl shadow-sm">
                  <CardHeader>
                    <SectionHeader
                      step="4"
                      title="Review & readiness"
                      hint="A simple, engineer-friendly view: what’s done, what’s missing, what’s safe to freeze."
                    />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Card className="rounded-2xl border shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">Coverage</CardTitle>
                          <CardDescription>Selected regs covered by at least one item</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {(() => {
                            const covered = new Set(items.flatMap((it) => it.regulations.map((r) => r.id)));
                            const total = selectedRegs.length;
                            const ok = selectedRegs.filter((r) => covered.has(r.id)).length;
                            return (
                              <div className="space-y-2">
                                <div className="text-2xl font-semibold">{ok}/{total}</div>
                                <div className="text-xs text-muted-foreground">
                                  {ok === total ? "Full coverage" : "Some regs are not assigned yet"}
                                </div>
                              </div>
                            );
                          })()}
                        </CardContent>
                      </Card>

                      <Card className="rounded-2xl border shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">Freeze-ready items</CardTitle>
                          <CardDescription>Method + assumptions present</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {(() => {
                            const ready = items.filter((it) => it.status.method && it.status.assumptions && !it.status.frozen)
                              .length;
                            const frozen = items.filter((it) => it.status.frozen).length;
                            return (
                              <div className="space-y-2">
                                <div className="text-2xl font-semibold">{ready}</div>
                                <div className="text-xs text-muted-foreground">Already frozen: {frozen}</div>
                              </div>
                            );
                          })()}
                        </CardContent>
                      </Card>

                      <Card className="rounded-2xl border shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">Change discipline</CardTitle>
                          <CardDescription>Keep changes visible and intentional</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div className="text-sm">
                              <span className="font-medium">Rule of thumb:</span> freeze only when you could defend the
                              scope, MoC, and assumptions in a review.
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Later, evidence attaches to frozen baselines.
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        Next (typical): export draft certification programme tables / CDI register.
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="rounded-xl">
                          Export (mock)
                        </Button>
                        <Button className="rounded-xl">Create trace (mock)</Button>
                      </div>
                    </div>

                    {showAdvanced && (
                      <div className="rounded-2xl border bg-background/60 p-4 text-sm">
                        <div className="font-medium">Why this avoids overwhelm</div>
                        <div className="mt-1 text-muted-foreground">
                          We show readiness and freezing (what engineers actually care about), and keep lifecycle theory
                          optional. You can add a dedicated “Lifecycle” view later for power users.
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-10 text-center text-xs text-muted-foreground">
            MVP UI scaffold · Replace mock suggestions with your backend (CS-25 applicability + CDI generation + citations)
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}


