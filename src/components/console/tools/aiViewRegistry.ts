// src/components/console/tools/aiViewRegistry.ts
"use client";

type AnyViewModule = { default?: React.ComponentType<any>; ConsoleAiView?: React.ComponentType<any> };

function normalizeRoute(route?: string): string {
  if (!route) return "/";
  // strip one leading route-group like /(protected)
  let r = route.replace(/^\/\([^/]+\)(?=\/)/, "");
  // collapse multiple slashes
  r = r.replace(/\/+/g, "/");
  // remove trailing slash (but keep root "/")
  if (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  return r;
}

/** Registry uses *prefix* so children routes still match the page family */
const entries: Array<{
  prefix: string;                      // normalized prefix
  loader: () => Promise<AnyViewModule>;// dynamic import
}> = [
  {
    prefix: "/system-b/browse-cert-specs-V4",
    loader: () => import("@/app/(protected)/system-b/browse-cert-specs-V4/console_ai_view"),
  },
  {
    prefix: "/tests/console-bus-test",
    loader: () => import("@/app/(protected)/tests/console-bus-test/console_ai_view"),
  },
];

export function listRegisteredAiViewRoutes(): string[] {
  return entries.map(e => e.prefix);
}

function findEntry(raw?: string) {
  const n = normalizeRoute(raw);
  return entries.find(e => n.startsWith(e.prefix));
}

export function hasAiView(route?: string): boolean {
  return !!findEntry(route);
}

export async function loadAiView(route: string) {
  const entry = findEntry(route);
  if (!entry) return null;
  try {
    const mod = await entry.loader();
    // accept either default export or a named `ConsoleAiView`
    const Cmp = (mod.default ?? mod.ConsoleAiView) as React.ComponentType<any> | undefined;
    return Cmp ?? null;
  } catch (err) {
    console.error("[aiViewRegistry] load failed for", entry.prefix, err);
    return null;
  }
}