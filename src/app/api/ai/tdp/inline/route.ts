import { NextRequest, NextResponse } from "next/server";
const PY = process.env.PY_AGENT_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  const body = await req.json(); // { task, section_title, section_markdown, tdp_markdown? }
  const r = await fetch(`${PY}/tdp/inline`, {   // <— note: /tdp/inline, not /inline
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await r.json();
  if (!r.ok) {
    return NextResponse.json({ error: data.error || "Agent error" }, { status: r.status });
  }

  return NextResponse.json(data);
}

