// src/pre-arch-graph/build.ts
// Minimal, extensible graph builder for Pre-Architecture phase
// Gathers nodes/edges from the API bundle and turns them into a MultiDiGraph,
// plus a helper to create React Flow elements with a simple layered layout.

export type NodeData = Record<string, any>;
export type EdgeData = { source: string; target: string; relation?: string; ref?: any };
export type Bundle   = { nodes?: Record<string, any[]>; edges?: Record<string, any[]> };

// -------- In-memory multigraph (typed but tiny) --------
export class MultiDiGraph {
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

// -------- Field mappers (extensible) --------
// Add new cases as you onboard Hazards, Assets, Regulations, etc.
export function getNodeId(n: any): string | null {
  return (
    n?.uuid_function ||
    n?.uuid_ata ||
    n?.uuid_asset ||
    n?.uuid_hazard ||
    n?.uuid_regulation ||
    n?.uuid ||
    null
  );
}

export type CanonNodeType =
  | "Function_L1"
  | "Function_L2"
  | "Function_L3"
  | "ATA"
  | "Asset"
  | "Hazard"
  | "Regulation"
  | "Unknown";

export function classifyNode(n: any): CanonNodeType {
  // Functions (your JSONL: { type:"function", label:"L1|L2|L3" })
  if (n?.type === "function") {
    const lvl = (n?.label ?? "").toUpperCase();
    if (lvl === "L1") return "Function_L1";
    if (lvl === "L2") return "Function_L2";
    if (lvl === "L3") return "Function_L3";
  }

  // ATA
  if ((n?.label ?? "").toUpperCase() === "ATA" || n?.chapter) return "ATA";

  // Future (placeholders)
  if (n?.ntype === "Hazard" || n?.type === "hazard") return "Hazard";
  if (n?.ntype === "Asset" || n?.type === "asset") return "Asset";
  if (n?.ntype === "Regulation" || n?.type === "regulation") return "Regulation";

  return "Unknown";
}

export function buildGraphFromBundle(bundle: Bundle): MultiDiGraph {
  const G = new MultiDiGraph();

  for (const arr of Object.values(bundle.nodes ?? {})) {
    (arr || []).forEach((n) => {
      const id = getNodeId(n);
      if (!id) return;
      const kind = classifyNode(n);
      const name =
        n?.name ??
        n?.chapter ??
        n?.title ??
        n?.label ??
        "Untitled";
      G.addNode(id, { ...n, __kind: kind, __name: name });
    });
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

// -------- Layout & element shaping for React Flow --------
export type RFNode = import("reactflow").Node;
export type RFEdge = import("reactflow").Edge;

// Simple layered layout without extra deps.
// Columns: L1 → L2 → L3 → ATA (you can add Asset/Regulation columns later).
export function toReactFlowElements(
  G: MultiDiGraph,
  opts?: { xGap?: number; yGap?: number }
): { nodes: RFNode[]; edges: RFEdge[] } {
  const xGap = opts?.xGap ?? 320;
  const yGap = opts?.yGap ?? 120;

  const columns: Record<CanonNodeType, number> = {
    Function_L1: 0,
    Function_L2: 1,
    Function_L3: 2,
    ATA: 3,
    Asset: 4,
    Regulation: 5,
    Hazard: 6,
    Unknown: 7,
  };

  const rows: Record<number, string[]> = {};
  for (const [id, d] of G.nodes) {
    const col = columns[d.__kind as CanonNodeType] ?? 7;
    if (!rows[col]) rows[col] = [];
    rows[col].push(id);
  }
  // stable order by name to reduce layout jitter
  for (const col of Object.keys(rows)) {
    rows[+col].sort((a, b) => {
      const da = G.node(a)!.__name?.toString().toLowerCase() ?? "";
      const db = G.node(b)!.__name?.toString().toLowerCase() ?? "";
      return da.localeCompare(db);
    });
  }

  const nodes: RFNode[] = [];
  Object.entries(rows).forEach(([colStr, ids]) => {
    const col = Number(colStr);
    ids.forEach((id, idx) => {
      const d = G.node(id)!;
      const label = labelForNode(d);
      nodes.push({
        id,
        type: "default",
        position: { x: col * xGap, y: idx * yGap },
        data: {
          title: label.title,
          body: label.body,
          kind: d.__kind,
          raw: d,
        },
        draggable: true,
      });
    });
  });

  const edges: RFEdge[] = [];
  for (const [src, outs] of G.out) {
    for (const e of outs) {
      const rel = e.relation ?? "REL";
      const id = `${src}->${e.target}:${rel}`;
      const style = styleForEdge(rel);
      edges.push({
        id,
        source: src,
        target: e.target,
        label: rel,
        animated: style.animated,
        style: style.style,
        markerEnd: { type: style.marker },
      } as RFEdge);
    }
  }

  return { nodes, edges };
}

function labelForNode(d: any): { title: string; body: string } {
  switch (d.__kind as CanonNodeType) {
    case "Function_L1":
    case "Function_L2":
    case "Function_L3":
      return {
        title: `${d.label ?? ""} • ${d.name ?? d.__name ?? "Function"}`,
        body: d.description ?? "",
      };
    case "ATA":
      return {
        title: `ATA ${d.chapter ?? d.__name ?? ""}`,
        body: d.description ?? "",
      };
    default:
      return { title: d.__name ?? "Node", body: d.description ?? "" };
  }
}

function styleForEdge(rel: string): {
  animated: boolean;
  style: React.CSSProperties;
  marker: "arrow" | "arrowclosed";
} {
  // decomp edges: solid + animated
  if (rel === "L1_HAS_L2" || rel === "L2_HAS_L3") {
    return {
      animated: true,
      style: { strokeWidth: 2 },
      marker: "arrowclosed",
    };
  }
  // cross-domain links (e.g., L3_LINKS_TO_ATA): dashed
  if (rel.endsWith("LINKS_TO_ATA") || rel.includes("LINKS_TO")) {
    return {
      animated: false,
      style: { strokeDasharray: "6 4", strokeWidth: 2, opacity: 0.85 },
      marker: "arrowclosed",
    };
  }
  return { animated: false, style: { strokeWidth: 1.5 }, marker: "arrow" };
}
