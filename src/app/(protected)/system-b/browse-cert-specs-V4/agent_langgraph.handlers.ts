// src/app/(protected)/system-b/browse-cert-specs-V4/agent_langgraph.handlers.ts
"use client";

import { orchestrator } from "@/lib/pageOrchestrator";
import { registerHandlerOnce } from "@/lib/orchestrator/registerOnce";

import { usePageConfigStore, makeBindingKey } from "@/stores/pageConfig-store";
import { useCS25ChatStore } from "./stores/chat-store";
import { useCS25TraceStore } from "./stores/cs25-trace-store";
import { NEEDS_WF } from "./needs.handlers";

/* --- keep your other top-level maps --- */
const inflight = new Map<string, AbortController>();
const workActive = new Map<string, boolean>();
const progressByTab = new Map<string, { total:number; done:number; tokensIn:number; tokensOut:number; batchCost:number }>();
const processedByRun = new Map<string, Set<string>>();
const backendRunIdByTab = new Map<string, string>();

/* --- global handler stash so we can off() by reference --- */
const KEY = "v1"; // bump if semantics change

type HandlerFn = (msg: any) => void;



function pct(p?: { total:number; done:number }) {
  if (!p || !p.total) return 0;
  return Math.floor((p.done / p.total) * 100);
}

function join(base: string, path: string) {
  const b = (base || "").replace(/\/+$/, "");
  const p0 = (path || "").replace(/^\/+/, "");
  const bTail = b.split("/").pop();
  const pHead = p0.split("/")[0];
  const p = bTail && pHead && bTail === pHead ? p0.split("/").slice(1).join("/") : p0;
  return `${b}/${p}`;
}

async function* readNdjson(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("ReadableStream not available on Response.body");
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
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

function getSelectionsForBinding(route?: string, tabId?: string) {
  if (!route || !tabId) return { selected_ids: [] as string[], metadata: {} as Record<string, any> };
  const key = makeBindingKey(route, tabId);
  const cfg = usePageConfigStore.getState().configs[key] ?? {};
  const selectedTraceIds = Array.isArray(cfg.selectedTraceIds) ? cfg.selectedTraceIds : [];
  return { selected_ids: selectedTraceIds, metadata: { route, bindingKey: key } };
}

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const ENDPOINT = "/cs25/agent_langgraph/run/stream";
const SLOW_PAINT = false;
const tick = () => (SLOW_PAINT ? new Promise<void>(r => setTimeout(r, 0)) : Promise.resolve());

export const AGENT_WF = { RUN: "agent.run", SEND: "agent.send" } as const;
export const AGENT    = { PROGRESS: "agent.run.progress", TRACE_RESULT: "agent.run.trace_result", RUN_START: "agent.run.start", STOP: "agent.run.stop" } as const;

const makeRunId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/* ------------ MAIN: idempotent, HMR-safe registration ------------ */
export function registerAgentLangGraphHandlers() {





  // Define fresh handlers
  const onStop: HandlerFn = ({ payload }) => {
    const tabId = String(payload?.tabId ?? "");
    const runId = String(payload?.runId ?? "");

    const ac = inflight.get(tabId);
    if (ac) ac.abort();
    inflight.delete(tabId);

    progressByTab.delete(tabId);

    const backendRunId = backendRunIdByTab.get(tabId);
    if (backendRunId) processedByRun.delete(backendRunId);
    backendRunIdByTab.delete(tabId);

    if (runId) {
      processedByRun.delete(runId);
      workActive.set(runId, false);
      workActive.delete(runId);
    }

    const state = orchestrator.getState?.() ?? {};
    const { route } = state.binding ?? {};
    const chatKey = `${route ?? ""}::${tabId ?? ""}`;
    if (runId) useCS25ChatStore.getState().markProgressAborted(chatKey, runId);

    orchestrator.sendToConsole(AGENT.PROGRESS, { payload: { type: "aborted", tabId, runId } }, "Agent aborted");
  };

  const onSend: HandlerFn = async ({ payload }) => {
    const uiRunId = makeRunId();
    const state = orchestrator.getState?.() ?? {};
    const { route, pageId, tabId } = state.binding ?? {};
    const chatKey = `${route ?? ""}::${tabId ?? ""}`;

    // Abort previous stream on this tab
    if (tabId) {
      const prev = inflight.get(tabId);
      if (prev) { prev.abort(); inflight.delete(tabId); }
      progressByTab.delete(tabId);
      const oldBackend = backendRunIdByTab.get(tabId);
      if (oldBackend) processedByRun.delete(oldBackend);
      backendRunIdByTab.delete(tabId);
    }

    // Stop NEEDS chatter
    orchestrator.deliver({ from: "orchestrator", to: "orchestrator", channel: NEEDS_WF.STOP, payload: { tabId } });

    const query = String(payload?.query ?? "").trim();
    const context = { ...getSelectionsForBinding(route, tabId), sink: "agent_langgraph" as const };
    const selected_ids: string[] = Array.isArray(context.selected_ids) ? context.selected_ids : [];

    (orchestrator as any).patch?.({ status: "streaming", lastError: null });

    if (!tabId || !route || !query) {
      const reason = !query ? "empty query" : "missing binding";
      orchestrator.sendToConsole("agent.error", { metadata: { runId: uiRunId, reason, route, tabId, pageId } }, "Agent run rejected");
      (orchestrator as any).patch?.({ status: "error", lastError: reason });
      return;
    }

    useCS25ChatStore.getState().add(chatKey, { role: "user", content: query, at: Date.now() });
    orchestrator.sendToConsole("agent.chat", { payload: { role: "user", content: query, runId: uiRunId } }, "Chat: user");

    progressByTab.set(tabId!, { total: 0, done: 0, tokensIn: 0, tokensOut: 0, batchCost: 0 });
    orchestrator.sendToConsole(AGENT.PROGRESS, { payload: { runId: uiRunId, tabId, phase: "seed", total: 0, done: 0, pct: 0 } }, "Progress: seeded");

    const url = join(BASE, ENDPOINT);
    const body = { tab_id: tabId, query, context };

    const ac = new AbortController();
    inflight.set(tabId!, ac);

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
      const message = `Network error: ${String(e?.message ?? e)}`;
      orchestrator.sendToConsole("agent.error", { metadata: { runId: uiRunId, message, route, tabId, pageId } }, "Network error");
      (orchestrator as any).patch?.({ status: "error", lastError: message });
      return;
    }

    orchestrator.sendToConsole("agent.http", { payload: { status: res.status } }, "HTTP status");
    if (!res.ok) {
      const details = await res.text().catch(() => "");
      orchestrator.sendToConsole("agent.error", { metadata: { runId: uiRunId, httpStatus: res.status, details, route, tabId, pageId } }, `HTTP ${res.status}`);
      (orchestrator as any).patch?.({ status: "error", lastError: `HTTP ${res.status}` });
      return;
    }

    const WORK_RUN_KEY = uiRunId;
    try {
      let idx = 0;
      for await (const chunk of readNdjson(res)) {

        // TEMP: see every chunk that reaches the AGENT handler
        const type = String(chunk?.type ?? "?");

        // DEV: double ping so we can’t miss it
        //console.log("[agent.chunk]", { type, sink: chunk?.sink, key: chunk?.key, run_id: chunk?.run_id });
        //useCS25ChatStore.getState().addStatus(chatKey, {
        //  text: `[debug] chunk seen: ${type}${chunk?.key ? ` key=${chunk.key}` : ""}`,
        //  at: Date.now(),
        //  scope: "DEBUG",
        //});

        orchestrator.sendToConsole(
          "agent.chunk",
          {
            payload: {
              type,
              sink: chunk?.sink,
              run_id: chunk?.run_id,
              key: chunk?.key,
              hasValue: Object.prototype.hasOwnProperty.call(chunk ?? {}, "value"),
              hasVal: Object.prototype.hasOwnProperty.call(chunk ?? {}, "val"),
            },
          },
          "Agent: raw chunk"
        );





        if (chunk?.sink && chunk.sink !== "agent_langgraph") { idx++; await tick(); continue; }

        if (type === "run_start") {
          const backendRunId = String(chunk?.run_id ?? "");
          if (backendRunId) backendRunIdByTab.set(tabId!, backendRunId);
          if (!processedByRun.has(WORK_RUN_KEY)) processedByRun.set(WORK_RUN_KEY, new Set<string>());
          orchestrator.sendToConsole("agent.run_start", { payload: { tabId, runId: backendRunId || uiRunId, sink: "agent_langgraph" } }, "Agent run_start");
          idx++; await tick(); continue;
        }

        const activeBackendRunId = backendRunIdByTab.get(tabId!);
        if (chunk?.run_id && activeBackendRunId && chunk.run_id !== activeBackendRunId) { idx++; await tick(); continue; }

        if (type === "run_end") {
          orchestrator.sendToConsole("agent.run_end", { payload: { tabId, runId: chunk?.run_id ?? activeBackendRunId ?? uiRunId } }, "Agent run_end");
          idx++; await tick(); continue;
        }

        const p = progressByTab.get(tabId!) ?? { total: 0, done: 0, tokensIn: 0, tokensOut: 0, batchCost: 0 };
        progressByTab.set(tabId!, p);



        // --- handle state events from agent_langgraph -------------------------------
        if (type === "state") {
          const key = String(chunk.key ?? "");
          // tolerate both .value and .val just in case
          const rawValue = Object.prototype.hasOwnProperty.call(chunk ?? {}, "value")
            ? chunk.value
            : chunk?.val;

          if (key === "system_status") {
            const text = String(rawValue ?? "").trim();
            if (text) {
              useCS25ChatStore.getState().addStatus(chatKey, {
                text,
                at: Date.now(),
                scope: "OUTLINE",
              });
              orchestrator.sendToConsole(
                "agent.state",
                { payload: { key, value: text, sink: "agent_langgraph" } },
                "Agent: system_status"
              );
            }
            idx++; await tick(); continue;
          }

          // ✅ NEW: capture topic updates as a chat row so the UI can show it
          if (key === "topic") {
            const text = String(rawValue ?? "").trim();
            if (text) {
              useCS25ChatStore.getState().addStatus(chatKey, {
                text: `Topic: ${text}`,
                at: Date.now(),
                scope: "TOPIC",
              });
              orchestrator.sendToConsole(
                "agent.state",
                { payload: { key, value: text, sink: "agent_langgraph" } },
                "Agent: topic update"
              );
            }
            idx++; await tick(); continue;
          }


          // Optional: log other state keys for a bit
          orchestrator.sendToConsole(
            "agent.state",
            { payload: { key, valuePreview: String(rawValue).slice(0, 160) } },
            "Agent: state"
          );
          idx++; await tick(); continue;
        }

        if (type.startsWith("findRelevantSections.")) {
          switch (type) {
            case "findRelevantSections.runStart": {
              workActive.set(WORK_RUN_KEY, true);
              if (!processedByRun.has(WORK_RUN_KEY)) processedByRun.set(WORK_RUN_KEY, new Set<string>());
              const totalFromBackend = Number(chunk.total_traces ?? 0);
              const selectedCount = selected_ids.length;
              p.total = selectedCount || totalFromBackend;
              p.done  = processedByRun.get(WORK_RUN_KEY)!.size;
              orchestrator.sendToConsole(AGENT.PROGRESS, { payload: { runId: WORK_RUN_KEY, tabId, phase: "start", total: p.total, done: p.done, pct: pct(p) } }, "Progress: start");
              useCS25ChatStore.getState().upsertProgress(chatKey, { runId: WORK_RUN_KEY, tabId, phase: "start", total: p.total, done: p.done, pct: pct(p) });
              orchestrator.deliver({ from: "orchestrator", to: "page", channel: AGENT.RUN_START, payload: { total: p.total, runId: WORK_RUN_KEY, selected_ids } });
              break;
            }
            case "findRelevantSections.itemDone": {
              if (!workActive.get(WORK_RUN_KEY)) { idx++; await tick(); break; }
              const item = chunk?.item;
              if (item?.trace_uuid) {
                if (!new Set(selected_ids).has(item.trace_uuid)) { idx++; await tick(); break; }
                let seen = processedByRun.get(WORK_RUN_KEY);
                if (!seen) { seen = new Set<string>(); processedByRun.set(WORK_RUN_KEY, seen); }
                seen.add(item.trace_uuid);
                p.done = seen.size;

                useCS25TraceStore.getState().upsert(route!, tabId!, {
                  trace_uuid: item.trace_uuid,
                  relevant: item?.response?.relevant,
                  rationale: item?.response?.rationale,
                  total_cost: item?.usage?.total_cost,
                  backend_run_id: item?.run_id ?? null,
                  work_run_id: WORK_RUN_KEY,
                });

                orchestrator.sendToPage(AGENT.TRACE_RESULT, { payload: item }, "Trace result");
              }
              orchestrator.sendToConsole(AGENT.PROGRESS, { payload: { runId: WORK_RUN_KEY, tabId, phase: "tick", total: p.total, done: p.done, pct: pct(p) } }, "Progress: tick");
              useCS25ChatStore.getState().upsertProgress(chatKey, { runId: WORK_RUN_KEY, tabId, phase: "tick", total: p.total, done: p.done, pct: pct(p) });
              break;
            }
            case "findRelevantSections.batchProgress": {
              p.tokensIn  = Number(chunk.tokens_in  ?? p.tokensIn);
              p.tokensOut = Number(chunk.tokens_out ?? p.tokensOut);
              p.batchCost = Number(chunk.batch_cost ?? p.batchCost);
              orchestrator.sendToConsole(AGENT.PROGRESS, { payload: { runId: WORK_RUN_KEY, tabId, phase: "batch", total: p.total, done: p.done, pct: pct(p), tokensIn: p.tokensIn, tokensOut: p.tokensOut, batchCost: p.batchCost } }, "Progress: batch");
              useCS25ChatStore.getState().upsertProgress(chatKey, { runId: WORK_RUN_KEY, tabId, phase: "batch", total: p.total, done: p.done, pct: pct(p), tokensIn: p.tokensIn, tokensOut: p.tokensOut, batchCost: p.batchCost });
              break;
            }
            case "findRelevantSections.runEnd": {
              workActive.set(WORK_RUN_KEY, false);
              const seen = processedByRun.get(WORK_RUN_KEY);
              if (seen) p.done = seen.size;
              orchestrator.sendToConsole(AGENT.PROGRESS, { payload: { runId: WORK_RUN_KEY, tabId, phase: "done", total: p.total, done: p.done, pct: 100 } }, "Progress: done");
              useCS25ChatStore.getState().upsertProgress(chatKey, { runId: WORK_RUN_KEY, tabId, phase: "done", total: p.total, done: p.done, pct: 100 });
              break;
            }
          }
          idx++; await tick(); continue;
        }

        if (type === "tool_call") {
          const name = String(chunk.name ?? "tool");
          const args = chunk.args ? JSON.stringify(chunk.args) : "";
          useCS25ChatStore.getState().add(chatKey, { role: "tool", content: `Running ${name}${args ? ` ${args}` : ""}…`, at: Date.now() });
          orchestrator.sendToConsole("agent.tool", { payload: { phase: "call", name, args: chunk.args ?? {}, runId: activeBackendRunId || uiRunId } }, "Tool: call");
          idx++; await tick(); continue;
        }

        if (type === "tool_result") {
          const name = String(chunk.name ?? "tool");
          const content = String(chunk.content ?? "Completed.");
          useCS25ChatStore.getState().add(chatKey, { role: "tool", content: `${name}: ${content}`, at: Date.now() });
          orchestrator.sendToConsole("agent.tool", { payload: { phase: "result", name, content, runId: activeBackendRunId || uiRunId } }, "Tool: result");
          idx++; await tick(); continue;
        }

        if (type === "message") {
          const role = String(chunk.role ?? "assistant") as "assistant"|"user"|"tool"|"system";
          const content = typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
          useCS25ChatStore.getState().add(chatKey, { role, content, at: Date.now() });
          orchestrator.sendToConsole("agent.chat", { payload: { role, content, runId: activeBackendRunId || uiRunId } }, "Chat: message");
          idx++; await tick(); continue;
        }

        idx++; await tick();
      }

      orchestrator.sendToConsole("agent.done", { metadata: { runId: backendRunIdByTab.get(tabId!) || uiRunId } }, "Agent stream complete");
      (orchestrator as any).patch?.({ status: "idle" });

    } catch (e: any) {
      const message = `Stream parse error: ${String(e?.message ?? e)}`;
      useCS25ChatStore.getState().add(chatKey, { role: "system", content: message, at: Date.now() });
      orchestrator.sendToConsole("agent.error", { metadata: { runId: backendRunIdByTab.get(tabId!) || uiRunId, message } }, "Stream parse error");
      (orchestrator as any).patch?.({ status: "error", lastError: message });
    } finally {
      inflight.delete(tabId!);
      progressByTab.delete(tabId!);
      processedByRun.delete(WORK_RUN_KEY);
      backendRunIdByTab.delete(tabId!);
      workActive.delete(WORK_RUN_KEY);
    }
  };

  // Register (HMR/StrictMode-safe)
  registerHandlerOnce(orchestrator, AGENT_WF.SEND, `agent.send/${KEY}`, onSend);
  registerHandlerOnce(orchestrator, AGENT.STOP,    `agent.run.stop/${KEY}`, onStop);

  // Tiny breadcrumb in your debug panel
  orchestrator.sendToConsole("agent.debug", { payload: { msg: "Agent handlers (re)registered" } }, "Agent handlers ready");
}

/* Dev rewire helper */
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  window.e42AgentRewire = () => registerAgentLangGraphHandlers();
}