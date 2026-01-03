// src/app/api/auth/callback/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { exchangeCodeForTokens } from "@/lib/cognito";

export const dynamic = "force-dynamic";

const isProd = process.env.NODE_ENV === "production";
const cookieOpts = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };

function getPublicOrigin(req: Request) {
  const h = headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host =
    h.get("x-forwarded-host") ||
    h.get("host") ||
    new URL(req.url).host;
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  const origin = getPublicOrigin(req);

  // Sanitize `state` (next URL): allow only same-site paths
  const rawNext = url.searchParams.get("state") || "/overview";
  const nextPath = rawNext.startsWith("/") ? rawNext : "/overview";
  const nextAbs = new URL(nextPath, origin);

  if (!code) return NextResponse.redirect(nextAbs);

  try {
    const tokens = await exchangeCodeForTokens(code);

    const res = NextResponse.redirect(nextAbs);
    const exp = new Date(Date.now() + tokens.expires_in * 1000);

    res.cookies.set("e42_at", tokens.access_token, { ...cookieOpts, expires: exp });
    res.cookies.set("e42_it", tokens.id_token, { ...cookieOpts, expires: exp });
    if (tokens.refresh_token) {
      res.cookies.set("e42_rt", tokens.refresh_token, {
        ...cookieOpts,
        expires: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      });
    }
    return res;
  } catch (err) {
    console.error("Cognito token exchange failed:", err);
    return NextResponse.redirect(new URL("/", origin));
  }
}