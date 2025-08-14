// middleware.ts (repo root)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/graph", "/docs", "/settings"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip API and static files
  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (/\.(.*)$/.test(pathname)) return NextResponse.next();

  // Protect the chosen prefixes
  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const hasId = req.cookies.get("e42_it")?.value;
    if (!hasId) {
      const url = new URL("/api/auth/login", req.url);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}
