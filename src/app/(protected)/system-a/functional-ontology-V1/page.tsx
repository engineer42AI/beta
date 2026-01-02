"use client";

import React from "react";
import dagre from "@dagrejs/dagre";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  Edge,
  Node,
  Handle,
  Position,
  ConnectionMode,
  ReactFlowProvider,
  useReactFlow,
  Panel,
  NodeToolbar,
  NodeProps,
  MarkerType, // ✅ add this
} from "reactflow";
import "reactflow/dist/style.css";


/* ============================================================================
   Layout + sizing
============================================================================ */
const CARD_W = 320;          // must match visual width of your node card
const DAGRE_NODE_W = CARD_W; // keep dagre in sync
const DAGRE_NODE_H = 120;    // stable height (cards visually around 110–140)

/* ============================================================================
   Relation constants (adjust if your JSONL changes)
============================================================================ */
const REL = {
  L1_HAS_L2: "L1_HAS_L2",
  L2_HAS_L3: "L2_HAS_L3",
  L3_TO_ATA: "L3_LINKS_TO_ATA",
} as const;

/* ============================================================================
   Small helpers
============================================================================ */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpoint}px), (pointer:coarse)`);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsMobile("matches" in e ? e.matches : (e as MediaQueryList).matches);
    onChange(mq);
    mq.addEventListener?.("change", onChange as any);
    return () => mq.removeEventListener?.("change", onChange as any);
  }, [breakpoint]);
  return isMobile;
}

/* ============================================================================
   Tiny graph model (in-memory)
============================================================================ */
type NodeDataRec = Record<string, any>;
type EdgeDataRec = { source: string; target: string; relation?: string; ref?: any };
type Bundle = { nodes?: Record<string, any[]>; edges?: Record<string, any[]> };

class MultiDiGraph {
  nodes: Map<string, NodeDataRec> = new Map();
  out: Map<string, EdgeDataRec[]> = new Map();
  addNode(id: string, data: NodeDataRec) {
    this.nodes.set(id, { ...(this.nodes.get(id) || {}), ...data });
    if (!this.out.has(id)) this.out.set(id, []);
  }
  addEdge(source: string, target: string, relation?: string, ref?: any) {
    const ed: EdgeDataRec = { source, target, relation, ref };
    if (!this.out.has(source)) this.out.set(source, []);
    this.out.get(source)!.push(ed);
  }
  node(id: string) { return this.nodes.get(id); }
  outEdges(id: string) { return this.out.get(id) || []; }
}

type CanonKind = "AIRCRAFT" | "Function_L1" | "Function_L2" | "Function_L3" | "ATA" | "Unknown";

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

function buildGraphFromBundle(bundle: Bundle) {
  const G = new MultiDiGraph();
  for (const arr of Object.values(bundle.nodes ?? {})) {
    (arr || []).forEach((n) => {
      const id = getNodeId(n);
      if (!id) return;
      const kind = classify(n);
      const name = n?.name ?? n?.chapter ?? n?.label ?? "Untitled";
      G.addNode(id, { ...n, __kind: kind, __name: name });
    });
  }
  for (const arr of Object.values(bundle.edges ?? {})) {
    (arr || []).forEach((e) => {
      const { source, target, relation, ref } = e || {};
      if (source && target) G.addEdge(source, target, relation, ref);
    });
  }
  return G;
}

/* ============================================================================
   Dagre layout
============================================================================ */
const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

function layoutWithDagre(
  nodes: Node<OntNodeData>[],
  edges: Edge[],
  dir: "TB" | "LR" = "TB"
) {
  const isH = dir === "LR";

  // ✅ new graph per run
  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false })
    .setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: dir,         // TB = vertical, LR = horizontal
    nodesep: 48,          // horizontal gap between siblings
    ranksep: 120,         // vertical gap between ranks
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((n) => {
    g.setNode(n.id, { width: 320, height: 120 }); // keep in sync with your card size
  });

  edges.forEach((e) => {
    g.setEdge(e.source, e.target);
  });

  dagre.layout(g);

  const laidNodes = nodes.map((n) => {
    const p = g.node(n.id) as { x: number; y: number };
    return {
      ...n,
      targetPosition: isH ? Position.Left : Position.Top,
      sourcePosition: isH ? Position.Right : Position.Bottom,
      position: { x: p.x - 320 / 2, y: p.y - 120 / 2 },
    };
  });

  return { nodes: laidNodes, edges };
}


/* ============================================================================
   Node component (toolbar + handles)
============================================================================ */
type OntNodeData = {
  header: string;
  body?: string;
  kind: CanonKind;
  raw: any;
  expanded?: boolean;
  onExpand?: (id: string) => void;
  onCollapse?: (id: string) => void;
  onAddChild?: (id: string) => void;
  toolbarPosition?: Position;
  forceToolbarVisible?: boolean;
};

function OntNode({ id, data, selected }: NodeProps<OntNodeData>) {
  return (
    <div
      className="rounded-[var(--radius)] border bg-card text-card-foreground shadow-sm overflow-hidden"
      style={{ width: CARD_W, pointerEvents: "all" }}
    >
      <NodeToolbar
        position={data.toolbarPosition ?? Position.Bottom}
        isVisible={data.forceToolbarVisible ? true : undefined}
        offset={12}
        className="gap-2"
      >
        <button
          className="nodrag nopan text-xs px-2 py-1 rounded-md border bg-background hover:bg-accent transition"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            data.expanded ? data.onCollapse?.(id) : data.onExpand?.(id);
          }}
          title={data.expanded ? "Collapse subtree" : "Expand children"}
        >
          {data.expanded ? "collapse ▲" : "expand ▼"}
        </button>
        <button
          className="nodrag nopan text-xs px-2 py-1 rounded-md border bg-background hover:bg-accent transition"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); data.onAddChild?.(id); }}
          title="Add child node"
        >
          + add child node
        </button>
      </NodeToolbar>

      <div className="px-3 py-2 border-b bg-accent font-semibold text-[13px] truncate" data-drag-handle>
        {data.header}
      </div>
      {data.body && (
        <div className="px-3 py-2 text-[12px] leading-5 text-muted-foreground">
          {data.body}
        </div>
      )}

      {/* handles so edges render correctly */}
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="target" position={Position.Left} id="l" />
    </div>
  );
}

const nodeTypes = { ont: OntNode };

/* ============================================================================
   Page wrapper
============================================================================ */
export default function GraphPage() {
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <ReactFlowProvider>
        <FlowCanvas />
      </ReactFlowProvider>
    </div>
  );
}

/* ============================================================================
   Canvas
============================================================================ */
function FlowCanvas() {
  const [layoutDir, setLayoutDir] = React.useState<"TB" | "LR">("TB");

  const [nodes, setNodes, onNodesChange] = useNodesState<OntNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [showInspector, setShowInspector] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selectedNode = React.useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId]
  );

  const isMobile = useIsMobile();
  React.useEffect(() => { if (isMobile) setShowInspector(false); }, [isMobile]);

  const [G, setG] = React.useState<MultiDiGraph | null>(null);
  const expandRef = React.useRef<(id: string) => void>(() => {});
  const collapseRef = React.useRef<(id: string) => void>(() => {});
  const addChildRef = React.useRef<(id: string) => void>(() => {});
  const hidden = React.useRef<Set<string>>(new Set());
  const { fitView } = useReactFlow();

  // toolbar broadcast helpers
  const setToolbarPosition = (pos: Position) =>
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, toolbarPosition: pos } })));
  const forceToolbarVisible = (enabled: boolean) =>
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, forceToolbarVisible: enabled } })));

  // load data + root
  React.useEffect(() => {
    (async () => {
      const res = await fetch("/api/pre-arch-graph", { cache: "no-store" });
      const bundle = await res.json();
      const graph = buildGraphFromBundle(bundle);
      setG(graph);

      setNodes([{
        id: "AIRCRAFT",
        type: "ont",
        position: { x: 0, y: 0 },
        dragHandle: "[data-drag-handle]",
        data: {
          header: "AIRCRAFT",
          kind: "AIRCRAFT",
          body: "Top-level. Use the toolbar to expand.",
          raw: { ntype: "AIRCRAFT" },
          expanded: false,
          onExpand: (nid) => expandRef.current(nid),
          onCollapse: (nid) => collapseRef.current(nid),
          onAddChild: (nid) => addChildRef.current(nid),
        },
      }]);

      // frame the root nicely
      requestAnimationFrame(() => fitView({ padding: 0.15 }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- children discovery ---------- */
  const childrenOf = React.useCallback((id: string) => {
    if (!G) return { ids: [] as string[], rel: "" };

    if (id === "AIRCRAFT") {
      const ids = Array.from(G.nodes.entries())
        .filter(([, d]) => d.__kind === "Function_L1")
        .map(([nid]) => nid);
      return { ids, rel: "AIRCRAFT_HAS_L1" };
    }

    const d = G.node(id);
    if (!d) return { ids: [], rel: "" };

    if (d.__kind === "Function_L1")
      return { ids: G.outEdges(id).filter(e => e.relation === REL.L1_HAS_L2).map(e => e.target), rel: REL.L1_HAS_L2 };

    if (d.__kind === "Function_L2")
      return { ids: G.outEdges(id).filter(e => e.relation === REL.L2_HAS_L3).map(e => e.target), rel: REL.L2_HAS_L3 };

    if (d.__kind === "Function_L3")
      return { ids: G.outEdges(id).filter(e => e.relation === REL.L3_TO_ATA).map(e => e.target), rel: REL.L3_TO_ATA };

    return { ids: [], rel: "" };
  }, [G]);

  /* ---------- RF node factory ---------- */
  const makeRFNode = (id: string): Node<OntNodeData> | null => {
    if (!G) return null;
    const d = G.node(id); if (!d) return null;

    const badge =
      d.__kind?.toString().startsWith("Function")
        ? (d.label ?? "").toUpperCase()
        : d.__kind === "ATA" ? "ATA" : "";

    const header =
      d.__kind?.toString().startsWith("Function")
        ? `${badge} • ${d.name ?? d.__name ?? "Function"}`
        : d.__kind === "ATA" ? `ATA ${d.chapter ?? ""}` : d.__name ?? "Node";

    return {
      id,
      type: "ont",
      position: { x: 0, y: 0 }, // Dagre will place it
      dragHandle: "[data-drag-handle]",
      data: {
        header,
        body: d.description ?? "",
        kind: d.__kind as CanonKind,
        raw: d,
        expanded: false,
        onExpand: (nid) => expandRef.current(nid),
        onCollapse: (nid) => collapseRef.current(nid),
        onAddChild: (nid) => addChildRef.current(nid),
      },
    };
  };

  /* ---------- Layout helper applied to the current visible graph ---------- */
  const applyLayout = React.useCallback(
      (dir: "TB" | "LR" = layoutDir, next?: { nodes: Node[]; edges: Edge[] }) => {
        // work with the *snapshot* we want to show
        const baseNodes = next?.nodes ?? nodes;
        const baseEdges = next?.edges ?? edges;

        // only layout visible stuff
        const visibleNodes = baseNodes.filter(
          (nd) => !hidden.current.has(nd.id) || nd.id === "AIRCRAFT"
        );
        const visibleEdges = baseEdges.filter((ed) => !hidden.current.has(ed.target));

        const laid = layoutWithDagre(visibleNodes, visibleEdges, dir);

        // merge positions back into the *snapshot* (NOT the previous state)
        const posMap = new Map(laid.nodes.map((ln) => [ln.id, ln]));
        const updatedNodes = baseNodes.map((nd) =>
          posMap.has(nd.id)
            ? {
                ...nd,
                position: posMap.get(nd.id)!.position,
                sourcePosition: posMap.get(nd.id)!.sourcePosition,
                targetPosition: posMap.get(nd.id)!.targetPosition,
              }
            : nd
        );

        setNodes(updatedNodes);      // <-- write the full snapshot including new nodes
        setEdges(baseEdges);         // edges already reflect "next" when provided

        requestAnimationFrame(() => fitView({ padding: 0.15 }));
      },
      [nodes, edges, layoutDir, setNodes, setEdges, fitView]
  );


  /* ---------- Expand ---------- */
  // EXPAND
  const doExpand = (parentId: string) => {
      if (!G) return;

      const { ids, rel } = childrenOf(parentId);
      if (!ids.length) return;

      // ✅ make sure previously-collapsed ids are no longer hidden
      ids.forEach((id) => hidden.current.delete(id));

      // create any missing children
      const have = new Set(nodes.map((n) => n.id));
      const created = ids
        .filter((id) => !have.has(id))
        .map((cid) => makeRFNode(cid))
        .filter(Boolean) as Node[];

      const nextNodes = nodes
        .map((n) =>
          n.id === parentId ? { ...n, data: { ...n.data, expanded: true } } : n
        )
        .concat(created);

      const haveE = new Set(edges.map((e) => e.id));
      const addEdges: Edge[] = ids
        .map((cid) => ({
          id: `${parentId}->${cid}:${rel}`,
          source: parentId,
          target: cid,
          type: "smoothstep",
        }))
        .filter((e) => !haveE.has(e.id));

      const nextEdges = edges.concat(addEdges);

      // Layout the full snapshot and commit
      applyLayout(layoutDir, { nodes: nextNodes, edges: nextEdges });
  };

  // COLLAPSE (hide subtree)
  const doCollapse = (id: string) => {
      // collect descendants of id
      const toHide = new Set<string>();
      const visit = (pid: string) => {
        edges
          .filter((e) => e.source === pid)
          .forEach((e) => {
            if (!toHide.has(e.target)) {
              toHide.add(e.target);
              visit(e.target);
            }
          });
      };
      visit(id);

      // ✅ update the “hidden” registry for layout filtering
      toHide.forEach((nid) => hidden.current.add(nid));

      // remove hidden nodes and edges from the snapshot
      const nextNodes = nodes
        .map((n) =>
          n.id === id ? { ...n, data: { ...n.data, expanded: false } } : n
        )
        .filter((n) => !toHide.has(n.id));

      const nextEdges = edges.filter(
        (e) => e.source !== id && !toHide.has(e.source) && !toHide.has(e.target)
      );

      // optional: if you track an "expanded" Set, clear it here
      // expanded.current.delete(id);

      applyLayout(layoutDir, { nodes: nextNodes, edges: nextEdges });
  };


  /* ---------- Add child (local placeholder) ---------- */
  const doAddChild = (parentId: string) => {
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return;

    const newId = `NEW_${Math.random().toString(36).slice(2, 9)}`;
    hidden.current.delete(newId);

    const nextNodes = nodes.concat([{
      id: newId,
      type: "ont",
      position: { x: parent.position.x, y: parent.position.y + 200 },
      dragHandle: "[data-drag-handle]",
      data: {
        header: "New node",
        body: "Describe…",
        kind: "Unknown",
        raw: { sketch: true },
        expanded: false,
        onExpand: (nid) => expandRef.current(nid),
        onCollapse: (nid) => collapseRef.current(nid),
        onAddChild: (nid) => addChildRef.current(nid),
      },
    }]);

    const nextEdges = edges.concat([{
      id: `${parentId}->${newId}:SKETCH`,
      source: parentId,
      target: newId,
      type: "smoothstep",
    }]);

    applyLayout(layoutDir, { nodes: nextNodes, edges: nextEdges });
  };

  // wire stable refs
  React.useEffect(() => { expandRef.current   = doExpand;   }, [G, nodes, edges, layoutDir, applyLayout]);
  React.useEffect(() => { collapseRef.current = doCollapse; }, [nodes, edges, layoutDir, applyLayout]);
  React.useEffect(() => { addChildRef.current = doAddChild; }, [nodes, edges, layoutDir, applyLayout]);

  return (
    <div className="min-h-0 flex-1 flex flex-col">
      {/* header */}
      <div className="h-11 border-b px-3 flex items-center gap-2 bg-background">
        <strong className="text-sm">Pre-Architecture Graph</strong>
        <div className="ml-auto hidden md:block text-xs text-muted-foreground">
          Use the node toolbar to expand/collapse or add children.
        </div>
      </div>

      {/* canvas */}
      <div className="min-h-0 flex-1 relative rounded-lg border overflow-hidden" tabIndex={0}>
        <ReactFlow
          className="absolute inset-0"
          nodes={nodes.filter((n) => !hidden.current.has(n.id) || n.id === "AIRCRAFT")}
          edges={edges.filter((e) => !hidden.current.has(e.target))}
          onSelectionChange={({ nodes }) => setSelectedId(nodes?.[0]?.id ?? null)}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          snapToGrid
          snapGrid={[10, 10]}
          fitView
        >
          <MiniMap className="hidden lg:block" />
          <Controls />
          <Background gap={24} size={1} />

          {/* Toolbar controls (mirrors RF docs) */}
          <Panel position="top-center" className="space-x-2 bg-card/80 backdrop-blur px-2 py-1 rounded border shadow">
            <span className="text-xs text-muted-foreground">Toolbar:</span>
            <button className="h-7 px-2 border rounded" onClick={() => setToolbarPosition(Position.Top)}>Top</button>
            <button className="h-7 px-2 border rounded" onClick={() => setToolbarPosition(Position.Right)}>Right</button>
            <button className="h-7 px-2 border rounded" onClick={() => setToolbarPosition(Position.Bottom)}>Bottom</button>
            <button className="h-7 px-2 border rounded" onClick={() => setToolbarPosition(Position.Left)}>Left</button>
            <label className="ml-3 text-xs inline-flex items-center gap-1">
              <input type="checkbox" onChange={(e) => forceToolbarVisible(e.target.checked)} />
              Always show
            </label>
          </Panel>

          {/* Layout direction */}
          <Panel position="top-right" className="space-x-2 bg-card/80 backdrop-blur px-2 py-1 rounded border shadow">
            <span className="text-xs text-muted-foreground">Layout:</span>
            <button
              className={`h-7 px-2 border rounded ${layoutDir === "TB" ? "bg-accent" : ""}`}
              onClick={() => { setLayoutDir("TB"); applyLayout("TB"); }}
            >
              vertical
            </button>
            <button
              className={`h-7 px-2 border rounded ${layoutDir === "LR" ? "bg-accent" : ""}`}
              onClick={() => { setLayoutDir("LR"); applyLayout("LR"); }}
            >
              horizontal
            </button>
          </Panel>

          {/* Inspector toggle */}
          {!isMobile && (
            <Panel position="top-left" style={{ top: 12, left: 12, background: "transparent", boxShadow: "none", zIndex: 5 }}>
              <button
                className="h-8 w-8 rounded-md border text-sm shadow bg-secondary"
                title={showInspector ? "Hide inspector" : "Show inspector"}
                onClick={() => setShowInspector((v) => !v)}
              >
                i
              </button>
            </Panel>
          )}

          {!isMobile && showInspector && selectedNode && (
            <Panel position="top-right" style={{ top: 12, right: 12, zIndex: 5 }}>
              <div
                className="rounded-lg border shadow-lg bg-card text-card-foreground p-3 flex flex-col"
                style={{
                  width: "clamp(280px, 70vw, 500px)",
                  height: "clamp(260px, 45vh, 320px)",
                  maxWidth: "calc(100% - 24px)",
                  maxHeight: "calc(100% - 24px)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">Node Inspector</div>
                  <div className="text-xs text-muted-foreground">#{selectedNode.id}</div>
                </div>
                <details className="rounded border p-2" open>
                  <summary className="cursor-pointer text-sm font-medium mb-1">Raw data</summary>
                  <pre className="text-xs whitespace-pre-wrap break-words rounded p-2 bg-background/60 max-h-28 overflow-auto">
                    {JSON.stringify(selectedNode.data?.raw ?? {}, null, 2)}
                  </pre>
                </details>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}
