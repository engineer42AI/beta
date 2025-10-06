// src/lib/consoleLinker.ts
"use client";

import { logSystem, logWarn } from "@/lib/logger";

/** Minimal types the linker needs */
export type AIBinding = {
  route: string;
  pageId: string;
  manifest?: {
    tabId: string;
    route: string;
    pageId: string;
    title?: string;
    flowId?: string;
    // any page-local state your app stores
    cs25?: { selectedTraceIds?: string[]; lastQuery?: string };
    session?: { threadId?: string; runId?: string; checkpointId?: string };
  };
};
export type AIBindings = Record<string, AIBinding>;

type LinkerInput = {
  tabs: { ai: Array<{ id: string; title: string }> };
  aiBindings: AIBindings;
  activeTabId: Record<"ai" | "logs" | "traces" | "tasks", string | null>;
};

/** Decide which pageId to use when an AI tab is being created on a route. */
export function planNewTabBinding(opts: {
  route: string;
  currentPageId?: string | undefined;
  existing: AIBindings;
  makeId: () => string;
}): { pageId: string; mode: "auto" | "seed" } {
  // Prefer the page instance that is already active for this route (prevents churn).
  if (opts.currentPageId) {
    return { pageId: opts.currentPageId, mode: "auto" };
  }
  // Otherwise, seed a fresh pageId (unique across existing bindings).
  let pageId = opts.makeId();
  const used = new Set(Object.values(opts.existing).map(b => b.pageId));
  while (used.has(pageId)) pageId = opts.makeId();
  return { pageId, mode: "seed" };
}

/** Ensure that a given tabId is linked to a specific (route, pageId). Logs inside. */
export function ensureLinked(
  aiBindings: AIBindings,
  tabId: string,
  route: string,
  desiredPageId: string
): { next: AIBindings; changed: boolean } {
  const current = aiBindings[tabId];
  // Create
  if (!current) {
    const next: AIBindings = {
      ...aiBindings,
      [tabId]: { route, pageId: desiredPageId, manifest: { tabId, route, pageId: desiredPageId } },
    };
    logSystem(
      "linker:ensure:created",
      { tabId, route, pageId: desiredPageId },
      "console/linker",
      "Linker: created link between this tab and page"
    );
    return { next, changed: true };
  }
  // Update
  if (current.route !== route || current.pageId !== desiredPageId) {
    const next: AIBindings = {
      ...aiBindings,
      [tabId]: { ...current, route, pageId: desiredPageId, manifest: { ...(current.manifest ?? { tabId, route, pageId: desiredPageId }), route, pageId: desiredPageId } },
    };
    logSystem(
      "linker:ensure:updated",
      { tabId, from: { route: current.route, pageId: current.pageId }, to: { route, pageId: desiredPageId } },
      "console/linker",
      "Linker: updated which page this tab is linked to"
    );
    return { next, changed: true };
  }
  // No change
  return { next: aiBindings, changed: false };
}

/** Fast lookup for route → tabIds. */
export function findTabsByRoute(bindings: AIBindings, route: string): string[] {
  return Object.entries(bindings)
    .filter(([, b]) => b.route === route)
    .map(([tid]) => tid);
}

/** Validate that bindings are coherent with tabs and the active tab/route. Logs only on problems. */
export function validateBindings(input: LinkerInput, currentRoute?: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const aiTabIds = new Set(input.tabs.ai.map(t => t.id));

  // 1) Binding must point to an existing tab
  for (const [tabId, b] of Object.entries(input.aiBindings)) {
    if (!aiTabIds.has(tabId)) {
      issues.push(`Binding points to a missing tab (tabId=${tabId}, route=${b.route}).`);
    }
  }

  // 2) Every AI tab should have a binding
  for (const t of input.tabs.ai) {
    if (!input.aiBindings[t.id]) {
      issues.push(`AI tab "${t.title}" (tabId=${t.id}) has no binding.`);
    }
  }

  // 3) Active tab should match current route
  try {
    const route = typeof window !== "undefined" ? (currentRoute ?? window.location.pathname) : currentRoute;
    const active = input.activeTabId.ai ? input.aiBindings[input.activeTabId.ai] : undefined;
    if (route && active && active.route !== route) {
      issues.push(`Active AI tab is bound to a different page (tab route="${active.route}" vs current route="${route}").`);
    }
  } catch { /* noop */ }

  if (issues.length) {
    logWarn(
      "linker:validate:issues",
      { issues },
      "console/validate",
      "Linker: tab ↔ page links have problems"
    );
  }
  return { ok: issues.length === 0, issues };
}

/** Remove a binding when a tab is closed. */
export function removeBinding(
  aiBindings: AIBindings,
  tabId: string
): { next: AIBindings; changed: boolean } {
  if (!aiBindings[tabId]) return { next: aiBindings, changed: false };

  const { [tabId]: removed, ...rest } = aiBindings;
  logSystem(
    "linker:ensure:removed",
    { tabId, route: removed.route, pageId: removed.pageId },
    "console/linker",
    "Linker: removed link because the tab was closed"
  );
  return { next: rest, changed: true };
}