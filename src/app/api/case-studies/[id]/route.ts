import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

type TdpKey =
  | "notional_application"
  | "technology_goals"
  | "technology_description"
  | "development_rationale"
  | "technology_baseline";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const file = path.join(process.cwd(), "src/app/data/case-studies", `${id}.jsonl`);
  const raw = await fs.readFile(file, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());

  const meta = JSON.parse(lines[0] ?? "{}");
  const events = lines.slice(1).map((l) => JSON.parse(l));

  const tdp: Record<TdpKey, { title: string; content: string }> = {
    notional_application: { title: "Notional application", content: "" },
    technology_goals: { title: "Technology goals", content: "" },
    technology_description: { title: "Technology description", content: "" },
    development_rationale: { title: "Development rationale", content: "" },
    technology_baseline: { title: "Technology baseline", content: "" },
  };

  for (const ev of events) {
    if (ev.type === "TDP_SET_SECTION" && ev.payload?.key && ev.payload?.content) {
      const k = ev.payload.key as TdpKey;
      if (tdp[k]) tdp[k].content = String(ev.payload.content);
    }
  }

  return NextResponse.json({ meta, tdp });
}