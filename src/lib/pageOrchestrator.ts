"use client";

/** Generic page orchestrator: routes envelopes across channels.
 * - No assumptions about payload vs metadata.
 * - No implicit console logs; only what callers/handlers emit.
 * - Page-specific logic lives in page-local handlers (registered at runtime).
 */

type Unsub = () => void;

export type Binding = { route?: string; pageId?: string; tabId?: string };

export type OrchestratorState = {
  binding?: Binding;
  status?: "idle" | "streaming" | "cancelling" | "error";
  lastError?: string | null;
  meta?: Record<string, any>;
};

export type Role = "page" | "console" | "backend" | "orchestrator";

export type WireEntry = {
  id: string;
  ts: number;
  route?: string;
  pageId?: string;
  tabId?: string;
  from: Role;
  to:   Role;
  channel: string;
  label?: string;   // BLUF-style summary
  payload?: any;    // raw, unformatted data that is transmitted
  metadata?: any;   // contextual info (status, timings, workflow, etc.)
};

export type Envelope = {
  from: Role;
  to:   Role;
  channel: string;
  payload?: any;
  metadata?: any;
};

type Listener<T> = (s: T) => void;
type Handler = (env: Envelope) => void | Promise<void>;

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type OrchestratorPublicState = OrchestratorState;

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
    // Page listens to envelopes where to === "page"
    onDeliver: (env: Envelope) => {},
  };

  /* ---------- handler registry ---------- */
  private handlers = new Map<string, Handler>();

  registerHandler(channel: string, fn: Handler) {
    this.handlers.set(channel, fn);
  }
  unregisterHandler(channel: string) {
    this.handlers.delete(channel);
  }
  unregisterAllHandlers() {
    this.handlers.clear();
  }

  /* ---------- configuration ---------- */
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

  /* ---------- state emit (visible in wire) ---------- */
  private patch(p: Partial<OrchestratorState>) {
    this.state = { ...this.state, ...p };
    this.pushWire({
      from: "orchestrator",
      to: "orchestrator",
      channel: "state:emit",
      label: `Orchestrator state → ${this.state.status}`,
      metadata: {
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
      metadata: binding,
    });
  }

  /* ---------- RECEIVING (inbound to orchestrator) ---------- */

  /** Generic entrypoint (kept for backward compatibility). */
  deliver(env: Envelope) {
    this.receive(env.from, env.channel, { payload: env.payload, metadata: env.metadata });
  }

  /** Receive an envelope from a role to the orchestrator and route to a handler. */
  public receive(from: Role, channel: string, { payload, metadata }: { payload?: any; metadata?: any } = {}) {
    // Log inbound exactly as received
    this.pushWire({
      from,
      to: "orchestrator",
      channel,
      label: `Received: ${channel}`,
      payload,
      metadata,
    });

    const handler = this.handlers.get(channel);
    if (!handler) {
      this.pushWire({
        from: "orchestrator",
        to: "orchestrator",
        channel: "orchestrator:unhandled",
        label: "No handler registered for channel",
        metadata: { channel },
      });
      return;
    }

    try {
      const maybe = handler({ from, to: "orchestrator", channel, payload, metadata });
      if (maybe && typeof (maybe as any).then === "function") {
        (maybe as Promise<void>).catch((err) => {
          this.failGeneric(`Handler error for ${channel}`, { error: String(err) });
        });
      }
    } catch (err: any) {
      this.failGeneric(`Handler error for ${channel}`, { error: String(err?.message ?? err) });
    }
  }

  // Convenience receivers for clarity at callsites
  public receiveFromPage(channel: string, data?: { payload?: any; metadata?: any }) {
    this.receive("page", channel, data ?? {});
  }
  public receiveFromBackend(channel: string, data?: { payload?: any; metadata?: any }) {
    this.receive("backend", channel, data ?? {});
  }
  public receiveFromConsole(channel: string, data?: { payload?: any; metadata?: any }) {
    this.receive("console", channel, data ?? {});
  }

  /** Record a synthetic inbound note (e.g., "backend:req") WITHOUT routing to handlers. */
  public noteIncoming(from: Role, channel: string, { payload, metadata }: { payload?: any; metadata?: any } = {}, label?: string) {
    this.pushWire({
      from,
      to: "orchestrator",
      channel,
      label: label ?? `Incoming: ${channel}`,
      payload,
      metadata,
    });
  }

  /* ---------- SENDING (outbound from orchestrator) ---------- */

  /** Emit an envelope FROM orchestrator to any role (also logged). */
  public emit(to: Role, channel: string, { payload, metadata }: { payload?: any; metadata?: any } = {}, label?: string) {
    this.deps.onDeliver?.({ from: "orchestrator", to, channel, payload, metadata });
    this.pushWire({
      from: "orchestrator",
      to,
      channel,
      label: label ?? `Sent: ${channel}`,
      payload,
      metadata,
    });
  }

  public sendToPage(channel: string, data?: { payload?: any; metadata?: any }, bluf?: string) {
    this.emit("page", channel, data ?? {}, bluf);
  }
  public sendToConsole(channel: string, data?: { payload?: any; metadata?: any }, bluf?: string) {
    this.emit("console", channel, data ?? {}, bluf);
  }
  public sendToBackend(channel: string, data?: { payload?: any; metadata?: any }, bluf?: string) {
    this.emit("backend", channel, data ?? {}, bluf);
  }

  /* ---------- generic failure pulse ---------- */
  private failGeneric(message: string, extra?: any) {
    this.pushWire({
      from: "backend",
      to: "orchestrator",
      channel: "backend:error",
      label: "Handler failed",
      metadata: { message, ...(extra ?? {}) },
    });
    this.patch({ status: "error", lastError: message });
  }
}

export const orchestrator = new PageOrchestrator();
export type { WireEntry };