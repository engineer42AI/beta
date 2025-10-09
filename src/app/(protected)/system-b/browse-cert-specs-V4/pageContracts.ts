// src/app/(protected)/system-b/browse-cert-specs-V4/pageContracts.ts

export const CH = {
  // Page → Orchestrator
  PAGE_OUTLINE_LOAD: "page.outline.load",            // payload: { url?: string }

  // Orchestrator → Page (results)
  PAGE_OUTLINE_LOADED: "page.outline.loaded",        // payload: { raw: any, httpStatus: number, bytes: number|null, fetchedAt: string }
  PAGE_OUTLINE_ERROR: "page.outline.error",          // payload: { message: string, httpStatus?: number, details?: any }

  // Orchestrator → Page (progress/metrics, optional)
  ORCH_OUTLINE_PROGRESS: "orch.outline.progress",    // payload: { httpStatus?: number|null, bytes?: number|null, durationMs?: number }
} as const;

export type Channel = (typeof CH)[keyof typeof CH];

export const BACKEND_ENDPOINTS = {
  outline: "/agents/cs25/outline",
} as const;