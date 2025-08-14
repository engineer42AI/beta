// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";

export function GET(req: Request) {
  const domain = process.env.COGNITO_DOMAIN!;
  const clientId = process.env.COGNITO_CLIENT_ID!;
  const redirectUri = encodeURIComponent(process.env.COGNITO_REDIRECT_URI!);

  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/overview";

  const login =
    `${domain}/login?client_id=${clientId}` +
    `&response_type=code&scope=openid+email+profile` +
    `&redirect_uri=${redirectUri}` +
    `&state=${encodeURIComponent(next)}`;

  return NextResponse.redirect(login);
}
