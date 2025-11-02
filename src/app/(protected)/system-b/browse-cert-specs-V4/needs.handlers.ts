// src/app/(protected)/system-b/browse-cert-specs-V4/needs.handlers.ts
"use client";

import { orchestrator } from "@/lib/pageOrchestrator";
import { useCS25ChatStore } from "./stores/chat-store";
import { registerHandlerOnce } from "@/lib/orchestrator/registerOnce"; // add at top

type HandlerFn = (msg: any) => void;



const inflight = new Map<string, AbortController>(); // tabId -> AbortController
const runIdByTab = new Map<string, string>();        // tabId -> backend run_id

export const NEEDS_WF = {
  SYNC: "needs.sync",
  STOP: "needs.stop",
} as const;

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const ENDPOINT = "/cs25/agent_langgraph/run/stream";

function join(base: string, path: string) {
  const b = (base || "").replace(/\/+$/, "");
  const p = (path || "").replace(/^\/+/, "");
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
        try { yield JSON.parse(s); } catch {}
      }
    }
    const tail = buf.trim();
    if (tail) { try { yield JSON.parse(tail); } catch {} }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

export function registerNeedsHandlers() {



  // --- onStop: old logic moved here ---
  const onStop: HandlerFn = ({ payload }) => {
    const tabId = String(payload?.tabId ?? "");
    inflight.get(tabId)?.abort();
    inflight.delete(tabId);
    runIdByTab.delete(tabId);
    orchestrator.sendToConsole("needs.progress", { payload: { phase: "aborted", tabId } });
  };

  // --- onSync: old logic moved here ---
  const onSync: HandlerFn = async ({ payload }) => {
    const state = orchestrator.getState?.() ?? {};
    const { route, pageId, tabId } = state.binding ?? {};
    if (!tabId) return;

    const chatKey = `${route ?? ""}::${tabId ?? ""}`;
    const { selections_frozen, selections_frozen_at, snapshotRows } = payload || {};
    const query = selections_frozen ? "__needs_freeze__" : "__needs_unfreeze__";

    const body = {
      tab_id: tabId,
      query,
      context: {
        sink: "needs", // <- tell backend this stream is for NEEDS
        selections_frozen: !!selections_frozen,
        selections_frozen_at: selections_frozen_at || "",
        snapshotRows: Array.isArray(snapshotRows) ? snapshotRows : [],
      },
    };

    const url = join(BASE, ENDPOINT);
    orchestrator.sendToConsole(
      "needs.req",
      { payload: { url, body }, metadata: { route, tabId, pageId } },
      "Needs: request"
    );

    const ac = new AbortController();
    inflight.set(tabId, ac);

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
      orchestrator.sendToConsole("needs.error", { payload: { message: String(e?.message ?? e) } });
      inflight.delete(tabId);
      return;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      orchestrator.sendToConsole("needs.error", { payload: { httpStatus: res.status, details: txt } });
      inflight.delete(tabId);
      return;
    }

    try {
      let idx = 0;
      for await (const chunk of readNdjson(res)) {
        const type = String(chunk?.type ?? "?");

        // Only accept NEEDS sink
        if (chunk?.sink && chunk.sink !== "needs") { idx += 1; continue; }

        if (type === "run_start") {
          const rid = String(chunk?.run_id ?? "");
          if (rid) runIdByTab.set(tabId, rid);
          orchestrator.sendToConsole("needs.run_start", {
            payload: { tabId, runId: rid, sink: "needs" },
            metadata: { idx, route, tabId, pageId },
          });
          idx += 1; continue;
        }

        // Ignore stragglers from old runs
        const activeRunId = runIdByTab.get(tabId);
        if (chunk?.run_id && activeRunId && chunk.run_id !== activeRunId) { idx += 1; continue; }

        if (type === "run_end") {
          orchestrator.sendToConsole("needs.run_end", {
            payload: { tabId, runId: chunk?.run_id ?? activeRunId, sink: "needs" },
            metadata: { idx, route, tabId, pageId },
          });
          runIdByTab.delete(tabId);
          idx += 1; continue;
        }

        // system_status → compact status tick
        if (type === "state" && chunk.key === "system_status") {
          const text = String(chunk.value ?? "").trim();
          if (text) {
            useCS25ChatStore.getState().addStatus(chatKey, {
              text,
              at: Date.now(),
              scope: "NEEDS",
            });
            orchestrator.sendToConsole(
              "needs.state",
              { payload: { key: "system_status", value: text, scope: "NEEDS", sink: "needs" },
                metadata: { idx, route, tabId, pageId } },
              "Needs: system_status"
            );
          }
          idx += 1; continue;
        }

        // message → status-only
        if (type === "message") {
          const content = typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
          useCS25ChatStore.getState().addStatus(chatKey, {
            text: content,
            at: Date.now(),
            scope: "NEEDS",
          });
          orchestrator.sendToConsole(
            "needs.chat",
            { payload: { role: String(chunk.role ?? "assistant"), content, sink: "needs" },
              metadata: { idx, route, tabId, pageId } },
            "Needs: chat (status only)"
          );
          idx += 1; continue;
        }

        // Forward everything else to console for debugging
        orchestrator.sendToConsole("needs.stream", {
          payload: { ...chunk, sink: chunk?.sink ?? "needs" },
          metadata: { idx, tabId, route, pageId },
        });
        idx += 1;
      }

      orchestrator.sendToConsole("needs.done", {
        payload: { tabId, sink: "needs" },
        metadata: { route, tabId, pageId },
      });
    } catch (e: any) {
      orchestrator.sendToConsole("needs.stream_error", { payload: { message: String(e?.message ?? e) } });
    } finally {
      inflight.delete(tabId);
      runIdByTab.delete(tabId);
    }
  };

  // Register once (HMR/StrictMode safe)
  registerHandlerOnce(orchestrator, NEEDS_WF.STOP, "needs.stop/v1", onStop);
  registerHandlerOnce(orchestrator, NEEDS_WF.SYNC, "needs.sync/v1", onSync);

  orchestrator.sendToConsole(
    "needs.debug",
    { payload: { msg: "Needs handlers (re)registered" } },
    "Needs handlers ready"
  );
}