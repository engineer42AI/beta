import { orchestrator } from "@/lib/pageOrchestrator";

/** The single workflow this page uses. Page kicks off with:
 *    orchestrator.receiveFromPage(WF.OUTLINE_LOAD)
 */
export const WF = {
  OUTLINE_LOAD: "outline.load",
} as const;

/** Handler-local backend endpoints (page does not need to know these). */
const ENDPOINTS = {
  outline: "/agents/cs25/outline",
} as const;

const makeRunId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Build flat workflow metadata with increasing step counter. */
function makeSequencer(name: string, runId: string) {
  let step = 0;
  const meta = (event: string, extra?: Record<string, any>) => ({
    name,
    runId,
    event,
    step: ++step,
    ...(extra ?? {}),
  });

  return {
    initialRequest: () =>
      orchestrator.noteIncoming("page", name, { payload: null, metadata: meta("initialRequest") }, "Initial request from page"),

    started:     () =>
      orchestrator.sendToPage(name, { payload: null, metadata: meta("started") }, "Workflow started"),

    progress:    (m?: Record<string, any>, label = "Progress") =>
      orchestrator.sendToPage(name, { payload: null, metadata: meta("progress", m) }, label),

    backendReq:  (m: Record<string, any>, label: string) =>
      orchestrator.noteIncoming("backend", "backend:req", { payload: null, metadata: meta("backend.request", m) }, label),

    backendResp: (raw: any, m: Record<string, any>, label: string) =>
      orchestrator.noteIncoming("backend", "backend:resp", { payload: raw, metadata: meta("backend.response", m) }, label),

    success:     (raw: any, m?: Record<string, any>, label = "Delivered RAW to page") =>
      orchestrator.sendToPage(name, { payload: raw, metadata: meta("success", m) }, label),

    error:       (m: Record<string, any>, label = "Workflow error") =>
      orchestrator.sendToPage(name, { payload: null, metadata: meta("error", m) }, label),

    consoleNote: (channel: string, m: Record<string, any>, label: string) =>
      orchestrator.sendToConsole(channel, { payload: null, metadata: meta("console.note", m) }, label),
  };
}

export function registerOutlineHandlers() {
  orchestrator.unregisterAllHandlers();

  orchestrator.registerHandler(WF.OUTLINE_LOAD, async () => {
    const runId   = makeRunId();
    const started = performance.now();
    const base    = process.env.NEXT_PUBLIC_API_BASE ?? "";
    const url     = `${base}${ENDPOINTS.outline}`;
    const seq     = makeSequencer(WF.OUTLINE_LOAD, runId);

    // 1) page → orchestrator (synthetic)
    seq.initialRequest();

    // 2) started
    seq.started();
    (orchestrator as any).patch?.({ status: "streaming", lastError: null });

    try {
      // 3) backend request (synthetic inbound)
      seq.backendReq({ method: "GET", url }, `HTTP GET → ${url}`);

      // 4) call backend
      const res        = await fetch(url, { cache: "no-store" });
      const httpStatus = res.status;

      // 5) progress: HTTP status observed
      seq.progress({ httpStatus }, "HTTP status observed");

      // 6) error branch
      if (!res.ok) {
        const details = await res.text().catch(() => "");
        seq.error({ httpStatus, message: `HTTP ${httpStatus}`, details });
        (orchestrator as any).patch?.({ status: "error", lastError: `HTTP ${httpStatus}` });
        return;
      }

      // 7) parse + size
      const raw       = await res.json();
      const fetchedAt = new Date().toISOString();

      let bytes: number | null = null;
      const len = res.headers.get("content-length");
      if (len) bytes = Number(len);
      if (bytes == null) { try { bytes = JSON.stringify(raw).length; } catch {} }

      // 8) backend response (synthetic inbound) — include RAW as payload
      seq.backendResp(raw, { httpStatus, bytes }, "Backend responded (outline JSON)");

      // 9) success → send RAW to page
      seq.success(raw, { httpStatus, bytes, fetchedAt });

      // 10) completed timing pulse
      const durationMs = Math.round(performance.now() - started);
      seq.progress({ httpStatus, bytes, durationMs }, "Completed (timing/bytes)");

      // 11) optional console note
      seq.consoleNote("outline.loaded", { httpStatus, bytes, durationMs, fetchedAt, url }, "Outline successfully loaded");

      (orchestrator as any).patch?.({ status: "idle" });
    } catch (err: any) {
      const message = err?.name === "AbortError"
        ? "Request aborted by user"
        : `Request error: ${String(err?.message ?? err)}`;

      seq.error({ message });
      (orchestrator as any).patch?.({ status: "error", lastError: message });
    }
  });
}