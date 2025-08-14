// src/app/api/auth/debug/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
export function GET() {
  const c = cookies();
  return NextResponse.json({
    e42_at: !!c.get("e42_at"),
    e42_it: !!c.get("e42_it"),
    e42_rt: !!c.get("e42_rt"),
  });
}
