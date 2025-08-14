// src/app/api/auth/me/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decodeJwt, getUserInfo } from "@/lib/cognito";

export async function GET() {
  const c = cookies();
  const at = c.get("e42_at")?.value;
  const it = c.get("e42_it")?.value;
  if (!at || !it) return NextResponse.json({ authenticated: false }, { status: 401 });

  const user = await getUserInfo(at);                  // {email, given_name, ...}
  const claims = decodeJwt<{["cognito:groups"]?: string[]}>(it);
  return NextResponse.json({
    authenticated: true,
    user,
    groups: claims["cognito:groups"] ?? [],
  });
}
