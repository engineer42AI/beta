"use client";

import React, { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, UserPlus, Airplay, Wrench, Factory, ShieldCheck, Landmark,
  Plane, ClipboardList, Recycle, LineChart, ChevronRight, ChevronDown,
  Download, Upload, Info, Sparkles, CheckCircle2, AlertTriangle
} from "lucide-react";

/**
 * Stakeholder Identification — “Build Your Crew”
 * - Progressive disclosure (no walls of fields)
 * - Visual crew building with role cards
 * - Per-stakeholder detail panel: essentials first; advanced collapsibles
 * - ARP4754B-aligned readiness checklist + JSON export
 *
 * Tailwind classes assume you already have Tailwind set up in the app.
 * If you use a layout with header/sidebar, the h-full/min-h-0 wrapper lets this page scroll correctly.
 */

type RoleKey =
  | "customer" | "operator" | "pilot" | "cabinCrew" | "maintainer" | "mro"
  | "manufacturing" | "supplier" | "regulator" | "safety" | "airlineOps"
  | "program" | "community" | "environment" | "disposal" | "custom";

type Stakeholder = {
  id: string;
  roleKey: RoleKey;
  displayName: string;
  // Essentials (kept short for onboarding):
  topNeeds?: string;          // what outcomes they care about
  keyConstraints?: string;    // constraints they impose
  acceptanceHints?: string;   // “what success looks like” in their words
  // Optional (advanced, collapsible):
  interfaces?: string;        // how they interact (operational/physical/info)
  scenarios?: string;         // typical usage/ops situations
  influence?: "Low" | "Medium" | "High";
  interest?: "Low" | "Medium" | "High";
  notes?: string;
};

const ROLE_LIBRARY: Record<RoleKey, { label: string; icon: React.ElementType; hint: string }> = {
  customer:     { label: "Customer / Purchaser", icon: Users, hint: "Mission profiles, availability, cost targets" },
  operator:     { label: "Operator (Airline Ops)", icon: Airplay, hint: "Operational performance, turn-around, dispatch" },
  pilot:        { label: "Pilot", icon: Plane, hint: "Usability, workload, procedures, HF" },
  cabinCrew:    { label: "Cabin Crew", icon: Users, hint: "Safety duties, UI ergonomics, service constraints" },
  maintainer:   { label: "Maintenance (Line/Base)", icon: Wrench, hint: "Maintainability, access, diagnostics" },
  mro:          { label: "MRO / Repair Station", icon: Wrench, hint: "Repair flows, spares, downtime drivers" },
  manufacturing:{ label: "Manufacturing / Production", icon: Factory, hint: "Buildability, tolerances, process limits" },
  supplier:     { label: "Supplier / Partner", icon: ClipboardList, hint: "Interfaces, performance/COTS limits" },
  regulator:    { label: "Authority (FAA/EASA/CAA)", icon: Landmark, hint: "Certification basis, safety objectives" },
  safety:       { label: "Safety & Compliance", icon: ShieldCheck, hint: "ARP4754B/4761 alignment, validation basis" },
  airlineOps:   { label: "Airline Operations", icon: LineChart, hint: "Fleet planning, schedules, operational KPIs" },
  program:      { label: "Program / PMO / Finance", icon: LineChart, hint: "Budget, schedule, risk appetite" },
  community:    { label: "Passengers / Community", icon: Users, hint: "Noise, comfort, public acceptance" },
  environment:  { label: "Environmental Authorities", icon: Recycle, hint: "Emissions, noise, end-of-life rules" },
  disposal:     { label: "End-of-Life / Recycling", icon: Recycle, hint: "Materials, recycling, teardown" },
  custom:       { label: "Custom Role", icon: UserPlus, hint: "Anything unique to your program" },
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function StakeholderIdentificationPage() {
  // Minimal context (kept light; you can pull from elsewhere in your app)
  const [projectName, setProjectName] = useState("20PAX Fuel Cell PGS");
  const [systemContext, setSystemContext] = useState(
    "Aircraft-level power generation and thermal management supporting zero-emission operations."
  );

  // Crew builder
  const [selectedRoles, setSelectedRoles] = useState<RoleKey[]>([
    "pilot",
    "maintainer",
    "regulator",
    "supplier",
  ]);
  const [crew, setCrew] = useState<Stakeholder[]>(() =>
    ["pilot", "maintainer", "regulator", "supplier"].map((rk) => ({
      id: uid(),
      roleKey: rk as RoleKey,
      displayName: ROLE_LIBRARY[rk as RoleKey].label,
      influence: "Medium",
      interest: "High",
    }))
  );
  const [activeStakeholderId, setActiveStakeholderId] = useState<string | null>(
    crew.length ? crew[0].id : null
  );
  const activeStakeholder = useMemo(
    () => crew.find((c) => c.id === activeStakeholderId) || null,
    [crew, activeStakeholderId]
  );

  // Progressive UI sections
  const [showContext, setShowContext] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Add/remove roles
  const toggleRole = (rk: RoleKey) => {
    setSelectedRoles((prev) =>
      prev.includes(rk) ? prev.filter((r) => r !== rk) : [...prev, rk]
    );
  };

  useEffect(() => {
    // Ensure crew list matches selected roles (add missing, keep edited)
    setCrew((prev) => {
      const next = [...prev];
      // add any newly selected roles
      selectedRoles.forEach((rk) => {
        if (!next.some((c) => c.roleKey === rk)) {
          next.push({
            id: uid(),
            roleKey: rk,
            displayName: ROLE_LIBRARY[rk].label,
            influence: "Medium",
            interest: "High",
          });
        }
      });
      // remove any deselected roles (but keep "custom")
      return next.filter(
        (c) => c.roleKey === "custom" || selectedRoles.includes(c.roleKey)
      );
    });
  }, [selectedRoles]);

  useEffect(() => {
    // Keep active in sync
    if (crew.length && !activeStakeholderId) {
      setActiveStakeholderId(crew[0].id);
    }
    if (activeStakeholderId && !crew.some((c) => c.id === activeStakeholderId)) {
      setActiveStakeholderId(crew.length ? crew[0].id : null);
    }
  }, [crew, activeStakeholderId]);

  // Add a custom role quickly
  const addCustom = () => {
    const name = prompt("Custom stakeholder role name?");
    if (!name) return;
    const newItem: Stakeholder = {
      id: uid(),
      roleKey: "custom",
      displayName: name.trim(),
      influence: "Medium",
      interest: "High",
    };
    setCrew((prev) => [...prev, newItem]);
    setActiveStakeholderId(newItem.id);
  };

  // Update active stakeholder fields
  const updateActive = (patch: Partial<Stakeholder>) => {
    if (!activeStakeholder) return;
    setCrew((prev) => prev.map((c) => (c.id === activeStakeholder.id ? { ...c, ...patch } : c)));
  };

  // Completeness scoring (ARP4754B-aligned essentials)
  const completeness = useMemo(() => {
    const essentialsPer = crew.map((c) => {
      const essentialsFilled =
        (c.topNeeds?.trim() ? 1 : 0) +
        (c.keyConstraints?.trim() ? 1 : 0) +
        (c.acceptanceHints?.trim() ? 1 : 0);
      return essentialsFilled / 3;
    });
    const avg = essentialsPer.length
      ? Math.round((essentialsPer.reduce((a, b) => a + b, 0) / essentialsPer.length) * 100)
      : 0;

    // Program-level minimal context also contributes lightly
    const contextBonus =
      (projectName.trim() ? 1 : 0) + (systemContext.trim() ? 1 : 0);
    const contextPct = contextBonus === 2 ? 100 : contextBonus === 1 ? 50 : 0;

    // Weighted: 85% crew essentials, 15% context
    return Math.round(avg * 0.85 + contextPct * 0.15);
  }, [crew, projectName, systemContext]);

  // Export JSON
  const exportPayload = useMemo(
    () => ({
      meta: {
        standard: "ARP4754B",
        step: "Stakeholder Identification",
        generatedAt: new Date().toISOString(),
      },
      project: {
        name: projectName,
        systemContext,
      },
      stakeholders: crew,
    }),
    [crew, projectName, systemContext]
  );

  const downloadJSON = (filename: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      if (!input.files?.length) return;
      const text = await input.files[0].text();
      try {
        const parsed = JSON.parse(text);
        if (parsed?.project?.name) setProjectName(parsed.project.name);
        if (parsed?.project?.systemContext) setSystemContext(parsed.project.systemContext);
        if (Array.isArray(parsed?.stakeholders)) setCrew(parsed.stakeholders);
      } catch {
        alert("Could not parse JSON.");
      }
    };
    input.click();
  };

  // Visual helpers
  const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className || ""}`}>
      {children}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              <Sparkles className="h-3.5 w-3.5" />
              ARP4754B-aligned
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Stakeholder Identification</h1>
            <p className="text-slate-600 max-w-2xl">
              Build your crew of stakeholders. Start simple—just pick who matters. Then fill in a few essentials for each.
              We’ll keep the rest tucked away until you’re ready.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                downloadJSON(`${projectName.replace(/\s+/g, "_")}_stakeholders.json`, exportPayload)
              }
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Export
            </button>
            <button
              onClick={importJSON}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
            >
              <Upload className="h-4 w-4" /> Import
            </button>
          </div>
        </div>

        {/* 1) Context (optional, collapsed by default) */}
        <Card>
          <button
            onClick={() => setShowContext((s) => !s)}
            className="w-full flex items-center justify-between px-5 py-4"
          >
            <div className="flex items-center gap-3">
              <Info className="h-5 w-5 text-slate-500" />
              <div>
                <div className="font-medium">Project context (optional)</div>
                <div className="text-sm text-slate-600">
                  A tiny bit of context helps derive coherent needs later.
                </div>
              </div>
            </div>
            {showContext ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
          <AnimatePresence initial={false}>
            {showContext && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="px-5 pb-5 space-y-4"
              >
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-slate-700">Project Name</label>
                    <input
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-3 py-2"
                      placeholder="e.g., 20PAX Fuel Cell PGS"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-slate-700">System Context</label>
                    <textarea
                      value={systemContext}
                      onChange={(e) => setSystemContext(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-3 py-2 min-h-[42px]"
                      placeholder="Short purpose, operational context, boundaries"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* 2) Build your crew */}
        <div className="grid lg:grid-cols-7 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-slate-500" />
                  <div>
                    <div className="font-medium">Build your crew</div>
                    <div className="text-sm text-slate-600">
                      Pick who matters. Add custom roles as needed.
                    </div>
                  </div>
                </div>
                <button
                  onClick={addCustom}
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <UserPlus className="h-4 w-4" /> Add custom
                </button>
              </div>
              <div className="px-5 pb-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(
                    [
                      "customer","operator","pilot","cabinCrew","maintainer","mro",
                      "manufacturing","supplier","regulator","safety","airlineOps",
                      "program","community","environment","disposal"
                    ] as RoleKey[]
                  ).map((rk) => {
                    const selected = selectedRoles.includes(rk);
                    const Icon = ROLE_LIBRARY[rk].icon;
                    return (
                      <button
                        key={rk}
                        onClick={() => toggleRole(rk)}
                        className={`group flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:shadow-sm transition ${
                          selected ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"
                        }`}
                        title={ROLE_LIBRARY[rk].hint}
                      >
                        <Icon className={`h-4 w-4 ${selected ? "text-emerald-600" : "text-slate-500"}`} />
                        <span className={`truncate ${selected ? "text-emerald-900" : "text-slate-800"}`}>
                          {ROLE_LIBRARY[rk].label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {crew.filter((c) => c.roleKey === "custom").length > 0 && (
                  <div className="mt-3 text-xs text-slate-600">
                    Custom roles:{" "}
                    {crew
                      .filter((c) => c.roleKey === "custom")
                      .map((c) => c.displayName)
                      .join(", ")}
                  </div>
                )}
              </div>
            </Card>

            {/* Readiness */}
            <Card>
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-slate-500" />
                  <div>
                    <div className="font-medium">ARP4754B Readiness</div>
                    <div className="text-sm text-slate-600">
                      Live completeness checks (essentials only).
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">{completeness}%</div>
                  <div className="text-xs text-slate-500">Essentials covered</div>
                </div>
              </div>
              <div className="px-5 pb-5 space-y-2">
                <CheckRow ok={projectName.trim().length > 0} text="Project named" />
                <CheckRow ok={systemContext.trim().length > 0} text="System context sketched" />
                <CheckRow ok={crew.length > 0} text="Crew selected (comprehensive set)" />
                <CheckRow ok={crew.every((c) => !!c.topNeeds)} text="Needs captured (per stakeholder)" />
                <CheckRow ok={crew.every((c) => !!c.keyConstraints)} text="Constraints captured" />
                <CheckRow ok={crew.every((c) => !!c.acceptanceHints)} text="Acceptance hints captured" />
              </div>
            </Card>
          </div>

          {/* 3) Detail one member at a time */}
          <div className="lg:col-span-4 space-y-6">
            <Card>
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ClipboardList className="h-5 w-5 text-slate-500" />
                  <div>
                    <div className="font-medium">Detail a crew member</div>
                    <div className="text-sm text-slate-600">
                      Focus on essentials; expand advanced when ready.
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  {crew.length} selected
                </div>
              </div>

              {/* Selector */}
              <div className="px-5 pb-4 flex gap-2 overflow-x-auto">
                {crew.map((c) => {
                  const Icon = ROLE_LIBRARY[c.roleKey]?.icon || Users;
                  const active = c.id === activeStakeholderId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveStakeholderId(c.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap ${
                        active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"
                      }`}
                      title={ROLE_LIBRARY[c.roleKey]?.hint}
                    >
                      <Icon className={`h-4 w-4 ${active ? "text-emerald-600" : "text-slate-500"}`} />
                      <span className="truncate max-w-[220px]">{c.displayName}</span>
                    </button>
                  );
                })}
              </div>

              {/* Editor */}
              <div className="px-5 pb-5">
                {activeStakeholder ? (
                  <div className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm text-slate-700">Display name</label>
                        <input
                          value={activeStakeholder.displayName}
                          onChange={(e) => updateActive({ displayName: e.target.value })}
                          className="mt-1 w-full rounded-lg border px-3 py-2"
                        />
                        <div className="mt-1 text-xs text-slate-500">
                          Keep it human—this doubles as a persona label.
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm text-slate-700">Influence</label>
                          <select
                            value={activeStakeholder.influence || "Medium"}
                            onChange={(e) => updateActive({ influence: e.target.value as any })}
                            className="mt-1 w-full rounded-lg border px-3 py-2"
                          >
                            <option>Low</option><option>Medium</option><option>High</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-sm text-slate-700">Interest</label>
                          <select
                            value={activeStakeholder.interest || "High"}
                            onChange={(e) => updateActive({ interest: e.target.value as any })}
                            className="mt-1 w-full rounded-lg border px-3 py-2"
                          >
                            <option>Low</option><option>Medium</option><option>High</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Essentials first */}
                    <div className="grid md:grid-cols-3 gap-4">
                      <Field
                        label="Top needs"
                        placeholder="What outcomes matter most to them?"
                        value={activeStakeholder.topNeeds || ""}
                        onChange={(v) => updateActive({ topNeeds: v })}
                        tip="Drives aircraft/system requirements"
                      />
                      <Field
                        label="Key constraints"
                        placeholder="Limits they impose (cost, weight, procedures...)"
                        value={activeStakeholder.keyConstraints || ""}
                        onChange={(v) => updateActive({ keyConstraints: v })}
                        tip="Informs boundaries/trade space"
                      />
                      <Field
                        label="Acceptance hints"
                        placeholder="How they'll judge success (e.g., dispatch ≥ 99.5%)"
                        value={activeStakeholder.acceptanceHints || ""}
                        onChange={(v) => updateActive({ acceptanceHints: v })}
                        tip="Seeds validation criteria"
                      />
                    </div>

                    {/* Advanced (collapsed) */}
                    <div>
                      <button
                        onClick={() => setShowAdvanced((s) => !s)}
                        className="inline-flex items-center gap-2 text-sm text-slate-700"
                      >
                        {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        Advanced (interfaces, scenarios, notes)
                      </button>
                      <AnimatePresence initial={false}>
                        {showAdvanced && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="mt-3 grid md:grid-cols-3 gap-4"
                          >
                            <Field
                              label="Interfaces"
                              placeholder="Operational/physical/info interfaces"
                              value={activeStakeholder.interfaces || ""}
                              onChange={(v) => updateActive({ interfaces: v })}
                            />
                            <Field
                              label="Typical scenarios"
                              placeholder="Where/when they interact with the system"
                              value={activeStakeholder.scenarios || ""}
                              onChange={(v) => updateActive({ scenarios: v })}
                            />
                            <Field
                              label="Notes"
                              placeholder="Anything tribal you don't want to forget"
                              value={activeStakeholder.notes || ""}
                              onChange={(v) => updateActive({ notes: v })}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600">Select a crew member to edit.</div>
                )}
              </div>
            </Card>

            {/* 4) Visual nudge: Influence × Interest */}
            <Card>
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <LineChart className="h-5 w-5 text-slate-500" />
                  <div>
                    <div className="font-medium">Influence × Interest (quick map)</div>
                    <div className="text-sm text-slate-600">Helps plan engagement & validation ownership.</div>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5">
                <div className="grid grid-cols-3 gap-3">
                  {(["High","Medium","Low"] as const).map((inf) =>
                    (["High","Medium","Low"] as const).map((int) => (
                      <div key={`${inf}-${int}`} className="rounded-lg border p-3">
                        <div className="text-xs font-medium text-slate-600">
                          Influence {inf} / Interest {int}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {crew
                            .filter((c) => (c.influence || "Medium") === inf && (c.interest || "High") === int)
                            .map((c) => (
                              <span
                                key={c.id}
                                className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                {c.displayName}
                              </span>
                            ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Footer nudge */}
        <div className="text-xs text-slate-500">
          Tip: ARP4754B expects early identification of stakeholders and their needs/constraints to seed aircraft/system requirements and validation. Keep it light now; you’ll refine during FHA, requirements derivation, and V&V planning.
        </div>
      </div>
    </div>
  );
}

/* ---------- small helpers ---------- */

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  tip?: string;
}> = ({ label, value, onChange, placeholder, tip }) => (
  <div>
    <label className="text-sm text-slate-700">{label}</label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mt-1 w-full rounded-lg border px-3 py-2 min-h-[42px]"
    />
    {tip && <div className="mt-1 text-xs text-slate-500">{tip}</div>}
  </div>
);

const CheckRow: React.FC<{ ok: boolean; text: string }> = ({ ok, text }) => (
  <div className="flex items-center gap-2 text-sm">
    {ok ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : (
      <AlertTriangle className="h-4 w-4 text-amber-500" />
    )}
    <span className={ok ? "text-slate-800" : "text-slate-600"}>{text}</span>
  </div>
);
