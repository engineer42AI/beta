"use client";

import React from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

/* =============================================================
   V2.5 — Columnar Functional Ontology Explorer
   - Resizable columns (shadcn)
   - ATA Validation Drawer with:
       • Categories  • -00 Chapter list with titles  • Details (selected -00 description + included subchapters)
       • Preview + Apply/Clear highlighting for matching L3/L2/L1
   - L3 no longer expands to ATA in column UI (we surface ATAs only in the drawer)
   ============================================================= */

/* -----------------------------
   Types
----------------------------- */

type CanonKind = "AIRCRAFT" | "Function_L1" | "Function_L2" | "Function_L3" | "ATA" | "Unknown";

type Bundle = { nodes?: Record<string, any[]>; edges?: Record<string, any[]> };

type GraphNode = { id: string; name: string; kind: CanonKind; raw: any };

type GraphEdge = { source: string; target: string; relation?: string };

type Graph = { nodes: Map<string, GraphNode>; out: Map<string, GraphEdge[]> };

/* -----------------------------
   Relations (keep in sync with backend)
----------------------------- */
const REL = {
  L1_HAS_L2: "L1_HAS_L2",
  L2_HAS_L3: "L2_HAS_L3",
  L3_TO_ATA: "L3_LINKS_TO_ATA",
} as const;

/* -----------------------------
   ATA categories (coarse groupings per ATA-100 common ranges)
----------------------------- */
const ATA_CATEGORIES: { key: string; label: string; range: [number, number] }[] = [
  { key: "general",      label: "Aircraft General (00–19)", range: [0, 19] },
  { key: "systems",      label: "Airframe Systems (20–50)", range: [20, 50] },
  { key: "structures",   label: "Structures (51–57)",        range: [51, 57] },
  { key: "propsrotors",  label: "Propellers/Rotors (60–67)", range: [60, 67] },
  { key: "powerplant",   label: "Power Plant (70–85)",       range: [70, 85] },
  { key: "misc",          label: "Miscellaneous (91–116)",     range: [91, 116] },
];

/* -----------------------------
   Chapter titles (Wikipedia — ATA 100). Keys are 2‑digit strings (e.g. "74").
----------------------------- */
const CHAPTER_TITLES: Record<string, string> = {
  // Aircraft General (00–19)
  "00": "General",
  "01": "Maintenance Policy",
  "02": "Operations",
  "03": "Support",
  "04": "Airworthiness Limitations",
  "05": "Time Limits / Maintenance Checks",
  "06": "Dimensions and Areas",
  "07": "Lifting and Shoring",
  "08": "Leveling and Weighing",
  "09": "Towing and Taxiing",
  "10": "Parking, Mooring, Storage & Return to Service",
  "11": "Placards and Markings",
  "12": "Servicing",
  "13": "Hardware and General Tools",
  "15": "Aircrew Information",
  "16": "Change of Role",
  "18": "Vibration and Noise Analysis (Helicopter Only)",
  // Airframe Systems (20–49)
  "20": "Standard Practices – Airframe",
  "21": "Air Conditioning and Pressurization",
  "22": "Auto Flight",
  "23": "Communications",
  "24": "Electrical Power",
  "25": "Equipment / Furnishings",
  "26": "Fire Protection",
  "27": "Flight Controls",
  "28": "Fuel",
  "29": "Hydraulic Power",
  "30": "Ice and Rain Protection",
  "31": "Indicating / Recording Systems",
  "32": "Landing Gear",
  "33": "Lights",
  "34": "Navigation",
  "35": "Oxygen",
  "36": "Pneumatic",
  "37": "Vacuum",
  "38": "Water / Waste",
  "39": "Electrical–Electronic Panels & Multipurpose Components",
  "40": "Multisystem",
  "41": "Water Ballast",
  "42": "Integrated Modular Avionics",
  "43": "Emergency Solar Panel System (ESPS)",
  "44": "Cabin Systems",
  "45": "Onboard Maintenance Systems (OMS)",
  "46": "Information Systems",
  "47": "Inert Gas System",
  "48": "In‑flight Fuel Dispensing",
  "49": "Auxiliary Power Unit (APU)",
  "50": "Cargo and Accessory Compartments",
  // Structures (51–57)
  "51": "Standard Practices and Structures – General",
  "52": "Doors",
  "53": "Fuselage",
  "54": "Nacelles / Pylons",
  "55": "Stabilizers",
  "56": "Windows",
  "57": "Wings",
  // Propeller/Rotors (60–67)
  "60": "Standard Practices – Propeller / Rotor",
  "61": "Propeller / Propulsors",
  "62": "Main Rotor(s)",
  "63": "Main Rotor Drive(s)",
  "64": "Tail Rotor",
  "65": "Tail Rotor Drive",
  "66": "Folding Blades / Pylon",
  "67": "Rotors and Flight Controls",
  // Power Plant (70–85)
  "70": "Standard Practices – Engine",
  "71": "Power Plant",
  "72": "Engine",
  "73": "Engine – Fuel and Control",
  "74": "Ignition",
  "75": "Bleed Air",
  "76": "Engine Controls",
  "77": "Engine Indicating",
  "78": "Exhaust",
  "79": "Oil",
  "80": "Starting",
  "81": "Turbines (Reciprocating Engines)",
  "82": "Water Injection",
  "83": "Accessory Gear Box (Engine Driven)",
  "84": "Propulsion Augmentation",
  "85": "Fuel Cell Systems",
  // Misc / reserved (90–99)
  "91": "Charts",
  "97": "Wiring Reporting",
  "98": "Meteorological & Atmospheric Research (Military)",
  "99": "Electronic Warfare System (Military)",
};

const codeToLabel = (code: string) => {
  const cc = code.slice(0, 2);
  const title = CHAPTER_TITLES[cc] || `Chapter ${cc}`;
  return `${code} — ${title} (General)`;
};

/* -----------------------------
   Graph helpers
----------------------------- */
function classify(n: any): CanonKind {
  if (n?.type === "function") {
    const lvl = String(n?.label ?? "").toUpperCase();
    if (lvl === "L1") return "Function_L1";
    if (lvl === "L2") return "Function_L2";
    if (lvl === "L3") return "Function_L3";
  }
  if (String(n?.label ?? "").toUpperCase() === "ATA" || n?.chapter) return "ATA";
  return "Unknown";
}
function getNodeId(n: any) { return n?.uuid_function || n?.uuid_ata || n?.uuid || null; }

function buildGraphFromBundle(bundle: Bundle): Graph {
  const nodes = new Map<string, GraphNode>();
  const out = new Map<string, GraphEdge[]>();

  for (const arr of Object.values(bundle.nodes ?? {})) {
    (arr || []).forEach((n) => {
      const id = getNodeId(n); if (!id) return;
      const kind = classify(n);
      const name = n?.name ?? n?.chapter ?? n?.label ?? "Untitled";
      nodes.set(id, { id, name, kind, raw: n });
      if (!out.has(id)) out.set(id, []);
    });
  }
  for (const arr of Object.values(bundle.edges ?? {})) {
    (arr || []).forEach((e) => {
      const { source, target, relation } = e || {};
      if (!source || !target) return;
      if (!out.has(source)) out.set(source, []);
      out.get(source)!.push({ source, target, relation });
    });
  }
  return { nodes, out };
}

/* -----------------------------
   Children lookup per level (no L3 -> ATA in UI)
----------------------------- */
function childrenOf(G: Graph, id: string): string[] {
  if (id === "AIRCRAFT") {
    return Array.from(G.nodes.values())
      .filter((n) => n.kind === "Function_L1")
      .map((n) => n.id)
      .sort((a, b) => G.nodes.get(a)!.name.localeCompare(G.nodes.get(b)!.name));
  }
  const n = G.nodes.get(id);
  if (!n) return [];
  if (n.kind === "Function_L1")
    return (G.out.get(id) || [])
      .filter((e) => e.relation === REL.L1_HAS_L2)
      .map((e) => e.target);
  if (n.kind === "Function_L2")
    return (G.out.get(id) || [])
      .filter((e) => e.relation === REL.L2_HAS_L3)
      .map((e) => e.target);
  return [];
}

/* -----------------------------
   ATA helpers (drawer) — no regex to avoid editor replacement issues
----------------------------- */
function chapterPrefix(ch?: string): number | null {
  if (!ch || ch.length < 2) return null;
  const two = ch.slice(0, 2);
  const n = Number(two);
  return Number.isNaN(n) ? null : n;
}
function chapterCodeIs00(ch?: string): boolean {
  return !!ch && ch.length >= 5 && ch[2] === '-' && ch.slice(3, 5) === '00';
}
function inRange(prefix: number | null, range: [number, number]) {
  return prefix != null && prefix >= range[0] && prefix <= range[1];
}

/** Return list of available -00 codes (e.g. "74-00") within the category that actually exist in the graph */
function getATA00ByCategory(G: Graph | null, catKey: string | null): string[] {
  if (!G || !catKey) return [];
  const cat = ATA_CATEGORIES.find((c) => c.key === catKey); if (!cat) return [];
  const out: string[] = [];
  for (const node of G.nodes.values()) {
    if (node.kind !== "ATA") continue;
    const ch: string | undefined = node.raw?.chapter || node.name;
    const pref = chapterPrefix(ch);
    if (chapterCodeIs00(ch) && inRange(pref, cat.range)) out.push(ch!);
  }
  return Array.from(new Set(out)).sort();
}

/** For a selected -00 code, gather the -00 node and all included subchapters from the graph */
function getATAFamily(G: Graph | null, code: string | null) {
  const result: { root: GraphNode | null; subs: GraphNode[] } = { root: null, subs: [] };
  if (!G || !code) return result;
  const prefix = code.slice(0, 3); // e.g. "74-"
  for (const n of G.nodes.values()) {
    if (n.kind !== "ATA") continue;
    const ch: string = n.raw?.chapter || n.name || "";
    if (!ch.startsWith(prefix)) continue;
    if (chapterCodeIs00(ch)) result.root = n; else result.subs.push(n);
  }
  result.subs.sort((a, b) => {
    const aa = Number((a.raw?.chapter || a.name || "").slice(3, 5));
    const bb = Number((b.raw?.chapter || b.name || "").slice(3, 5));
    return aa - bb;
  });
  return result;
}

/* Highlight computation: nodes (L3 core + L2/L1 ancestors) touched by selected -00 prefixes */
function computeATAHighlightSets(G: Graph | null, selected00: Set<string>) {
  const res = { l3: new Set<string>(), l2: new Set<string>(), l1: new Set<string>() };
  if (!G || selected00.size === 0) return res;
  const prefixes = Array.from(selected00).map((code) => code.slice(0, 3));
  const ataIds = new Set<string>();
  for (const n of G.nodes.values()) {
    if (n.kind !== "ATA") continue;
    const ch: string = n.raw?.chapter || n.name || "";
    if (prefixes.some((p) => ch.startsWith(p))) ataIds.add(n.id);
  }
  if (ataIds.size === 0) return res;
  for (const [src, edges] of G.out.entries()) {
    for (const e of edges) {
      if (e.relation === REL.L3_TO_ATA && ataIds.has(e.target)) {
        const srcNode = G.nodes.get(src);
        if (srcNode?.kind === "Function_L3") res.l3.add(src);
      }
    }
  }
  for (const [src, edges] of G.out.entries()) {
    for (const e of edges) {
      if (e.relation === REL.L2_HAS_L3 && res.l3.has(e.target)) res.l2.add(src);
    }
  }
  for (const [src, edges] of G.out.entries()) {
    for (const e of edges) {
      if (e.relation === REL.L1_HAS_L2 && res.l2.has(e.target)) res.l1.add(src);
    }
  }
  return res;
}

function applyATAHighlight(
  G: Graph | null,
  selected00: Set<string>,
  setHlCore: React.Dispatch<React.SetStateAction<Set<string>>>,
  setHlAnc: React.Dispatch<React.SetStateAction<Set<string>>>
) {
  const { l3, l2, l1 } = computeATAHighlightSets(G, selected00);
  const ancestors = new Set<string>([...l2, ...l1]);
  setHlCore(l3);
  setHlAnc(ancestors);
}

/* -----------------------------
   UI atoms
----------------------------- */
function LevelBadge({ kind }: { kind: CanonKind }) {
  const text =
    kind === "Function_L1" ? "L1" :
    kind === "Function_L2" ? "L2" :
    kind === "Function_L3" ? "L3" :
    kind === "ATA" ? "ATA" :
    kind === "AIRCRAFT" ? "ROOT" : "";
  if (!text) return null;
  return <span className="ont-badge">{text}</span>;
}

function IconButton({ title, onClick, children }: { title: string; onClick?: React.MouseEventHandler; children: React.ReactNode; }) {
  return (
    <button onClick={onClick} title={title} className="h-6 w-6 inline-flex items-center justify-center rounded border hover:bg-accent text-xs">
      {children}
    </button>
  );
}

/* -----------------------------
   Column component
----------------------------- */

type Column = { parentId: string; label: string; rows: string[]; expandedRowId?: string | null };

function ColumnView({ G, column, onExpand, onCollapse, onInspect, hlCore, hlAnc }: {
  G: Graph; column: Column; onExpand: (nodeId: string) => void; onCollapse: (nodeId: string) => void; onInspect: (nodeId: string) => void; hlCore: Set<string>; hlAnc: Set<string>;
}) {
  return (
    <div className="ont-col">
      <div className="ont-col-header flex-none">{column.label}</div>
      <ul className="ont-col-list ont-scroll flex-1 min-h-0">
        {column.rows.map((id) => {
          const n = G.nodes.get(id)!;
          const isExpanded = column.expandedRowId === id;
          const tone = hlCore.has(id) ? "bg-destructive/15 border-destructive/40" : hlAnc.has(id) ? "bg-destructive/10 border-destructive/30" : "";
          return (
            <li key={id} className={`ont-row ${isExpanded ? "ont-row--active" : ""} ${tone}`} aria-expanded={isExpanded}>
              <div className="flex items-center min-w-0">
                <LevelBadge kind={n.kind} />
                <span className="text-sm truncate" title={n.name}>{n.name}</span>
              </div>
              <div className="flex items-center gap-1">
                {isExpanded ? (
                  <IconButton title="Collapse children" onClick={() => onCollapse(id)}>-</IconButton>
                ) : (
                  <IconButton title="Show children" onClick={() => onExpand(id)}>+</IconButton>
                )}
                <IconButton title="Show info" onClick={() => onInspect(id)}>i</IconButton>
              </div>
            </li>
          );
        })}
        {!column.rows.length && (
          <div className="text-xs text-muted-foreground px-2 py-3">No children.</div>
        )}
      </ul>
    </div>
  );
}

/* -----------------------------
   Inspector (right side panel)
----------------------------- */
function Inspector({ G, nodeId, onClose }: { G: Graph; nodeId: string | null; onClose: () => void }) {
  if (!nodeId) return null; const n = G.nodes.get(nodeId); if (!n) return null;
  return (
    <div className="h-full flex flex-col">
      <div className="h-10 px-3 border-b flex items-center justify-between sticky top-0 bg-card z-10">
        <div className="text-sm font-semibold truncate" title={n.name}>{n.name}</div>
        <button className="h-7 px-2 rounded border text-xs" onClick={onClose}>Close</button>
      </div>
      <div className="p-3 space-y-3 text-sm overflow-auto ont-scroll">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><LevelBadge kind={n.kind} /> <span>#{n.id}</span></div>
        {n.kind === "ATA" && n.raw?.chapter && (
          <div className="text-xs">ATA Chapter: <strong>{n.raw.chapter}</strong></div>
        )}
        {n.raw?.description && (
          <section>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Description</div>
            <p className="leading-5 text-[13px] whitespace-pre-wrap">{n.raw.description}</p>
          </section>
        )}
        <section>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Raw</div>
          <pre className="text-xs bg-muted/30 rounded p-2 max-h-72 overflow-auto ont-scroll">{JSON.stringify(n.raw, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}

/* -----------------------------
   Page
----------------------------- */
export default function Page() {
  const [graph, setGraph] = React.useState<Graph | null>(null);
  const [columns, setColumns] = React.useState<Column[]>([]);
  const [inspectingId, setInspectingId] = React.useState<string | null>(null);

  // Drawer / ATA selection
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);
  const [selectedChapters, setSelectedChapters] = React.useState<Set<string>>(new Set());
  const [activeCode, setActiveCode] = React.useState<string | null>(null); // which -00 to show details for

  // Highlight state
  const [hlCore, setHlCore] = React.useState<Set<string>>(new Set()); // L3 matches
  const [hlAnc, setHlAnc] = React.useState<Set<string>>(new Set());   // L2 + L1 ancestors

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/pre-arch-graph", { cache: "no-store" });
        const bundle = await res.json();
        if (!alive) return;
        const G = buildGraphFromBundle(bundle);
        setGraph(G);
        // Bootstrap UI with a single column for the AIRCRAFT root
        const rootCol: Column = { parentId: "AIRCRAFT", label: "AIRCRAFT", rows: ["AIRCRAFT"], expandedRowId: null };
        setColumns([rootCol]);
        setLoading(false);
      } catch (e: any) {
        setError(String(e?.message || e));
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const expand = React.useCallback((nodeId: string) => {
    if (!graph) return;

    if (nodeId === "AIRCRAFT") {
      const nextRows = childrenOf(graph, "AIRCRAFT");
      setColumns((cols) => {
        const updated = [...cols];
        updated[0] = { ...updated[0], expandedRowId: "AIRCRAFT" };
        const col1: Column = { parentId: "AIRCRAFT", label: "Level 1 Functions", rows: nextRows, expandedRowId: null };
        return [updated[0], col1];
      });
      return;
    }

    setColumns((cols) => {
      const idx = cols.findIndex((c) => c.rows.includes(nodeId));
      if (idx === -1) return cols;

      const children = childrenOf(graph, nodeId);
      // If no children (e.g., L3), just mark row as expanded; don’t add a new empty column
      if (!children.length) {
        return cols.map((c, i) => (i === idx ? { ...c, expandedRowId: nodeId } : c));
      }

      const updated = cols.slice(0, idx + 1);
      updated[idx] = { ...updated[idx], expandedRowId: nodeId };

      const kind = graph.nodes.get(nodeId)!.kind;
      const nextLabel = kind === "Function_L1" ? "Level 2 Functions"
                      : kind === "Function_L2" ? "Level 3 Functions"
                      : "Children";

      updated.push({ parentId: nodeId, label: nextLabel, rows: children, expandedRowId: null });
      return updated;
    });
  }, [graph]);

  const collapse = React.useCallback((nodeId: string) => {
    setColumns((cols) => {
      const idx = cols.findIndex((c) => c.rows.includes(nodeId));
      if (idx === -1) return cols;
      const updated = cols.slice(0, idx + 1);
      updated[idx] = { ...updated[idx], expandedRowId: null };
      return updated;
    });
  }, []);

  const inspect = React.useCallback((nodeId: string) => setInspectingId(nodeId), []);

  // keep activeCode sensible when category changes
  React.useEffect(() => {
    if (!graph || !selectedCategory) { setActiveCode(null); return; }
    const list = getATA00ByCategory(graph, selectedCategory);
    if (!list.length) { setActiveCode(null); return; }
    if (!activeCode || !list.includes(activeCode)) setActiveCode(list[0]);
  }, [graph, selectedCategory]);

  if (loading) return <div className="p-6 text-sm">Loading ontology…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Error: {error}</div>;
  if (!graph) return null;

  // Ensure ROOT
  if (!graph.nodes.has("AIRCRAFT")) {
    graph.nodes.set("AIRCRAFT", { id: "AIRCRAFT", name: "AIRCRAFT", kind: "AIRCRAFT", raw: { ntype: "AIRCRAFT" } });
  }

  const panelCount = columns.length + (inspectingId ? 1 : 0);
  const defaultPanelPct = Math.max(12, Math.min(28, Math.floor(100 / Math.max(1, panelCount))));

  // Details for active -00 in drawer
  const family = getATAFamily(graph, activeCode);
  const preview = computeATAHighlightSets(graph, selectedChapters);

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Header */}
      <div className="h-11 border-b px-3 flex items-center gap-2 bg-background sticky top-0 z-20">
        <strong className="text-sm">Functional Ontology</strong>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden md:block">Click [+] to drill down. Use the info (i) to view details. Click [-] to collapse. Drag the handles between panels to resize.</span>

          {/* ATA Validation */}
          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DrawerTrigger asChild>
              <Button variant="outline" size="sm">ATA Validation</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>ATA Coverage Validation</DrawerTitle>
                <DrawerDescription>Select a category and one or more <code>-00</code> chapters. We’ll highlight related L3 functions and their L2/L1 ancestors.</DrawerDescription>
              </DrawerHeader>

              <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[68vh] overflow-auto">
                {/* Categories */}
                <div className="col-span-1 border rounded-md p-2">
                  <div className="text-xs font-medium mb-2">Categories</div>
                  <ul className="space-y-1">
                    {ATA_CATEGORIES.map((c) => (
                      <li key={c.key}>
                        <button
                          className={`w-full text-left px-2 py-1.5 rounded border ${selectedCategory === c.key ? "bg-accent/60 border-foreground/20" : "bg-background hover:bg-accent/50"}`}
                          onClick={() => setSelectedCategory(c.key)}
                        >
                          <div className="text-sm font-medium">{c.label}</div>
                          <div className="text-[11px] text-muted-foreground">Range {c.range[0].toString().padStart(2, "0")}–{c.range[1]}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* -00 list */}
                <div className="col-span-1 border rounded-md p-2">
                  <div className="text-xs font-medium mb-2">Chapters (‑00 only)</div>
                  <ul className="space-y-1 max-h-[52vh] overflow-auto ont-scroll">
                    {selectedCategory ? (
                      (() => {
                        const list = getATA00ByCategory(graph, selectedCategory);
                        if (!list.length) return <div className="text-xs text-muted-foreground">No -00 chapters found in this category.</div>;
                        return list.map((code) => (
                          <li key={code}>
                            <label className={`flex items-center gap-2 px-2 py-1.5 rounded border bg-background hover:bg-accent/40 ${activeCode === code ? "ring-1 ring-ring" : ""}`}
                                   onClick={() => setActiveCode(code)}>
                              <input
                                type="checkbox"
                                checked={selectedChapters.has(code)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setSelectedChapters((prev) => { const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next; });
                                  setActiveCode(code);
                                }}
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{code}</div>
                                <div className="text-[12px] text-muted-foreground truncate">{codeToLabel(code).slice(7)}</div>
                              </div>
                            </label>
                          </li>
                        ));
                      })()
                    ) : (
                      <div className="text-xs text-muted-foreground">Choose a category to see chapters.</div>
                    )}
                  </ul>
                </div>

                {/* Details for selected -00: description + included subchapters */}
                <div className="col-span-1 border rounded-md p-2 flex flex-col">
                  <div className="text-xs font-medium mb-2">Details</div>
                  {!activeCode && (
                    <div className="text-xs text-muted-foreground">Select a -00 chapter to see its description and included subchapters found in the dataset.</div>
                  )}
                  {activeCode && (
                    <div className="space-y-3 overflow-auto ont-scroll">
                      <div>
                        <div className="text-sm font-semibold mb-1">{codeToLabel(activeCode)}</div>
                        <div className="text-xs text-muted-foreground">Description of -00 (from data):</div>
                        <p className="text-sm mt-1 whitespace-pre-wrap">
                          {family.root?.raw?.description || "No description found in the dataset for this -00 chapter."}
                        </p>
                      </div>
                      <div>
                        <div className="text-sm font-semibold mb-1">Included subchapters</div>
                        {!family.subs.length && <div className="text-xs text-muted-foreground">No subchapters for this family were found in the dataset.</div>}
                        <ul className="space-y-1 max-h-[34vh] overflow-auto ont-scroll pr-1">
                          {family.subs.map((n) => {
                            const ch: string = n.raw?.chapter || n.name || "";
                            return (
                              <li key={n.id} className="rounded border px-2 py-1.5 bg-background/80">
                                <div className="text-sm font-medium">{ch}</div>
                                {n.raw?.description && (
                                  <div className="text-[12px] text-muted-foreground whitespace-pre-wrap mt-0.5">{n.raw.description}</div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>

                {/* Preview + actions */}
                <div className="col-span-1 border rounded-md p-2 flex flex-col">
                  <div className="text-xs font-medium mb-2">Preview</div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>Selected chapters: <strong>{selectedChapters.size}</strong></div>
                    <div>Would highlight L3: <strong>{preview.l3.size}</strong> | Ancestors (L2+L1): <strong>{preview.l2.size + preview.l1.size}</strong></div>
                    {!!preview.l3.size && <div className="text-[11px]">Core rows use a slightly stronger red tint than ancestors.</div>}
                  </div>
                  <div className="mt-auto flex gap-2 pt-2">
                    <Button size="sm" onClick={() => applyATAHighlight(graph, selectedChapters, setHlCore, setHlAnc)}>Apply highlight</Button>
                    <Button size="sm" variant="secondary" onClick={() => { setSelectedChapters(new Set()); setHlCore(new Set()); setHlAnc(new Set()); }}>Clear</Button>
                    <DrawerClose asChild><Button size="sm" variant="outline">Close</Button></DrawerClose>
                  </div>
                </div>
              </div>

              <DrawerFooter className="hidden" />
            </DrawerContent>
          </Drawer>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {columns.map((c, i) => (
            <React.Fragment key={i}>
              <ResizablePanel defaultSize={defaultPanelPct} minSize={12} collapsible>
                <div className="h-full w-full border-r flex flex-col">
                  <ColumnView
                    G={graph}
                    column={c}
                    onExpand={expand}
                    onCollapse={collapse}
                    onInspect={inspect}
                    hlCore={hlCore}
                    hlAnc={hlAnc}
                  />
                </div>
              </ResizablePanel>
              {i < columns.length - 1 && <ResizableHandle withHandle />}
            </React.Fragment>
          ))}

          {inspectingId && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={defaultPanelPct} minSize={16} collapsible>
                <div className="h-full w-full bg-card border-l">
                  <Inspector G={graph} nodeId={inspectingId} onClose={() => setInspectingId(null)} />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Footer */}
      <div className="h-11 border-t px-3 flex items-center gap-2 bg-background text-xs text-muted-foreground">
        <span>Tip: Resize panels to reveal longer titles. Use ATA Validation to explore coverage and highlight related functions.</span>
      </div>
    </div>
  );
}
