"use client";

import React from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

/* =============================================================
   V2.2 — Columnar Functional Ontology Explorer with Resizable Panels
   - Uses shadcn/ui Resizable so each column and the inspector width can be adjusted
   - Global styles from global.css (ont-*) for rows, columns, and subtle highlights
   ============================================================= */

/* -----------------------------
   Types
----------------------------- */

type CanonKind =
  | "AIRCRAFT"
  | "Function_L1"
  | "Function_L2"
  | "Function_L3"
  | "ATA"
  | "Unknown";

type Bundle = { nodes?: Record<string, any[]>; edges?: Record<string, any[]> };

type GraphNode = {
  id: string;
  name: string;
  kind: CanonKind;
  raw: any;
};

type GraphEdge = { source: string; target: string; relation?: string };

type Graph = {
  nodes: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
};

/* -----------------------------
   Relations (keep in sync with backend)
----------------------------- */
const REL = {
  L1_HAS_L2: "L1_HAS_L2",
  L2_HAS_L3: "L2_HAS_L3",
  L3_TO_ATA: "L3_LINKS_TO_ATA",
} as const;

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
function getNodeId(n: any) {
  return n?.uuid_function || n?.uuid_ata || n?.uuid || null;
}

function buildGraphFromBundle(bundle: Bundle): Graph {
  const nodes = new Map<string, GraphNode>();
  const out = new Map<string, GraphEdge[]>();

  for (const arr of Object.values(bundle.nodes ?? {})) {
    (arr || []).forEach((n) => {
      const id = getNodeId(n);
      if (!id) return;
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
   Children lookup per level
----------------------------- */
function childrenOf(G: Graph, id: string): string[] {
  if (id === "AIRCRAFT") {
    // All L1 functions are direct children of the root
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
  if (n.kind === "Function_L3")
    return (G.out.get(id) || [])
      .filter((e) => e.relation === REL.L3_TO_ATA)
      .map((e) => e.target);
  return [];
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

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick?: React.MouseEventHandler;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-6 w-6 inline-flex items-center justify-center rounded border hover:bg-accent text-xs"
    >
      {children}
    </button>
  );
}

/* -----------------------------
   Column component
----------------------------- */

type Column = {
  parentId: string; // the node whose children are listed in this column
  label: string;    // e.g., "AIRCRAFT", or the chosen parent's title
  rows: string[];   // node ids for this column
  expandedRowId?: string | null; // which row is currently expanded (to show next column)
};

function ColumnView({
  G,
  column,
  onExpand,
  onCollapse,
  onInspect,
}: {
  G: Graph;
  column: Column;
  onExpand: (nodeId: string) => void;
  onCollapse: (nodeId: string) => void;
  onInspect: (nodeId: string) => void;
}) {
  return (
    <div className="ont-col">
      <div className="ont-col-header flex-none">{column.label}</div>
      <ul className="ont-col-list ont-scroll flex-1 min-h-0">
        {column.rows.map((id) => {
          const n = G.nodes.get(id)!;
          const isExpanded = column.expandedRowId === id;
          return (
            <li
              key={id}
              className={`ont-row ${isExpanded ? "ont-row--active" : ""}`}
              aria-expanded={isExpanded}
            >
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
  if (!nodeId) return null;
  const n = G.nodes.get(nodeId);
  if (!n) return null;
  return (
    <div className="h-full flex flex-col">
      <div className="h-10 px-3 border-b flex items-center justify-between sticky top-0 bg-card z-10">
        <div className="text-sm font-semibold truncate" title={n.name}>{n.name}</div>
        <button className="h-7 px-2 rounded border text-xs" onClick={onClose}>Close</button>
      </div>
      <div className="p-3 space-y-3 text-sm overflow-auto ont-scroll">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LevelBadge kind={n.kind} /> <span>#{n.id}</span>
        </div>
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
        const rootCol: Column = {
          parentId: "AIRCRAFT",
          label: "AIRCRAFT",
          rows: ["AIRCRAFT"],
          expandedRowId: null,
        };
        setColumns([rootCol]);
        setLoading(false);
      } catch (e: any) {
        setError(String(e?.message || e));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const expand = React.useCallback(
    (nodeId: string) => {
      if (!graph) return;
      // determine if nodeId is the special root
      if (nodeId === "AIRCRAFT") {
        const nextRows = childrenOf(graph, "AIRCRAFT");
        setColumns((cols) => {
          const updated = [...cols];
          updated[0] = { ...updated[0], expandedRowId: "AIRCRAFT" };
          const col1: Column = {
            parentId: "AIRCRAFT",
            label: "Level 1 Functions",
            rows: nextRows,
            expandedRowId: null,
          };
          return [updated[0], col1];
        });
        return;
      }

      // find which column contains nodeId
      setColumns((cols) => {
        const idx = cols.findIndex((c) => c.rows.includes(nodeId));
        if (idx === -1) return cols;
        const updated = cols.slice(0, idx + 1); // keep columns up to this one
        const col = { ...updated[idx], expandedRowId: nodeId };
        updated[idx] = col;
        const children = childrenOf(graph, nodeId);
        const nextLabel =
          graph.nodes.get(nodeId)!.kind === "Function_L1"
            ? "Level 2 Functions"
            : graph.nodes.get(nodeId)!.kind === "Function_L2"
            ? "Level 3 Functions"
            : graph.nodes.get(nodeId)!.kind === "Function_L3"
            ? "ATA Links"
            : "Children";
        updated.push({ parentId: nodeId, label: nextLabel, rows: children, expandedRowId: null });
        return updated;
      });
    },
    [graph]
  );

  const collapse = React.useCallback((nodeId: string) => {
    setColumns((cols) => {
      const idx = cols.findIndex((c) => c.rows.includes(nodeId));
      if (idx === -1) return cols;
      const updated = cols.slice(0, idx + 1);
      updated[idx] = { ...updated[idx], expandedRowId: null };
      return updated; // dropping deeper columns collapses the branch
    });
  }, []);

  const inspect = React.useCallback((nodeId: string) => {
    setInspectingId(nodeId);
  }, []);

  if (loading) return (
    <div className="p-6 text-sm">Loading ontology…</div>
  );
  if (error) return (
    <div className="p-6 text-sm text-red-600">Error: {error}</div>
  );
  if (!graph) return null;

  // Ensure root row renders even though it's not in G
  if (!graph.nodes.has("AIRCRAFT")) {
    graph.nodes.set("AIRCRAFT", { id: "AIRCRAFT", name: "AIRCRAFT", kind: "AIRCRAFT", raw: { ntype: "AIRCRAFT" } });
  }

  // Compute sensible defaultSize for each resizable panel (in %)
  const panelCount = columns.length + (inspectingId ? 1 : 0);
  const defaultPanelPct = Math.max(12, Math.min(28, Math.floor(100 / Math.max(1, panelCount))));

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Header */}
      <div className="h-11 border-b px-3 flex items-center gap-2 bg-background sticky top-0 z-20">
        <strong className="text-sm">Functional Ontology</strong>
        <span className="ml-auto text-xs text-muted-foreground hidden md:block">
          Click [+] to drill down. Use the info (i) to view details. Click [-] to collapse. Drag the handles between panels to resize.
        </span>
      </div>

      {/* Body: resizable column strip + optional inspector */}
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

      {/* Footer actions */}
      <div className="h-11 border-t px-3 flex items-center gap-2 bg-background text-xs text-muted-foreground">
        <span>Tip: Resize panels to reveal longer titles. Sizes persist until refresh.</span>
      </div>
    </div>
  );
}
