// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { clearAuthCookies } from "@/lib/cognito";

export function GET() {
  clearAuthCookies();
  const domain = process.env.COGNITO_DOMAIN!;
  const clientId = process.env.COGNITO_CLIENT_ID!;
  const appBase = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  const url = `${domain}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(appBase)}`;
  return NextResponse.redirect(url);
}