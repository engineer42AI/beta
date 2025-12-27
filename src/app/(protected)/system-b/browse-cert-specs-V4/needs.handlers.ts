// src/app/(protected)/system-b/browse-cert-specs-V4/needs.handlers.ts
"use client";

import { orchestrator } from "@/lib/pageOrchestrator";
import { registerHandlerOnce } from "@/lib/orchestrator/registerOnce";
import { useCS25ChatStore } from "./stores/chat-store";
import { useNeedsLogStore } from "./stores/needs-store-logger-and-debugger";

type HandlerFn = (msg: any) => void;

export const NEEDS_WF = {
  SYNC: "needs.sync",
  STOP: "needs.stop",
} as const;

const KEY = "v6"; // bump when semantics change

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const ENDPOINT = "/cs25/agent_langgraph/run/stream";

// PERF knobs
const FLUSH_MS = 60;     // batch flush cadence (~16fps)
const PROGRESS_MS = 150; // throttle progress updates

// per-tab stream control
const inflight = new Map<string, AbortController>(); // tabId -> AbortController
const backendRunIdByTab = new Map<string, string>(); // tabId -> backend run_id

// derived progress from items
const countsByTab = new Map<string, { total: number; done: number }>();

function join(base: string, path: string) {
  const b = (base || "").replace(/\/+$/, "");
  const p0 = (path || "").replace(/^\/+/, "");

  // avoid /api/api duplication (mirrors your agent handler)
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
          // ignore partial/bad lines
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

function normalizeNeedsType(chunk: any) {
  const rawType = String(chunk?.type ?? "");
  if (!rawType) return chunk;

  // Useful while backend is transitioning
  if (rawType.startsWith("needsTable.")) {
    return { ...chunk, type: rawType.replace(/^needsTable\./, "needsTables.") };
  }
  return chunk;
}

function toNumber(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export function registerNeedsHandlers() {
  const logNeeds = (e: {
    level?: "info" | "warn" | "error";
    event: string;
    tabId: string;
    runId?: string;
    message?: string;
    data?: any;
  }) => {
    useNeedsLogStore.getState().push({
      level: e.level ?? "info",
      event: e.event,
      tabId: e.tabId,
      runId: e.runId,
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
    backendRunIdByTab.delete(tabId);
    countsByTab.delete(tabId);

    logNeeds({ event: "needs.stop", tabId, message: "Stopped + aborted inflight" });

    orchestrator.sendToConsole(
      NEEDS_WF.STOP,
      { payload: { tabId } },
      "Needs stopped"
    );
  };

  /* ---------------- SYNC (freeze/unfreeze) ---------------- */
  const onSync: HandlerFn = async ({ payload, metadata }) => {
    const state = orchestrator.getState?.() ?? {};
    const { route, pageId, tabId } = state.binding ?? {};
    if (!route || !tabId) return;

    // Must match runId passed from page.tsx for debugger grouping
    const WORK_RUN_KEY = String(metadata?.runId ?? `needs-${Date.now()}`);
    const REQ_ID = `needs-${tabId}-${Date.now()}`;

    const meta = (extra?: any) =>
      pageId
        ? { route, tabId, pageId, runId: WORK_RUN_KEY, reqId: REQ_ID, ...(extra ?? {}) }
        : { route, tabId, runId: WORK_RUN_KEY, reqId: REQ_ID, ...(extra ?? {}) };

    const chatKey = `${route}::${tabId}`;
    // Build request
    const rawFrozen = payload?.selections_frozen;
    const selections_frozen =
      rawFrozen === true ||
      rawFrozen === "true" ||
      rawFrozen === 1 ||
      rawFrozen === "1";

    const isFreeze = selections_frozen === true;

    if (!isFreeze) {
      // ✅ clear/hide any “Needs: building table” progress so console doesn’t show 0/0
      useCS25ChatStore.getState().clearProgress?.(chatKey, "needs");
      // if you don’t have clearProgress yet, see Fix 1b below
    }

    // Abort any previous stream on this tab
    const prev = inflight.get(tabId);
    if (prev) prev.abort();
    inflight.delete(tabId);
    backendRunIdByTab.delete(tabId);
    countsByTab.delete(tabId);





    const selections_frozen_at = String(payload?.selections_frozen_at ?? "");
    const snapshotRows = Array.isArray(payload?.snapshotRows)
      ? payload.snapshotRows
      : [];
    const query = selections_frozen ? "__needs_freeze__" : "__needs_unfreeze__";

    const url = join(BASE, ENDPOINT);

    const body = {
      req_id: REQ_ID,
      tab_id: tabId,
      query,
      context: {
        sink: "needs",
        selections_frozen,
        selections_frozen_at,
        snapshotRows,
      },
    };

    // ---------- LOG start ----------
    logNeeds({
      event: "needs.sync.start",
      tabId,
      runId: WORK_RUN_KEY,
      message: `start (${query})`,
      data: { selections_frozen, selections_frozen_at, snapshotRowsCount: snapshotRows.length },
    });

    logNeeds({
      event: "needs.sync.request",
      tabId,
      runId: WORK_RUN_KEY,
      data: { url, bodyPreview: { req_id: REQ_ID, tab_id: tabId, query, context: body.context } },
    });

    orchestrator.sendToConsole(
      NEEDS_WF.SYNC,
      { payload: { phase: "started" }, metadata: meta({ event: "started" }) },
      "Needs sync started"
    );

    // Seed chat progress
    if (isFreeze) {
      useCS25ChatStore.getState().upsertProgress(chatKey, {
        runId: WORK_RUN_KEY,
        tabId,
        phase: "start",
        total: 0,
        done: 0,
        pct: 0,
        label: "Needs: building table",
      });
    }

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
      const aborted = ac.signal.aborted;
      const message = aborted ? "Aborted." : `Network error: ${String(e?.message ?? e)}`;

      logNeeds({
        level: aborted ? "warn" : "error",
        event: "needs.sync.fetch_error",
        tabId,
        runId: WORK_RUN_KEY,
        message,
      });

      orchestrator.sendToConsole(
        NEEDS_WF.SYNC,
        { payload: { message }, metadata: meta({ event: aborted ? "aborted" : "error" }) },
        aborted ? "Needs sync aborted" : "Needs sync network error"
      );

      inflight.delete(tabId);
      countsByTab.delete(tabId);
      return;
    }

    logNeeds({
      event: "needs.sync.http",
      tabId,
      runId: WORK_RUN_KEY,
      data: { ok: res.ok, status: res.status },
    });

    if (!res.ok) {
      const details = await res.text().catch(() => "");
      logNeeds({
        level: "error",
        event: "needs.sync.http_error",
        tabId,
        runId: WORK_RUN_KEY,
        message: `HTTP ${res.status}`,
        data: { details: details?.slice?.(0, 1200) ?? details },
      });

      orchestrator.sendToConsole(
        NEEDS_WF.SYNC,
        {
          payload: { httpStatus: res.status, details },
          metadata: meta({ event: "error", httpStatus: res.status }),
        },
        `Needs sync HTTP ${res.status}`
      );
      inflight.delete(tabId);
      countsByTab.delete(tabId);
      return;
    }

    /* ------------ Delivery helper ------------ */
    // MUST be sendToPage so page.tsx onDeliver sees it.
    const sendToPage = (chunk: any) => {
      orchestrator.sendToPage(
        "needsTables.event",
        { payload: chunk, metadata: meta({ event: "progress" }) },
        "Needs tables event"
      );
    };

    /* ------------ Progress helpers ------------ */
    let lastProgressTs = 0;

    const setProgress = (done: number, total: number, phase?: "tick" | "done") => {
      if (!isFreeze) return; // ✅ do not drive progress bar on unfreeze
      const safeTotal = toNumber(total, 0);
      const safeDone = toNumber(done, 0);
      const pct = !safeTotal ? 0 : Math.floor((safeDone / safeTotal) * 100);

      useCS25ChatStore.getState().upsertProgress(chatKey, {
        runId: WORK_RUN_KEY,
        tabId,
        phase: phase ?? (safeTotal && safeDone >= safeTotal ? "done" : "tick"),
        total: safeTotal,
        done: safeDone,
        pct,
        label: "Needs: building table",
      });

      // drive the page meta even if backend doesn’t emit progress
      sendToPage({ type: "needsTables.progress", done: safeDone, total: safeTotal, sink: "needs" });
    };

    const ensureCounts = () => {
      const c = countsByTab.get(tabId);
      if (c) return c;
      const seeded = { total: 0, done: 0 };
      countsByTab.set(tabId, seeded);
      return seeded;
    };

    const bumpDone = (inc: number, maybeTotal?: number) => {
      const c = ensureCounts();
      if (typeof maybeTotal === "number" && maybeTotal > 0 && (!c.total || maybeTotal > c.total)) {
        c.total = maybeTotal;
      }
      c.done += Math.max(0, inc || 0);
      if (c.total > 0) c.done = Math.min(c.done, c.total);
      countsByTab.set(tabId, c);

      const now = Date.now();
      if (now - lastProgressTs >= PROGRESS_MS) {
        lastProgressTs = now;
        setProgress(c.done, c.total);
      }
    };

    /* ------------ batching ------------ */
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let bufferedItems: any[] = [];

    const flushItems = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!bufferedItems.length) return;

      const items = bufferedItems.map((c) => c?.item).filter(Boolean);
      bufferedItems = [];

      sendToPage({ type: "needsTables.itemsBatch", items });

      const maybeTotal = toNumber(items?.[0]?.total, 0);
      bumpDone(items.length, maybeTotal > 0 ? maybeTotal : undefined);
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flushItems, FLUSH_MS);
    };

    try {
      for await (const raw of readNdjson(res)) {
        const chunk = normalizeNeedsType(raw);
        const type = String(chunk?.type ?? "?");

        // sink filter: Only accept needsTables.* events from the needs sink
        if (type.startsWith("needsTables.") && String(chunk?.sink ?? "") !== "needs") {
          continue;
        }

        // log major lifecycle chunks only (keeps log readable)
        if (
          type === "run_start" ||
          type === "run_end" ||
          type === "needsTables.runStart" ||
          type === "needsTables.runEnd"
        ) {
          logNeeds({
            event: "needs.stream.lifecycle",
            tabId,
            runId: WORK_RUN_KEY,
            data: { type, sink: chunk?.sink, run_id: chunk?.run_id },
          });
        }

        // run bookkeeping
        if (type === "run_start") {
          const backendRunId = String(chunk?.run_id ?? "");
          if (backendRunId) backendRunIdByTab.set(tabId, backendRunId);
          continue;
        }

        const activeBackend = backendRunIdByTab.get(tabId);
        if (chunk?.run_id && activeBackend && String(chunk.run_id) !== activeBackend) continue;

        if (type === "run_end") {
          backendRunIdByTab.delete(tabId);
          continue;
        }

        // needsTables.runStart
        if (type === "needsTables.runStart") {
          flushItems();

          const total = toNumber(chunk?.data?.total ?? chunk?.data?.count ?? chunk?.total, 0);
          countsByTab.set(tabId, { total, done: 0 });

          sendToPage(chunk);
          setProgress(0, total, "tick");
          continue;
        }

        // needsTables.item
        if (type === "needsTables.item") {
          bufferedItems.push(chunk);
          scheduleFlush();

          const maybeTotal = toNumber(chunk?.item?.total, 0);
          bumpDone(1, maybeTotal > 0 ? maybeTotal : undefined);
          continue;
        }

        // needsTables.itemsBatch from backend
        if (type === "needsTables.itemsBatch") {
          const items = Array.isArray(chunk?.items) ? chunk.items : [];
          const maybeTotal = toNumber(items?.[0]?.total, 0);
          if (items.length) bumpDone(items.length, maybeTotal > 0 ? maybeTotal : undefined);
          sendToPage(chunk);
          continue;
        }

        // backend progress
        if (type === "needsTables.progress") {
          const now = Date.now();
          if (now - lastProgressTs < PROGRESS_MS) continue;
          lastProgressTs = now;

          const done = toNumber(chunk?.done, 0);
          const total = toNumber(chunk?.total, 0);

          const c = ensureCounts();
          if (total > 0) c.total = total;
          if (Number.isFinite(done)) c.done = done;
          if (c.total > 0) c.done = Math.min(c.done, c.total);
          countsByTab.set(tabId, c);

          setProgress(c.done, c.total);
          continue;
        }

        // needsTables.runEnd
        if (type === "needsTables.runEnd") {
          flushItems();
          sendToPage(chunk);

          const c = ensureCounts();
          const finalTotal = c.total > 0 ? c.total : c.done;
          setProgress(finalTotal, finalTotal, "done");

          countsByTab.delete(tabId);
          continue;
        }

        // ignore other chunks
      }

      flushItems();

      const c = countsByTab.get(tabId);
      if (c && c.total > 0 && c.done >= c.total) {
        setProgress(c.total, c.total, "done");
      }

      logNeeds({
        event: "needs.sync.success",
        tabId,
        runId: WORK_RUN_KEY,
        message: "Stream finished cleanly",
      });

      orchestrator.sendToConsole(
        NEEDS_WF.SYNC,
        { payload: { phase: "success" }, metadata: meta({ event: "success" }) },
        "Needs sync success"
      );
    } catch (e: any) {
      flushItems();

      const aborted = ac.signal.aborted;
      const message = aborted ? "Aborted." : `Stream error: ${String(e?.message ?? e)}`;

      logNeeds({
        level: aborted ? "warn" : "error",
        event: "needs.sync.stream_error",
        tabId,
        runId: WORK_RUN_KEY,
        message,
      });

      orchestrator.sendToConsole(
        NEEDS_WF.SYNC,
        { payload: { message }, metadata: meta({ event: aborted ? "aborted" : "error" }) },
        aborted ? "Needs sync aborted" : "Needs sync stream error"
      );
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      inflight.delete(tabId);
      backendRunIdByTab.delete(tabId);
      countsByTab.delete(tabId);
    }
  };

  /* ---------------- Register (HMR/StrictMode safe) ---------------- */
  registerHandlerOnce(orchestrator, NEEDS_WF.STOP, `needs.stop/${KEY}`, onStop);
  registerHandlerOnce(orchestrator, NEEDS_WF.SYNC, `needs.sync/${KEY}`, onSync);

  orchestrator.sendToConsole(
    "needs.debug",
    { payload: { msg: "Needs handlers (re)registered" } },
    "Needs handlers ready"
  );
}

// Dev helper
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as any).e42NeedsRewire = () => registerNeedsHandlers();
}