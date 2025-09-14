import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET() {
  const dir = path.join(process.cwd(), "src/app/data/case-studies");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && e.name.endsWith(".jsonl"));

  const list = await Promise.all(files.map(async f => {
    const raw = await fs.readFile(path.join(dir, f.name), "utf-8");
    const first = raw.split(/\r?\n/).find(l => l.trim()) ?? "{}";
    let meta: any = {};
    try { meta = JSON.parse(first); } catch {}
    const id = meta.caseStudyId || f.name.replace(/\.jsonl$/i, "");
    return {
      id,
      file: f.name,
      title: meta.title ?? id,
      description: meta.description ?? "",
    };
  }));

  list.sort((a, b) => a.title.localeCompare(b.title));
  return NextResponse.json(list);
}
