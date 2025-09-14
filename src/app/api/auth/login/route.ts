// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";

export function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/overview";

  const domain = process.env.COGNITO_DOMAIN?.replace(/\/+$/, "");
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!domain || !clientId) {
    return new NextResponse("Cognito not configured", { status: 500 });
  }

  const origin = url.origin;
  const redirectUri =
    process.env.COGNITO_REDIRECT_URI || `${origin}/api/auth/callback`;

  const login =
    `${domain}/login?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&scope=${encodeURIComponent("openid email profile")}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(next)}`;

  return NextResponse.redirect(login);
}