// src/app/api/auth/debug/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const c = await cookies();

  return NextResponse.json({
    e42_at: !!c.get("e42_at"),
    e42_it: !!c.get("e42_it"),
    e42_rt: !!c.get("e42_rt"),
  });
}
