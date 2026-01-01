// src/app/(protected)/system-b/browse-cert-specs-V4/needsPanel.handlers.ts
"use client";

import { orchestrator } from "@/lib/pageOrchestrator";
import { registerHandlerOnce } from "@/lib/orchestrator/registerOnce";
import { useNeedsLogStore } from "./stores/needs-store-logger-and-debugger";

type HandlerFn = (msg: any) => void;

export const NEEDS_PANEL_WF = {
  RUN: "needsPanel.run",
  STOP: "needsPanel.stop",
} as const;

const KEY = "v1";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const ENDPOINT = "/cs25/needs_panel/run/stream";

const inflight = new Map<string, AbortController>(); // tabId -> AbortController

function join(base: string, path: string) {
  const b = (base || "").replace(/\/+$/, "");
  const p0 = (path || "").replace(/^\/+/, "");

  // avoid /api/api duplication (same trick as your other handler)
  const bTail = b.split("/").pop();
  const pHead = p0.split("/")[0];
  const p =
    bTail && pHead && bTail === pHead
      ? p0.split("/").slice(1).join("/")
      : p0;

  return `${b}/${p}`;
}

async function* readNdjson(res: Response): AsyncGenerator<any, void, unknown> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("ReadableStream not available on Response.body");

  const dec = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";

      for (const line of parts) {
        const s = line.trim();
        if (!s) continue;
        try {
          yield JSON.parse(s);
        } catch {
          // ignore malformed/partial lines
        }
      }
    }

    const tail = buf.trim();
    if (tail) {
      try {
        yield JSON.parse(tail);
      } catch {}
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

export function registerNeedsPanelHandlers() {
  const log = (e: {
    level?: "info" | "warn" | "error";
    event: string;
    tabId: string;
    message?: string;
    data?: any;
  }) => {
    useNeedsLogStore.getState().push({
      level: e.level ?? "info",
      event: e.event,
      tabId: e.tabId,
      message: e.message,
      data: e.data,
    });
  };

  /* ---------------- STOP ---------------- */
  const onStop: HandlerFn = ({ payload }) => {
    const tabId = String(
      payload?.tabId ?? orchestrator.getState?.()?.binding?.tabId ?? ""
    );
    if (!tabId) return;

    const ac = inflight.get(tabId);
    if (ac) ac.abort();

    inflight.delete(tabId);

    log({ event: "needsPanel.stop", tabId, message: "Stopped + aborted inflight" });

    orchestrator.sendToPage(
      "needsPanel.event",
      { payload: { type: "needsPanel.aborted" }, metadata: { tabId, sink: "needs_panel" } },
      "Needs panel stopped"
    );
  };

  /* ---------------- RUN ---------------- */
  const onRun: HandlerFn = async ({ payload, metadata }) => {
    const state = orchestrator.getState?.() ?? {};
    const { route, pageId, tabId } = state.binding ?? {};
    if (!route || !tabId) return;

    const query = String(payload?.query ?? "").trim();
    if (!query) return;

    // abort previous
    const prev = inflight.get(tabId);
    if (prev) prev.abort();
    inflight.delete(tabId);

    const url = join(BASE, ENDPOINT);

    const meta = {
      route,
      tabId,
      pageId,
      sink: "needs_panel",
      ...(metadata ?? {}),
    };

    // Optional node overrides supported by backend stream function
    const node_kwargs = payload?.node_kwargs ?? undefined;

    const body = {
      tab_id: tabId,
      payload: { query },
      metadata: meta,
      ...(node_kwargs ? { node_kwargs } : {}),
    };

    log({
      event: "needsPanel.run.start",
      tabId,
      message: "starting stream",
      data: { url, query_len: query.length, has_node_kwargs: !!node_kwargs },
    });

    const ac = new AbortController();
    inflight.set(tabId, ac);

    // send immediate paint event (optional)
    orchestrator.sendToPage(
      "needsPanel.event",
      {
        payload: { type: "needsPanel.runStart", payload: { query_present: true } },
        metadata: meta,
      },
      "Needs panel run start"
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e: any) {
      const aborted = ac.signal.aborted;
      log({
        level: aborted ? "warn" : "error",
        event: "needsPanel.run.fetch_error",
        tabId,
        message: aborted ? "aborted" : String(e?.message ?? e),
      });
      inflight.delete(tabId);
      return;
    }

    if (!res.ok) {
      const details = await res.text().catch(() => "");
      log({
        level: "error",
        event: "needsPanel.run.http_error",
        tabId,
        message: `HTTP ${res.status}`,
        data: { details: details?.slice?.(0, 1200) ?? details },
      });
      inflight.delete(tabId);
      return;
    }

    try {
      for await (const chunk of readNdjson(res)) {
        // Your backend router streams envelopes like:
        // { type, tab_id, payload, metadata }
        // Forward to the page as-is.
        orchestrator.sendToPage(
          "needsPanel.event",
          { payload: chunk, metadata: meta },
          "Needs panel event"
        );
      }

      log({ event: "needsPanel.run.success", tabId, message: "stream finished" });
    } catch (e: any) {
      const aborted = ac.signal.aborted;
      log({
        level: aborted ? "warn" : "error",
        event: "needsPanel.run.stream_error",
        tabId,
        message: aborted ? "aborted" : String(e?.message ?? e),
      });
    } finally {
      inflight.delete(tabId);
      orchestrator.sendToPage(
        "needsPanel.event",
        { payload: { type: "needsPanel.streamEnd" }, metadata: meta },
        "Needs panel end"
      );
    }
  };

  registerHandlerOnce(orchestrator, NEEDS_PANEL_WF.STOP, `needsPanel.stop/${KEY}`, onStop);
  registerHandlerOnce(orchestrator, NEEDS_PANEL_WF.RUN, `needsPanel.run/${KEY}`, onRun);

  orchestrator.sendToConsole(
    "needsPanel.debug",
    { payload: { msg: "Needs panel handlers (re)registered" } },
    "Needs panel handlers ready"
  );
}

// Dev helper
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as any).e42NeedsPanelRewire = () => registerNeedsPanelHandlers();
}