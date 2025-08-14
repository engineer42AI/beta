import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/cognito";

const isProd = process.env.NODE_ENV === "production";
const cookieOpts = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const base = process.env.APP_BASE_URL || "/";

  if (!code) return NextResponse.redirect(base);

  const tokens = await exchangeCodeForTokens(code);
  const res = NextResponse.redirect(base);

  const exp = new Date(Date.now() + tokens.expires_in * 1000);
  res.cookies.set("e42_at", tokens.access_token, { ...cookieOpts, expires: exp });
  res.cookies.set("e42_it", tokens.id_token,    { ...cookieOpts, expires: exp });
  if (tokens.refresh_token) {
    // 30 days for refresh
    res.cookies.set("e42_rt", tokens.refresh_token, { ...cookieOpts, expires: new Date(Date.now() + 30*24*3600*1000) });
  }

  return res;
}
