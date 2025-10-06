// src/components/console/tools/aiViewRegistry.ts
"use client";

// Map route → lazy importer (add entries as you create views)
const registry: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = {
  "/tests/console-bus-test": () =>
    import("@/app/(protected)/tests/console-bus-test/console_ai_view"),
  "/system-b/browse-cert-specs-V4": () =>
    import("@/app/(protected)/system-b/browse-cert-specs-V4/console_ai_view"),
  // "/system-b/browse-cert-specs-v4": () =>
  //   import("@/app/(protected)/system-b/browse-cert-specs-v4/console_ai_view"),
};

export function hasAiView(route?: string): boolean {
  return !!(route && registry[route]);
}

export async function loadAiView(route: string) {
  const loader = registry[route];
  if (!loader) return null;
  try {
    const mod = await loader();
    return mod.default ?? null;
  } catch {
    return null;
  }
}