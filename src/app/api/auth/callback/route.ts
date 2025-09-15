// src/app/api/auth/callback/route.ts
import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/cognito";

export const dynamic = "force-dynamic";

const isProd = process.env.NODE_ENV === "production";
const cookieOpts = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  // Prefer configured base; never rely solely on url.origin behind proxies
  const appBase = (process.env.APP_BASE_URL || url.origin).replace(/\/+$/, "");
  const rawNext = url.searchParams.get("state") || "/overview";
  const nextPath = rawNext.startsWith("/") ? rawNext : "/overview";
  const nextAbs = new URL(nextPath, appBase);

  if (!code) return NextResponse.redirect(nextAbs);

  try {
    const redirectUri =
      process.env.COGNITO_REDIRECT_URI || `${appBase}/api/auth/callback`;

    const tokens = await exchangeCodeForTokens(code, redirectUri);

    const res = NextResponse.redirect(nextAbs);
    const exp = new Date(Date.now() + tokens.expires_in * 1000);

    res.cookies.set("e42_at", tokens.access_token, { ...cookieOpts, expires: exp });
    res.cookies.set("e42_it", tokens.id_token,    { ...cookieOpts, expires: exp });
    if (tokens.refresh_token) {
      res.cookies.set("e42_rt", tokens.refresh_token, {
        ...cookieOpts,
        expires: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      });
    }
    return res;
  } catch (err) {
    console.error("Cognito token exchange failed:", err);
    // Use APP_BASE_URL instead of url.origin here too
    return NextResponse.redirect(new URL("/", appBase));
  }
}