// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

const isProd = process.env.NODE_ENV === "production";
const cookieOpts = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };

async function getPublicOrigin(req: Request) {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host =
    h.get("x-forwarded-host") ||
    h.get("host") ||
    new URL(req.url).host;
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  const domain = process.env.COGNITO_DOMAIN!;
  const clientId = process.env.COGNITO_CLIENT_ID!;

  // Prefer explicit APP_BASE_URL if you set it, otherwise infer from request/nginx headers
  const origin = process.env.APP_BASE_URL || (await getPublicOrigin(req));
  const logoutUri = new URL("/", origin).toString(); // must be absolute + whitelisted in Cognito

  const url =
    `${domain}/logout` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&logout_uri=${encodeURIComponent(logoutUri)}`;

  const res = NextResponse.redirect(url);

  // Clear auth cookies by setting them expired on the response
  res.cookies.set("e42_at", "", { ...cookieOpts, expires: new Date(0) });
  res.cookies.set("e42_it", "", { ...cookieOpts, expires: new Date(0) });
  res.cookies.set("e42_rt", "", { ...cookieOpts, expires: new Date(0) });

  return res;
}