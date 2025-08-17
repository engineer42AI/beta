// src/app/api/reg-graph/route.ts

import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";

const NODE_FILES = [
  "NODES_regulation_JUL2025_V1.jsonl",
  "NODES_regulation_JUL2025_paragraphs_V1.jsonl",
  "NODES_regulation_JUL2025_traces_V1.jsonl",
  "NODES_regulation_JUL2025_traceIntent_V1.jsonl",
  "NODES_regulation_JUL2025_sectionIntent_V1.jsonl",
];

const EDGE_FILES = [
  "EDGES_regulation_JUL2025_V1.jsonl",
  "EDGES_regulation_JUL2025_paragraphs_V1.jsonl",
  "EDGES_regulation_JUL2025_traces_V1.jsonl",
  "EDGES_regulation_JUL2025_traceIntent_V1.jsonl",
  "EDGES_regulation_JUL2025_sectionIntent_V1.jsonl",
  "EDGES_regulation_JUL2025_CITES_V1.jsonl",
];

function parseJsonl(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export async function GET() {
  const base = path.join(process.cwd(), "src", "reg-graph", "v1_0_0");

  const readSafe = async (p: string) => {
    try { return await fs.readFile(p, "utf8"); } catch { return ""; }
  };

  // Load nodes
  const nodesDir = path.join(base, "nodes");
  const nodes: Record<string, any[]> = {};
  await Promise.all(
    NODE_FILES.map(async (file) => {
      const key = file
        .replace(/^NODES_regulation_JUL2025_/, "")
        .replace(/_V1\.jsonl$/, "") || "structure";
      const txt = await readSafe(path.join(nodesDir, file));
      nodes[key || "structure"] = txt ? parseJsonl(txt) : [];
    })
  );

  // Load edges
  const edgesDir = path.join(base, "edges");
  const edges: Record<string, any[]> = {};
  await Promise.all(
    EDGE_FILES.map(async (file) => {
      const key = file
        .replace(/^EDGES_regulation_JUL2025_/, "")
        .replace(/_V1\.jsonl$/, "")
        .replace(/_CITES_V1\.jsonl$/, "CITES_V1") || "structure";
      const txt = await readSafe(path.join(edgesDir, file));
      edges[key || "structure"] = txt ? parseJsonl(txt) : [];
    })
  );

  return NextResponse.json({ nodes, edges });
}
