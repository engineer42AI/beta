"use client";
import React, { useEffect, useMemo, useState } from "react";
import PdfViewer from "@/components/PdfViewer";

/** ===== Types kept from your code ===== */
type TraceNode = {
  uuid: string;
  node_ntype: string;
  node_uuid_key: string;
  node_label: string;
  node_classification?: string;
  node_classification_reason?: string;
};

type CitationRow = {
  node_uuid: string;
  node_ntype: string;
  direction: "inbound" | "outbound";
  source: string;
  target: string;
  source_ntype?: string;
  target_ntype?: string;
  ref?: {
    ref_source?: string;
    ref_target?: string;
    role?: string;
    comment?: string;
  };
};

/* ========== Tiny graph + ops (TS port) ========== */
type NodeData = Record<string, any>;
type EdgeData = { source: string; target: string; relation?: string; ref?: any };
type Bundle   = { nodes?: Record<string, any[]>; edges?: Record<string, any[]> };

class MultiDiGraph {
  nodes: Map<string, NodeData> = new Map();
  out: Map<string, EdgeData[]> = new Map();
  _in: Map<string, EdgeData[]> = new Map();
  addNode(id: string, data: NodeData) {
    this.nodes.set(id, { ...(this.nodes.get(id) || {}), ...data });
    if (!this.out.has(id)) this.out.set(id, []);
    if (!this._in.has(id)) this._in.set(id, []);
  }
  addEdge(source: string, target: string, relation?: string, ref?: any) {
    const ed: EdgeData = { source, target, relation, ref };
    if (!this.out.has(source)) this.out.set(source, []);
    if (!this._in.has(target)) this._in.set(target, []);
    this.out.get(source)!.push(ed);
    this._in.get(target)!.push(ed);
  }
  hasNode(id: string) { return this.nodes.has(id); }
  node(id: string) { return this.nodes.get(id); }
  outEdges(id: string) { return this.out.get(id) || []; }
  inEdges(id: string) { return this._in.get(id) || []; }
  numberOfNodes() { return this.nodes.size; }
  numberOfEdges() { let n=0; for (const [,arr] of this.out) n+=arr.length; return n; }
}

function buildGraphFromBundle(bundle: Bundle) {
  const G = new MultiDiGraph();
  const getNodeId = (n: any) =>
    n?.uuid_document || n?.uuid_subpart || n?.uuid_heading || n?.uuid_section ||
    n?.uuid_guidance || n?.uuid_paragraph || n?.uuid_trace || n?.uuid_intent;

  for (const arr of Object.values(bundle.nodes ?? {})) {
    (arr || []).forEach(n => { const id = getNodeId(n); if (id) G.addNode(id, n); });
  }
  for (const arr of Object.values(bundle.edges ?? {})) {
    (arr || []).forEach((e: any) => {
      const { source, target, relation, ref } = e || {};
      if (source && target && G.hasNode(source) && G.hasNode(target)) {
        G.addEdge(source, target, relation, ref);
      }
    });
  }
  return G;
}

class GraphOps {
  G: MultiDiGraph;
  constructor(G: MultiDiGraph) { this.G = G; }

  findSectionByNumber(section: string) {
    for (const [, d] of this.G.nodes) {
      if (d?.ntype === "Section" && d?.number === section) return d?.uuid_section ?? d?.uuid;
    }
    return null;
  }
  getSectionLabel(uuid_section: string) {
    const n = this.G.node(uuid_section);
    return (n?.ntype === "Section") ? (n?.label ?? null) : null;
  }
  getParagraphId(uuid_p: string) {
    const n = this.G.node(uuid_p);
    return (n?.ntype === "Paragraph") ? (n?.paragraph_id ?? null) : null;
  }
  getIntentDetailsForSection(uuid_section: string) {
    for (const e of this.G.outEdges(uuid_section)) {
      if (e.relation === "HAS_INTENT") {
        const n = this.G.node(e.target);
        if (n?.ntype === "Intent") return { section_intent: n.section_intent, ai_notes: n.ai_notes };
      }
    }
    return null;
  }
  getIntentDetailsForBottomParagraph(uuid_bottom: string) {
    const inEs = this.G.inEdges(uuid_bottom).filter(e => e.relation === "HAS_ANCHOR");
    if (!inEs.length) return null;
    const traceId = inEs[0].source;
    const outEs = this.G.outEdges(traceId).filter(e => e.relation === "HAS_INTENT");
    if (!outEs.length) return null;
    const intentId = outEs[0].target;
    const n = this.G.node(intentId);
    if (n?.ntype !== "Intent") return null;
    return { intent: n.intent, events: n.events, expert_notes: n.expert_notes };
  }
  findParagraphTracesInSection(uuid_section: string) {
    const traces: Record<string, string[]> = {};
    let counter = 1;

    const recurse = (cur: string, path: string[]) => {
      const nexts = this.G.outEdges(cur).filter(e => e.relation === "CONTAINS")
        .map(e => e.target).filter(t => this.G.node(t)?.ntype === "Paragraph");
      const newPath = [...path, cur];
      if (!nexts.length) { traces[`trace_${counter++}`] = newPath; return; }
      nexts.forEach(n => recurse(n, newPath));
    };

    const starts = this.G.outEdges(uuid_section).filter(e => e.relation === "CONTAINS")
      .map(e => e.target).filter(t => this.G.node(t)?.ntype === "Paragraph");
    starts.forEach(p => recurse(p, []));
    return traces;
  }

  traceUpwardsHierarchy(uuid_bottom: string): TraceNode[] {
    const out: TraceNode[] = [];
    let cur = uuid_bottom;
    while (true) {
      const n = this.G.node(cur);
      if (!n) break;
      const ntype = n.ntype;
      const label =
        ntype === "Paragraph" ? (n.paragraph_id ?? "—") :
        ["Document","Section","Heading","Subpart"].includes(ntype) ? (n.label ?? "—") :
        ntype === "Guidance" ? (n.number ?? "—") : (ntype ?? "node");

      const uuidKey = Object.keys(n).find(k => k.startsWith("uuid_")) || "uuid";
      out.push({
        uuid: cur,
        node_ntype: ntype,
        node_uuid_key: uuidKey,
        node_label: label,
        node_classification: n.classification ?? "",
        node_classification_reason: n.classification_reason ?? "",
      });

      const parent = this.G.inEdges(cur).find(e => e.relation === "CONTAINS");
      if (!parent) break;
      cur = parent.source;
    }
    return out.reverse();
  }

  getCitationDetailsForTraceNodes(trace: TraceNode[]): CitationRow[] {
    const rows: CitationRow[] = [];
    for (const t of trace) {
      const id = t.uuid;
      if (!this.G.hasNode(id)) continue;

      for (const e of this.G.inEdges(id)) {
        if (e.relation !== "CITES") continue;
        rows.push({
          node_uuid: id, node_ntype: t.node_ntype, direction: "inbound",
          source: e.source, target: id, source_ntype: this.G.node(e.source)?.ntype,
          target_ntype: t.node_ntype, ref: e.ref,
        });
      }
      for (const e of this.G.outEdges(id)) {
        if (e.relation !== "CITES") continue;
        rows.push({
          node_uuid: id, node_ntype: t.node_ntype, direction: "outbound",
          source: id, target: e.target, source_ntype: t.node_ntype,
          target_ntype: this.G.node(e.target)?.ntype, ref: e.ref,
        });
      }
    }
    return rows;
  }
}

/** ===== Styling helpers ===== */
const ROLE_LABEL: Record<string, string> = {
  scope_setter: "Scope",
  normative_requirement: "Requirement",
  condition_clause: "Condition",
  exception_clause: "Exception",
  definition: "Definition",
  reference_only: "Reference",
  reserved: "Reserved",
  guidance: "Guidance",
};

const ROLE_BADGE: Record<string, string> = {
  scope_setter: "bg-indigo-100 text-indigo-900 border-indigo-200",
  normative_requirement: "bg-emerald-100 text-emerald-900 border-emerald-200",
  condition_clause: "bg-amber-100 text-amber-900 border-amber-200",
  exception_clause: "bg-rose-100 text-rose-900 border-rose-200",
  definition: "bg-sky-100 text-sky-900 border-sky-200",
  reference_only: "bg-slate-100 text-slate-900 border-slate-200",
  reserved: "bg-gray-100 text-gray-900 border-gray-200",
  guidance: "bg-purple-100 text-purple-900 border-purple-200",
};

function RoleChip({ role }: { role?: string }) {
  const nice = ROLE_LABEL[role || ""] || role || "—";
  const cls = ROLE_BADGE[role || ""] || "bg-muted text-foreground/80 border-border";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {nice}
    </span>
  );
}

function TinyToken({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs border border-border">
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground italic">{children}</div>;
}

/** ===== Page ===== */
export default function RegulatoryExplorer() {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [ops, setOps] = useState<any>(null);

  const [sectionInput, setSectionInput] = useState("");
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [sectionLabel, setSectionLabel] = useState<string | null>(null);
  const [sectionIntent, setSectionIntent] = useState<{ section_intent?: string; ai_notes?: string[] | string } | null>(null);

  const [traces, setTraces] = useState<Record<string, string[]> | null>(null);
  const [selectedTraceKey, setSelectedTraceKey] = useState<string>("");

  const [traceHierarchy, setTraceHierarchy] = useState<TraceNode[]>([]);
  const [traceBottomIntent, setTraceBottomIntent] = useState<{ intent?: string; events?: string[]; expert_notes?: string[] } | null>(null);
  const [citations, setCitations] = useState<CitationRow[]>([]);

  const [tab, setTab] = useState<"overview" | "hierarchy" | "citations">("overview");
  const [citDir, setCitDir] = useState<"all" | "inbound" | "outbound">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const filteredCitations = useMemo(() => {
    let rows = citations;
    if (citDir !== "all") rows = rows.filter((c) => c.direction === citDir);
    if (roleFilter !== "all") rows = rows.filter((c) => (c.ref?.role || "") === roleFilter);
    return rows;
  }, [citations, citDir, roleFilter]);

  // PDF side-by-side toggle
  const [pdfDocked, setPdfDocked] = useState(false);

  const [pdfSearchTerm, setPdfSearchTerm] = useState<string | null>(null);
  const effectiveSearch = pdfSearchTerm ?? currentSectionToken();

  function currentSectionToken() {
      const sec = (sectionLabel || sectionInput || "").replace(/^CS\s*/i, "").trim();
      return sec || "CS-25";
  }



  /** Load graph once */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/reg-graph", { cache: "no-store" });
        if (!res.ok) throw new Error(`Bundle fetch failed: ${res.status}`);
        const bundle = await res.json();
        const G = buildGraphFromBundle(bundle);
        setOps(new GraphOps(G));
        setLoading(false);
      } catch (e: any) {
        setLoadErr(e?.message ?? "Failed to load graph");
        setLoading(false);
      }
    })();
  }, []);

  /** Find section */
  const onFind = () => {
    if (!ops) return;
    const s = sectionInput.trim();
    if (!s) return;

    const id = ops.findSectionByNumber(s);
    setSelectedTraceKey("");
    setTraceHierarchy([]);
    setCitations([]);
    setTab("overview");
    setRoleFilter("all");
    setCitDir("all");

    if (!id) {
      setSectionId(null);
      setSectionLabel(null);
      setSectionIntent(null);
      setTraces(null);
      return;
    }

    setSectionId(id);
    setSectionLabel(ops.getSectionLabel(id));
    setSectionIntent(ops.getIntentDetailsForSection(id));
    const t = ops.findParagraphTracesInSection(id);
    setTraces(Object.keys(t).length ? t : null);

    const first = Object.keys(t || {})?.[0];
    if (first) setSelectedTraceKey(first);
  };

  /** Derived trace rows */
  const traceRows = useMemo(() => {
    if (!ops || !traces) return [];
    return Object.entries(traces).map(([key, uuids]) => {
      const ids = uuids.map((u) => ops.getParagraphId(u) || `(missing:${u})`);
      return {
        key,
        pathTokens: ids,
        bottomUuid: uuids[uuids.length - 1],
      };
    });
  }, [ops, traces]);

  /** When a trace is picked, compute its details */
  useEffect(() => {
    if (!selectedTraceKey || !ops || !traces) return;
    const uuids = traces[selectedTraceKey];
    if (!uuids) return;
    const bottom = uuids[uuids.length - 1];

    setTraceBottomIntent(ops.getIntentDetailsForBottomParagraph(bottom));
    const hierarchy = ops.traceUpwardsHierarchy(bottom);
    setTraceHierarchy(hierarchy);
    setCitations(ops.getCitationDetailsForTraceNodes(hierarchy));
  }, [selectedTraceKey, ops, traces]);

  /** ===== UI ===== */
  return (
    <div className="h-full min-h-0 flex flex-col">
      <main className="flex-1 min-h-0 overflow-auto">
        <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 space-y-4">
          {/* Header with PDF toggle on the right */}
          <header className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Regulatory Explorer</h1>
            <div className="flex items-center gap-3">
              {!loading && !loadErr && (
                <div className="text-xs text-muted-foreground hidden sm:block">
                  Enter an exact section like <code>CS&nbsp;25.20</code>
                </div>
              )}
              <button
                className="rounded-md px-3 py-2 text-sm border bg-background border-border hover:bg-accent"
                onClick={() => setPdfDocked(v => !v)}
                disabled={!sectionId}
                title="Show source PDF side-by-side"
              >
                {pdfDocked ? "Hide PDF" : "Show PDF"}
              </button>
            </div>
          </header>

          {/* Search row */}
          <div className="w-full flex justify-center">
              <div className="bg-card border border-border rounded-[var(--radius)] shadow-sm p-3 sm:p-4 w-fit">
                <div className="flex items-center gap-2">
                  <input
                    className="w-64 flex-none rounded-md bg-background text-foreground border border-input
                               px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={sectionInput}
                    onChange={(e) => setSectionInput(e.target.value)}
                    placeholder="CS 25.20"
                    onKeyDown={(e) => e.key === "Enter" && onFind()}
                  />
                  <button
                    className="rounded-md px-3 py-2 text-sm font-medium bg-primary text-primary-foreground
                               hover:opacity-90 disabled:opacity-50"
                    onClick={onFind}
                    disabled={loading || !!loadErr}
                  >
                    Find
                  </button>
                </div>

                <div className="mt-2 text-sm h-5 text-center">
                  {loading && <span className="text-muted-foreground">Loading graph…</span>}
                  {loadErr && <span className="text-destructive">{loadErr}</span>}
                  {!loadErr && sectionInput && !sectionId && (
                    <span className="text-amber-600">No matching section found.</span>
                  )}
                  {sectionId && (
                    <span className="text-emerald-600">Found {sectionLabel ? `${sectionLabel}` : "section"}.</span>
                  )}
                </div>
              </div>
          </div>


          {/* --- SECTION + RATIONALE (+ optional PDF on the right) --- */}
          {sectionId && (
            pdfDocked ? (
              // Side-by-side: left = cards, right = PDF
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div className="xl:col-span-7 space-y-4">
                  {/* SECTION — OVERALL INTENT */}
                  <div className="bg-card border border-border rounded-[var(--radius)] shadow-sm">
                    <div className="p-4 border-b border-border">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Section</div>
                      <div className="text-lg font-semibold">{sectionLabel || sectionInput}</div>
                    </div>
                    <div className="p-4">
                      <div className="text-sm font-medium mb-1">Overall intent</div>
                      <div className="text-sm">
                        {sectionIntent?.section_intent ? (
                          sectionIntent.section_intent
                        ) : (
                          <Empty>No section intent captured.</Empty>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* SECTION — RATIONALE */}
                  <div className="bg-card border border-border rounded-[var(--radius)] shadow-sm">
                    <div className="p-4">
                      <div className="text-sm font-medium mb-2">Rationale from real events</div>
                      <ul className="list-disc ml-5 text-sm space-y-1">
                        {(Array.isArray(sectionIntent?.ai_notes)
                          ? sectionIntent?.ai_notes
                          : sectionIntent?.ai_notes
                          ? [sectionIntent?.ai_notes]
                          : []
                        ).map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                        {!sectionIntent?.ai_notes && <li className="italic text-muted-foreground">(none)</li>}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Right column: PDF viewer */}
                <div className="xl:col-span-5">
                      <div className="bg-card border border-border rounded-[var(--radius)] shadow-sm overflow-hidden">
                        <PdfViewer
                          key={sectionId || "pdf"}        // ✅ remount only when section changes (or remove the key entirely)
                          fileUrl="/api/regpdf/cs25"
                          searchTerm={effectiveSearch}
                        />
                      </div>
                </div>
              </div>
            ) : (
              // Single column (original)
              <>
                <div className="bg-card border border-border rounded-[var(--radius)] shadow-sm">
                  <div className="p-4 border-b border-border">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Section</div>
                    <div className="text-lg font-semibold">{sectionLabel || sectionInput}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-sm font-medium mb-1">Overall intent</div>
                    <div className="text-sm">
                      {sectionIntent?.section_intent ? (
                        sectionIntent.section_intent
                      ) : (
                        <Empty>No section intent captured.</Empty>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-[var(--radius)] shadow-sm">
                  <div className="p-4">
                    <div className="text-sm font-medium mb-2">Rationale from real events</div>
                    <ul className="list-disc ml-5 text-sm space-y-1">
                      {(Array.isArray(sectionIntent?.ai_notes)
                        ? sectionIntent?.ai_notes
                        : sectionIntent?.ai_notes
                        ? [sectionIntent?.ai_notes]
                        : []
                      ).map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                      {!sectionIntent?.ai_notes && <li className="italic text-muted-foreground">(none)</li>}
                    </ul>
                  </div>
                </div>
              </>
            )
          )}

          {/* --- TRACES + DETAILS (unchanged) --- */}
          {sectionId && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              {/* LEFT: trace list */}
              <aside className="xl:col-span-4 space-y-4 xl:sticky xl:top-16 self-start">
                <div className="bg-card border border-border rounded-[var(--radius)] shadow-sm">
                  <div className="p-4 border-b border-border flex items-center justify-between">
                    <div className="font-semibold">Traces in this section</div>
                    <div className="text-xs text-muted-foreground">{traceRows.length} total</div>
                  </div>

                  <div className="p-2 max-h-[55vh] overflow-auto">
                    {traceRows.length === 0 && <Empty>No paragraph traces found.</Empty>}
                    <ul className="space-y-2">
                      {traceRows.map((t) => (
                        <li key={t.key}>
                          <button
                            onClick={() => {
                              setSelectedTraceKey(t.key);
                              setTab("overview");
                            }}
                            className={`w-full text-left rounded-md border px-3 py-2 hover:bg-accent transition
                              ${selectedTraceKey === t.key ? "border-primary ring-1 ring-primary bg-accent/50" : "border-border"}
                            `}
                          >
                            <div className="text-xs text-muted-foreground mb-1">{t.key.replace("trace_", "Trace ")}</div>
                            <div className="flex flex-wrap gap-1">
                              {t.pathTokens.map((p: string, i: number) => (
                                <TinyToken key={i}>{p}</TinyToken>
                              ))}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </aside>

              {/* RIGHT: trace details (tabs) */}
              <section className="xl:col-span-8 space-y-4">
                <div className="bg-card border border-border rounded-[var(--radius)] shadow-sm">
                  <div className="p-4 border-b border-border">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Selected trace</div>
                    {selectedTraceKey ? (
                      <div className="font-semibold">{selectedTraceKey.replace("trace_", "Trace ")}</div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Choose a trace from the left.</div>
                    )}
                  </div>

                  {/* tabs */}
                  <div className="px-4 pt-3">
                    <div className="flex gap-2">
                      {["overview", "hierarchy", "citations"].map((t) => (
                        <button
                          key={t}
                          className={`px-3 py-1.5 rounded-md text-sm border
                            ${tab === t ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}
                          `}
                          onClick={() => setTab(t as any)}
                          disabled={!selectedTraceKey}
                        >
                          {t === "overview" ? "Overview" : t === "hierarchy" ? "Hierarchy" : "Citations"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-4">
                    {!selectedTraceKey ? (
                      <Empty>Select a trace to see details.</Empty>
                    ) : tab === "overview" ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="lg:col-span-2 mb-2">
                          <button
                            className="px-2 py-1 text-xs border rounded hover:bg-accent"
                            onClick={() => setPdfSearchTerm(traceHierarchy.at(-1)?.node_label ?? null)}
                          >
                            Find bottom clause in PDF
                          </button>
                        </div>
                        <div className="rounded-md border border-border bg-background p-3">
                          <div className="font-medium mb-1">Intent</div>
                          <div className="text-sm">
                            {traceBottomIntent?.intent ? (
                              traceBottomIntent.intent
                            ) : (
                              <Empty>No intent captured for this trace.</Empty>
                            )}
                          </div>
                        </div>

                        <div className="rounded-md border border-border bg-background p-3">
                          <div className="font-medium mb-1">Rationale from real events</div>
                          <ul className="list-disc ml-5 text-sm space-y-1">
                            {Array.isArray(traceBottomIntent?.events) && traceBottomIntent!.events!.length ? (
                              traceBottomIntent!.events!.map((e, i) => <li key={i}>{e}</li>)
                            ) : (
                              <li className="italic text-muted-foreground">(none)</li>
                            )}
                          </ul>
                        </div>

                        <div className="rounded-md border border-border bg-background p-3 lg:col-span-2">
                          <div className="font-medium mb-1">Notes</div>
                          <ul className="list-disc ml-5 text-sm space-y-1">
                            {Array.isArray(traceBottomIntent?.expert_notes) && traceBottomIntent!.expert_notes!.length ? (
                              traceBottomIntent!.expert_notes!.map((e, i) => <li key={i}>{e}</li>)
                            ) : (
                              <li className="italic text-muted-foreground">(none)</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    ) : tab === "hierarchy" ? (
                      <div className="space-y-4">
                        {traceHierarchy.length === 0 ? (
                          <Empty>No hierarchy data for this trace.</Empty>
                        ) : (
                          <div className="relative">
                            {/* left rail */}
                            <div className="absolute left-3 top-0 bottom-0 w-px border-l border-dashed border-border" />

                            <ul className="space-y-3">
                              {traceHierarchy.map((n, idx) => {
                                const isBottom = idx === traceHierarchy.length - 1;
                                return (
                                  <li key={n.uuid} className="relative pl-8">
                                    {/* node marker */}
                                    <span
                                      className={`absolute left-2 top-3 h-2.5 w-2.5 rounded-full bg-muted border border-border
                                        ${isBottom ? "ring-2 ring-primary/60" : ""}`}
                                    />
                                    <div className="rounded-md border border-border bg-background">
                                      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                                        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                                          {(n.node_ntype || "Node").toUpperCase()}
                                        </span>
                                        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs border border-border">
                                          {n.node_label}
                                        </span>
                                        {n.node_classification && <RoleChip role={n.node_classification} />}
                                        {isBottom && (
                                          <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-900">
                                            Bottom clause
                                          </span>
                                        )}
                                      </div>
                                      {n.node_classification_reason && (
                                        <div className="px-3 pb-3">
                                          <div className="rounded bg-muted/40 px-2 py-2 text-sm leading-6">
                                            {n.node_classification_reason}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium mr-2">Filters:</div>
                          {(["all", "inbound", "outbound"] as const).map((d) => (
                            <button
                              key={d}
                              onClick={() => setCitDir(d)}
                              className={`px-2 py-1 rounded border text-xs ${citDir === d ? "bg-accent border-primary" : "bg-background border-border"}`}
                            >
                              {d}
                            </button>
                          ))}
                          <select
                            className="rounded-md bg-background text-foreground border border-input px-2 py-1 text-xs"
                            value={roleFilter}
                            onChange={(e) => setRoleFilter(e.target.value)}
                          >
                            <option value="all">All roles</option>
                            {Object.keys(ROLE_LABEL).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                          <div className="ml-auto text-xs text-muted-foreground">
                            {filteredCitations.length} shown
                          </div>
                        </div>
                        {filteredCitations.length === 0 ? (
                          <Empty>No citations found for this trace.</Empty>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm border border-border">
                              <thead className="bg-accent text-accent-foreground">
                                <tr>
                                  <th className="text-left p-2 border-b border-border">Direction</th>
                                  <th className="text-left p-2 border-b border-border">Source</th>
                                  <th className="text-left p-2 border-b border-border">Target</th>
                                  <th className="text-left p-2 border-b border-border">Role</th>
                                  <th className="text-left p-2 border-b border-border">Context</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredCitations.map((c, i) => (
                                  <tr key={i} className="odd:bg-muted/20 align-top">
                                    <td className="p-2 text-xs"><TinyToken>{c.direction}</TinyToken></td>
                                    <td className="p-2">{c.ref?.ref_source ?? ""}</td>
                                    <td className="p-2">{c.ref?.ref_target ?? ""}</td>
                                    <td className="p-2"><RoleChip role={c.ref?.role} /></td>
                                    <td className="p-2">{c.ref?.comment ?? ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
