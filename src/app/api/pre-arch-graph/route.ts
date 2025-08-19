// src/app/api/pre-arch-graph/route.ts
import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";

const NODE_FILES = [
  "NODES_ATA_chapters_V1.jsonl",
  "NODES_L1L2L3functions_V2.jsonl",
];

const EDGE_FILES = [
  "EDGES_ATA_chapters_V1.jsonl",
  "EDGES_L1L2L3functions_V2.jsonl",
];

function parseJsonl(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// Normalize keys like:
//  NODES_ATA_chapters_V1.jsonl       -> "ATA_chapters"
//  EDGES_L1L2L3functions_V2.jsonl    -> "L1L2L3functions"
function keyFromFile(file: string, kind: "node" | "edge") {
  const prefix = kind === "node" ? /^NODES_/ : /^EDGES_/;
  return file
    .replace(prefix, "")
    .replace(/_V\d+\.jsonl$/i, "") // drop _V1.jsonl, _V2.jsonl, etc.
    .replace(/\.jsonl$/i, "")      // fallback if no version suffix
    || "structure";
}

export async function GET() {
  const base = path.join(process.cwd(), "src", "pre-arch-graph", "v1_0_0");

  const readSafe = async (p: string) => {
    try {
      return await fs.readFile(p, "utf8");
    } catch {
      return "";
    }
  };

  // Load nodes
  const nodesDir = path.join(base, "nodes");
  const nodes: Record<string, any[]> = {};
  await Promise.all(
    NODE_FILES.map(async (file) => {
      const key = keyFromFile(file, "node");
      const txt = await readSafe(path.join(nodesDir, file));
      nodes[key] = txt ? parseJsonl(txt) : [];
    })
  );

  // Load edges
  const edgesDir = path.join(base, "edges");
  const edges: Record<string, any[]> = {};
  await Promise.all(
    EDGE_FILES.map(async (file) => {
      const key = keyFromFile(file, "edge");
      const txt = await readSafe(path.join(edgesDir, file));
      edges[key] = txt ? parseJsonl(txt) : [];
    })
  );

  return NextResponse.json({ nodes, edges });
}
