// src/lib/pageOrchestrator.ts
// src/lib/orchestrator/pageOrchestrator.ts
"use client";

/** Minimal, generic page orchestrator (only: load outline) — with BLUF labels */

type Unsub = () => void;

export type Binding = { route?: string; pageId?: string; tabId?: string };

export type OrchestratorState = {
  binding?: Binding;
  status?: "idle" | "streaming" | "cancelling" | "error";
  lastError?: string | null;
  meta?: Record<string, any>;
};

export type WireEntry = {
  id: string;
  ts: number;
  route?: string;
  pageId?: string;
  tabId?: string;
  from: "page" | "console" | "zustand" | "orchestrator" | "backend";
  to:   "page" | "console" | "zustand" | "orchestrator" | "backend";
  channel: string;
  label?: string;   // BLUF-style summary of what this row means
  payload?: any;
};

export type Envelope = {
  from: WireEntry["from"];
  to:   WireEntry["to"];
  channel: string;
  payload?: any;
};

type Listener<T> = (s: T) => void;

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export class PageOrchestrator {
  /* ---------- state ---------- */
  private state: OrchestratorState = {
    status: "idle",
    lastError: null,
    meta: {},
  };

  /* ---------- listeners ---------- */
  private stateSubs = new Set<Listener<OrchestratorState>>();
  private wireSubs  = new Set<Listener<WireEntry[]>>();

  /* ---------- wire buffer ---------- */
  private wire: WireEntry[] = [];
  private wireCap = 500;

  /* ---------- DI ---------- */
  private deps = {
    getBinding: (): Binding | undefined => undefined,
    onDeliver: (env: Envelope) => { /* orchestrator → page */ },
  };

  configure(partial: Partial<typeof this.deps>) {
    this.deps = { ...this.deps, ...partial };
    const b = this.deps.getBinding?.() || {};
    this.setBinding(b);
  }

  /* ---------- public subscribe ---------- */
  getState() { return this.state; }

  subscribe(fn: Listener<OrchestratorState>): Unsub {
    this.stateSubs.add(fn);
    fn(this.state);
    return () => this.stateSubs.delete(fn);
  }

  subscribeWire(fn: Listener<WireEntry[]>): Unsub {
    this.wireSubs.add(fn);
    fn(this.wire.slice());
    return () => this.wireSubs.delete(fn);
  }

  /* ---------- wire utils ---------- */
  private pushWire(entry: Omit<WireEntry,"id"|"ts"|"route"|"pageId"|"tabId">) {
    const full: WireEntry = {
      id: uid(),
      ts: Date.now(),
      route: this.state.binding?.route,
      pageId: this.state.binding?.pageId,
      tabId: this.state.binding?.tabId,
      ...entry,
    };
    this.wire.push(full);
    if (this.wire.length > this.wireCap) this.wire.splice(0, this.wire.length - this.wireCap);
    const snap = this.wire.slice();
    for (const fn of this.wireSubs) fn(snap);
  }

  /** Clear wire log (e.g., when switching tabs). */
  purgeWireForTab(_tabId: string) {
    this.wire = [];
    const snap = this.wire.slice();
    for (const fn of this.wireSubs) fn(snap);
  }

  /* ---------- state emit ---------- */
  private patch(p: Partial<OrchestratorState>) {
    this.state = { ...this.state, ...p };
    // BLUF pulse for dashboards
    this.pushWire({
      from: "orchestrator",
      to: "console",
      channel: "state:emit",
      label: `Orchestrator state → ${this.state.status}`,
      payload: {
        status: this.state.status,
        hasBinding: !!(this.state.binding?.route && this.state.binding?.pageId),
      },
    });
    for (const fn of this.stateSubs) fn(this.state);
  }

  private setBinding(binding: Binding) {
    this.patch({ binding });
    this.pushWire({
      from: "page",
      to: "orchestrator",
      channel: "binding",
      label: "Page bound to orchestrator (route/page/tab captured)",
      payload: binding,
    });
  }

  /* ---------- public API ---------- */
  deliver(env: Envelope) {
    // Log the inbound command
    this.pushWire({
      from: env.from,
      to: "orchestrator",
      channel: env.channel,
      label: `Received command: ${env.channel}`,
      payload: env.payload,
    });

    // Minimal command router (outline only)
    if (env.channel === "page.outline.load") {
      const url: string | undefined = env.payload?.url;
      if (!url) {
        this.failOutline("Missing outline URL in command payload");
        return;
      }
      this.loadOutline(url);
    }
  }

  /* ---------- outline loader (the only job for now) ---------- */
  private async loadOutline(url: string) {
    const started = performance.now();
    this.patch({ status: "streaming", lastError: null });

    this.pushWire({
      from: "orchestrator",
      to: "backend",
      channel: "backend:req",
      label: `HTTP GET → ${url}`,
      payload: { url },
    });

    const ctrl = new AbortController();
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      const httpStatus = res.status;

      // progress pulse with HTTP status
      this.toPage("orch.outline.progress", { httpStatus }, "Outline request in-flight (HTTP status observed)");

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.failOutline(`Outline request failed (HTTP ${httpStatus})`, { httpStatus, details: text });
        return;
      }

      const raw = await res.json();
      const fetchedAt = new Date().toISOString();

      // bytes from header (fallback below)
      let bytes: number | null = null;
      const len = res.headers.get("content-length");
      if (len) bytes = Number(len);
      if (bytes == null) {
        try { bytes = JSON.stringify(raw).length; } catch { /* ignore */ }
      }

      // log backend frame for debug
      this.pushWire({
        from: "backend",
        to: "orchestrator",
        channel: "backend:frame",
        label: "Backend responded with outline JSON",
        payload: { httpStatus, bytes, preview: JSON.stringify(raw).slice(0, 300) },
      });

      // final deliver to page
      this.toPage(
        "page.outline.loaded",
        { raw, httpStatus, bytes, fetchedAt },
        "Delivered outline payload to page"
      );

      // duration pulse
      this.toPage(
        "orch.outline.progress",
        { httpStatus, bytes, durationMs: Math.round(performance.now() - started) },
        "Outline fetch completed (timing/bytes)"
      );

      this.patch({ status: "idle" });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        this.failOutline("Outline request aborted by user");
      } else {
        this.failOutline(`Outline request error: ${String(err?.message ?? err)}`);
      }
    }
  }

  private failOutline(message: string, extra?: any) {
    this.pushWire({
      from: "backend",
      to: "orchestrator",
      channel: "backend:error",
      label: "Outline load failed",
      payload: { message, ...(extra ?? {}) },
    });
    this.toPage("page.outline.error", { message, ...(extra ?? {}) }, "Reported outline error to page");
    this.patch({ status: "error", lastError: message });
  }

  /* ---------- helper: orchestrator → page ---------- */
  private toPage(channel: string, payload?: any, bluf?: string) {
    // DI hook for the page
    this.deps.onDeliver?.({ from: "orchestrator", to: "page", channel, payload });

    // also log to wire for your debug panels
    this.pushWire({
      from: "orchestrator",
      to: "page",
      channel,
      label: bluf ?? `Sent: ${channel}`,
      payload,
    });
  }
}

export const orchestrator = new PageOrchestrator();
export type { WireEntry };