// src/app/(protected)/system-b/browse-cert-specs-V4/NeedsSandboxPanel.tsx
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  X,
  Wand2,
  Layers,
  Compass,
  List,
  Loader2,
  AlertTriangle,
  Search,
  BookOpen,
  Pin,
  Flag,
  Ban,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/** ---------------- patch workflow types ---------------- */

export type NeedDecisionStatus = "active" | "descoped" | "flagged" | "pinned";

export type NeedDecision = {
  status: NeedDecisionStatus;
  reason?: string;
  note?: string;
  updatedAt: string;
};

export type NeedsEval = {
  ok: boolean;
  trigger: boolean;
  confidence: number;
  message: string;
  query: string;
  ts: string;
};

export type NeedsDecisionsMap = Record<string, NeedDecision>;
export type NeedsEvalsMap = Record<string, NeedsEval>;

export type NeedsSandboxApplyPatch = {
  tabId: string;
  decisions: NeedsDecisionsMap; // overlay decisions (status, reason, note)
  evals: NeedsEvalsMap; // last run evals (optional but very useful)
  summary: {
    changed: number;
    descoped: number;
    flagged: number;
    pinned: number;
    reactivated: number;
    noted: number;
    evals: number;
  };
};

export type NeedsSandboxDraft = {
  createdAt: string;
  view: "flat" | "grouped" | "drivers";
  items: any[];
  clusters?: any;
  strands?: any;
};

type Props = {
  open: boolean;
  tabId: string;
  title?: string;
  draft: NeedsSandboxDraft | null;
  initialDecisions?: NeedsDecisionsMap;
  initialEvals?: NeedsEvalsMap;
  onClose: () => void;
  onApply?: (patch: NeedsSandboxApplyPatch) => void;
};

/** ---------------- helpers ---------------- */

function displayNeed(it: any) {
  const headline = (it?.headline ?? "").trim();
  if (headline) return headline;
  const stmt = (it?.statement ?? "").trim();
  return stmt ? stmt.slice(0, 140) : "(missing need text)";
}

function displayId(it: any) {
  const code = (it?.need_code ?? "").trim();
  if (code) return code;
  const id = String(it?.need_id ?? "");
  return id ? `${id.slice(0, 6)}…${id.slice(-4)}` : "—";
}

function join(base: string, path: string) {
  const b = (base || "").replace(/\/+$/, "");
  const p0 = (path || "").replace(/^\/+/, "");
  const bTail = b.split("/").pop();
  const pHead = p0.split("/")[0];
  const p = bTail && pHead && bTail === pHead ? p0.split("/").slice(1).join("/") : p0;
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
          // ignore bad/partial line
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

function pickEvt(raw: any) {
  // support both:
  // A) raw is event: {type,payload,metadata}
  // B) raw is envelope: {payload:{type,payload,metadata}}
  if (raw?.payload?.type) return raw.payload;
  return raw;
}

function toNumber(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function shallowEqual(a: any, b: any) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function statusChip(status: NeedDecisionStatus) {
  switch (status) {
    case "pinned":
      return { label: "Pinned", icon: Pin };
    case "flagged":
      return { label: "Flagged", icon: Flag };
    case "descoped":
      return { label: "Descoped", icon: Ban };
    default:
      return { label: "Active", icon: Check };
  }
}

/** ---------------- extracted components (FIXES input blur) ---------------- */

type Filter = "ALL" | "APPLIES" | "NOT" | "ERROR" | "PENDING" | "CHANGED";

function PillButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-2 py-1 rounded-full border text-[10px] tabular-nums",
        active ? "bg-accent border-border text-foreground" : "bg-background border-border/60 text-muted-foreground",
        "hover:bg-accent/40",
      ].join(" ")}
      title="Click to filter + jump to first"
    >
      {label} {count}
    </button>
  );
}

function InfoCard({
  title,
  tooltip,
  text,
  Icon,
}: {
  title: string;
  tooltip: string;
  text?: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const v = (text ?? "").trim();
  if (!v) return null;

  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-2 cursor-help select-none">
            <Icon className="h-4 w-4 text-muted-foreground/80" />
            <span className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wide">{title}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>

      <div className="mt-2 text-[11px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">{v}</div>
    </div>
  );
}

function NeedRow({
  it,
  isOpen,
  toggleRow,
  setRowRef,
  result,
  decision,
  effectiveStatus,
  changed,
  setDecision,
  clearDecision,
}: {
  it: any;
  isOpen: boolean;
  toggleRow: (needId: string) => void;
  setRowRef: (needId: string) => (el: HTMLDivElement | null) => void;
  result?: any;
  decision?: NeedDecision;
  effectiveStatus: NeedDecisionStatus;
  changed: boolean;
  setDecision: (needId: string, next: Partial<NeedDecision> & { status: NeedDecisionStatus }) => void;
  clearDecision: (needId: string) => void;
}) {
  const needId = String(it?.need_id ?? "");
  const r = result;

  const ok = r?.ok !== false;
  const trig = r?.trigger === true;

  const statusLabel = !r ? "pending" : !ok ? "error" : trig ? "applies" : "not";

  const statusBadge =
    statusLabel === "applies"
      ? "✅ applies"
      : statusLabel === "not"
      ? "— not"
      : statusLabel === "error"
      ? "⚠️ error"
      : "… pending";

  const chip = statusChip(effectiveStatus);
  const ChipIcon = chip.icon;

  return (
    <div
        ref={setRowRef(needId)}
        className={[
          "relative rounded-md border border-border overflow-hidden bg-background",
          "transition-colors",
          isOpen ? "bg-muted/20 shadow-sm" : "hover:bg-accent/10",
        ].join(" ")}
    >
      {/* LEFT RAIL */}
      <span
          aria-hidden
          className={[
            "absolute inset-y-0 left-0 w-1",
            "pointer-events-none z-10",          // ✅ add
            isOpen ? "bg-primary" : "bg-transparent",
          ].join(" ")}
      />

      <button
        type="button"
        onClick={() => toggleRow(needId)}
        className={[
          "w-full text-left px-3 py-2 flex items-start gap-3",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-inset",
          effectiveStatus === "descoped" ? "opacity-70" : "",
        ].join(" ")}
      >
        <div className="text-[10px] font-mono text-muted-foreground/70 pt-0.5 w-[76px] shrink-0">
          {displayId(it)}
        </div>

        <div className="flex-1">
          <div className="text-[12px] leading-snug">{displayNeed(it)}</div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className="px-2 py-0.5 rounded-full border border-border/70 bg-background/60">{statusBadge}</span>

            <span className="px-2 py-0.5 rounded-full border border-border/70 bg-background/60 inline-flex items-center gap-1.5">
              <ChipIcon className="h-3 w-3" />
              {chip.label}
            </span>

            {r?.message ? (
              <span
                className={[
                  "italic text-muted-foreground",
                  isOpen
                    ? "block w-full whitespace-pre-wrap break-words mt-1" // full text when open
                    : "line-clamp-1", // 1-line preview when closed
                ].join(" ")}
              >
                {String(r.message)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="text-[12px] text-muted-foreground pt-0.5">{isOpen ? "–" : "+"}</div>
      </button>

      {isOpen && (
        <div className="px-3 pb-3">
          {/* action bar */}
          <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
            <Button
              variant={effectiveStatus === "active" ? "secondary" : "outline"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                clearDecision(needId);
              }}
              type="button"
            >
              <Check className="h-3 w-3 mr-1" />
              Keep
            </Button>

            <Button
              variant={effectiveStatus === "pinned" ? "secondary" : "outline"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                setDecision(needId, { status: "pinned" });
              }}
              type="button"
            >
              <Pin className="h-3.5 w-3.5 mr-1.5" />
              Pin
            </Button>

            <Button
              variant={effectiveStatus === "flagged" ? "secondary" : "outline"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                setDecision(needId, { status: "flagged" });
              }}
              type="button"
            >
              <Flag className="h-3.5 w-3.5 mr-1.5" />
              Flag
            </Button>

            <Button
              variant={effectiveStatus === "descoped" ? "secondary" : "outline"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                setDecision(needId, { status: "descoped" });
              }}
              type="button"
            >
              <Ban className="h-3.5 w-3.5 mr-1.5" />
              De-scope
            </Button>

            <div className="ml-auto text-[10px] text-muted-foreground tabular-nums">
              {changed ? "pending change" : "no change"}
            </div>
          </div>

          {/* reason/note (only if user has a decision) */}
          {decision ? (
            <div className="px-1 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                value={decision?.reason ?? ""}
                onChange={(e) => setDecision(needId, { status: effectiveStatus, reason: e.target.value })}
                placeholder="Reason…"
                className="h-7 px-2 text-[11px] placeholder:text-[11px]"
                onClick={(e) => e.stopPropagation()}
              />
              <Input
                value={decision?.note ?? ""}
                onChange={(e) => setDecision(needId, { status: effectiveStatus, note: e.target.value })}
                placeholder="Note…"
                className="h-7 px-2 text-[11px] placeholder:text-[11px]"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ) : null}

          {/* details */}
          <div className="mb-3 px-1">
              <div className="rounded-md border border-border bg-background/60 p-3">
                <div className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wide">
                  Need statement
                </div>
                <div className="mt-1 text-[12px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">
                  {it.statement ?? ""}
                </div>
              </div>
          </div>

          <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
            <InfoCard
              title="Why this matters"
              tooltip="The reasoning behind why this need exists."
              text={it.rationale}
              Icon={AlertTriangle}
            />
            <InfoCard
              title="Why this applies here"
              tooltip="Why this is relevant to the current context."
              text={it.relevance_rationale}
              Icon={Search}
            />
            <InfoCard
              title="Regulatory intent"
              tooltip="What the regulation is trying to achieve."
              text={it.intent_summary_trace ?? it.intent_summary_section}
              Icon={BookOpen}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** ---------------- component ---------------- */

export function NeedsSandboxPanel({
  open,
  tabId,
  title = "Refine working set",
  draft,
  initialDecisions,
  initialEvals,
  onClose,
  onApply,
}: Props) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
  const SYNC_ENDPOINT = "/cs25/needs_panel/state/sync";
  const RUN_ENDPOINT = "/cs25/needs_panel/run/stream";

  const [query, setQuery] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // eval results from backend run: need_id -> payload
  const [rawResults, setRawResults] = React.useState<Record<string, any>>({});
  const [evals, setEvals] = React.useState<NeedsEvalsMap>(() => initialEvals ?? {});

  // decisions overlay (the patch)
  const [decisions, setDecisions] = React.useState<NeedsDecisionsMap>(() => initialDecisions ?? {});
  const baseDecisionsRef = React.useRef<NeedsDecisionsMap>(initialDecisions ?? {});
  const baseEvalsRef = React.useRef<NeedsEvalsMap>(initialEvals ?? {});

  // expandable rows
  const [openRow, setOpenRow] = React.useState<Record<string, boolean>>({});
  const toggleRow = React.useCallback((needId: string) => {
    setOpenRow((s) => ({ ...s, [needId]: !s[needId] }));
  }, []);

  // pills / filtering
  const [filter, setFilter] = React.useState<Filter>("ALL");

  // row refs for jump
  const rowRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const setRowRef = React.useCallback(
    (needId: string) => (el: HTMLDivElement | null) => {
      rowRefs.current[needId] = el;
    },
    []
  );

  const hasDraft = !!draft;
  const items = draft?.items ?? [];
  const view = draft?.view ?? "flat";

  // groupers
  const groupedByClusters = React.useMemo(() => {
    const clusters = draft?.clusters;
    if (!clusters?.map) return null;

    const buckets: Record<string, any[]> = {};
    for (const it of items) {
      const cid = clusters.map[it.need_id] ?? "UNCLUSTERED";
      (buckets[cid] ||= []).push(it);
    }

    const ordered = (clusters.clusters ?? [])
      .map((c: any) => ({
        id: c.cluster_id,
        label: c.label ?? c.cluster_id,
        items: buckets[c.cluster_id] ?? [],
      }))
      .filter((g: any) => g.items.length);

    if ((buckets["UNCLUSTERED"] ?? []).length) {
      ordered.push({ id: "UNCLUSTERED", label: "Unclustered", items: buckets["UNCLUSTERED"] });
    }
    return ordered;
  }, [draft?.clusters, items]);

  const groupedByDrivers = React.useMemo(() => {
    const strands = draft?.strands;
    if (!strands?.map) return null;

    const buckets: Record<string, any[]> = {};
    for (const it of items) {
      const s = strands.map[it.need_id]?.strand ?? "OTHER";
      (buckets[s] ||= []).push(it);
    }

    const order = ["FUNCTIONAL_DESIGN_PERFORMANCE", "MATERIALS", "MANUFACTURING_METHOD", "INTEGRATION_ENVIRONMENT", "OTHER"];

    return order
      .filter((k) => (buckets[k] ?? []).length)
      .map((k) => ({ id: k, label: k, items: buckets[k] }));
  }, [draft?.strands, items]);

  const changedNeedIds = React.useMemo(() => {
    const base = baseDecisionsRef.current ?? {};
    const ids = new Set<string>();
    for (const it of items) {
      const id = it?.need_id;
      if (!id) continue;
      const a = base[id];
      const b = decisions[id];
      if (!shallowEqual(a, b)) ids.add(id);
    }
    return ids;
  }, [items, decisions]);

  // derive counts for pills
  const counts = React.useMemo(() => {
    let applies = 0;
    let not = 0;
    let err = 0;
    let pending = 0;

    for (const it of items) {
      const r = rawResults[it.need_id];
      if (!r) {
        pending += 1;
        continue;
      }
      if (r?.ok === false) {
        err += 1;
        continue;
      }
      if (r?.trigger === true) applies += 1;
      else not += 1;
    }

    return { applies, not, err, pending, changed: changedNeedIds.size, total: items.length };
  }, [items, rawResults, changedNeedIds.size]);

  const isVisible = React.useCallback(
    (it: any) => {
      const id = it?.need_id;
      if (!id) return false;

      if (filter === "ALL") return true;
      if (filter === "CHANGED") return changedNeedIds.has(id);

      const r = rawResults[id];
      if (filter === "PENDING") return !r;
      if (!r) return false;
      if (filter === "ERROR") return r?.ok === false;
      if (filter === "APPLIES") return r?.ok !== false && r?.trigger === true;
      if (filter === "NOT") return r?.ok !== false && r?.trigger !== true;

      return true;
    },
    [filter, rawResults, changedNeedIds]
  );

  const jumpToFirst = React.useCallback(
    (f: Filter) => {
      setFilter(f);
      queueMicrotask(() => {
        const list = items.filter(isVisible);
        const first = list[0]?.need_id;
        if (!first) return;
        rowRefs.current[first]?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [items, isVisible]
  );

  const setDecision = React.useCallback(
    (needId: string, next: Partial<NeedDecision> & { status: NeedDecisionStatus }) => {
      setDecisions((prev) => ({
        ...prev,
        [needId]: {
          status: next.status,
          reason: next.reason ?? prev[needId]?.reason,
          note: next.note ?? prev[needId]?.note,
          updatedAt: nowIso(),
        },
      }));
    },
    []
  );

  const clearDecision = React.useCallback((needId: string) => {
    // "Active" means: remove overlay entry if you want a clean diff.
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[needId];
      return next;
    });
  }, []);

  const bulkDescopeNot = React.useCallback(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const id = it?.need_id;
        if (!id) continue;
        const r = rawResults[id];
        if (r && r?.ok !== false && r?.trigger !== true) {
          next[id] = { status: "descoped", updatedAt: nowIso(), reason: next[id]?.reason, note: next[id]?.note };
        }
      }
      return next;
    });
    setFilter("CHANGED");
  }, [items, rawResults]);

  const bulkPinApplies = React.useCallback(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const id = it?.need_id;
        if (!id) continue;
        const r = rawResults[id];
        if (r && r?.ok !== false && r?.trigger === true) {
          next[id] = { status: "pinned", updatedAt: nowIso(), reason: next[id]?.reason, note: next[id]?.note };
        }
      }
      return next;
    });
    setFilter("CHANGED");
  }, [items, rawResults]);

  const resetToBase = React.useCallback(() => {
    setDecisions(baseDecisionsRef.current ?? {});
    setEvals(baseEvalsRef.current ?? {});
    setFilter("ALL");
  }, []);

  const run = React.useCallback(async () => {
    if (!tabId) return;
    if (!draft || !draft.items?.length) return;

    const q = query.trim();
    if (!q) return;

    setRunning(true);
    setErrorMsg(null);
    setRawResults({});
    setProgress({ done: 0, total: draft.items.length });
    setFilter("ALL");

    const syncUrl = join(BASE, SYNC_ENDPOINT);
    const runUrl = join(BASE, RUN_ENDPOINT);

    const runId =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

    try {
      const draftPayload = {
        createdAt: draft.createdAt,
        view: draft.view,
        items: draft.items,
        clusters: draft.clusters,
        strands: draft.strands,
      };

      // --- SYNC ---
      const syncRes = await fetch(syncUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          tab_id: tabId,
          payload: { draft: draftPayload, ...draftPayload },
          metadata: { sink: "needs_panel", runId },
        }),
      });

      if (!syncRes.ok) {
        const txt = await syncRes.text().catch(() => "");
        throw new Error(`SYNC failed: HTTP ${syncRes.status} ${txt}`);
      }

      // --- RUN stream ---
      const res = await fetch(runUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          tab_id: tabId,
          payload: { query: q, draft: draftPayload },
          metadata: { sink: "needs_panel", runId },
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`RUN failed: HTTP ${res.status} ${txt}`);
      }

      const ts = nowIso();

      for await (const raw of readNdjson(res)) {
        const evt = pickEvt(raw);
        const type = String(evt?.type ?? "");

        if (type === "needsPanel.runStart") {
          const total = toNumber(evt?.payload?.total ?? draft.items.length, draft.items.length);
          setProgress({ done: 0, total });
          continue;
        }

        if (type === "needsPanel.progress") {
          const done = toNumber(evt?.payload?.done, 0);
          const total = toNumber(evt?.payload?.total, 0);
          setProgress((p) => ({
            done: total > 0 ? done : p.done,
            total: total > 0 ? total : p.total,
          }));
          continue;
        }

        if (type === "needsPanel.item") {
          const needId = String(evt?.payload?.need_id ?? "");
          if (!needId) continue;

          setRawResults((prev) => ({ ...prev, [needId]: evt.payload }));
          setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + 1) }));

          // normalize into evals map (persistable overlay)
          const ok = evt?.payload?.ok !== false;
          const trigger = evt?.payload?.trigger === true;
          const confidence = toNumber(evt?.payload?.confidence, 0);
          const message = String(evt?.payload?.message ?? "");

          setEvals((prev) => ({
            ...prev,
            [needId]: { ok, trigger, confidence, message, query: q, ts },
          }));

          continue;
        }

        if (type === "needsPanel.runEnd") {
          setRunning(false);
          continue;
        }

        if (type === "needsPanel.error") {
          const msg = String(evt?.payload?.message ?? evt?.payload?.error ?? "Backend error");
          console.warn("[NeedsSandboxPanel] backend error", evt?.payload);
          setErrorMsg(msg);
          setRunning(false);
          continue;
        }
      }

      setRunning(false);
    } catch (e: any) {
      console.warn("[NeedsSandboxPanel] run failed", e);
      setErrorMsg(String(e?.message ?? e));
      setRunning(false);
    }
  }, [BASE, SYNC_ENDPOINT, RUN_ENDPOINT, tabId, draft, query]);

  const apply = React.useCallback(() => {
    const base = baseDecisionsRef.current ?? {};

    let changed = 0,
      descoped = 0,
      flagged = 0,
      pinned = 0,
      reactivated = 0,
      noted = 0;

    // count decision diffs across ids in union
    const ids = new Set<string>([...Object.keys(base), ...Object.keys(decisions)]);

    for (const id of ids) {
      const a = base[id];
      const b = decisions[id];
      if (!shallowEqual(a, b)) {
        changed += 1;

        const aStatus = a?.status ?? "active";
        const bStatus = b?.status ?? "active";

        if (aStatus === "descoped" && bStatus !== "descoped") reactivated += 1;
        if (bStatus === "descoped") descoped += 1;
        if (bStatus === "flagged") flagged += 1;
        if (bStatus === "pinned") pinned += 1;
        if ((b?.note ?? "").trim()) noted += 1;
      }
    }

    const evalCount = Object.keys(evals ?? {}).length;

    onApply?.({
      tabId,
      decisions,
      evals,
      summary: { changed, descoped, flagged, pinned, reactivated, noted, evals: evalCount },
    });
  }, [tabId, decisions, evals, onApply]);

  if (!mounted || !open) return null;

  const dirty = changedNeedIds.size > 0 || !shallowEqual(baseEvalsRef.current ?? {}, evals ?? {});

  // filtered rendering helpers (keeps grouped views consistent)
  const renderList = (list: any[]) => {
    const visible = list.filter(isVisible);
    if (!visible.length) {
      return <div className="px-3 py-3 text-[12px] text-muted-foreground italic">No items in this filter.</div>;
    }

    return (
      <div className="px-3 pb-3 space-y-2">
        {visible.map((it) => {
          const needId = String(it?.need_id ?? "");
          const decision = decisions[needId];
          const effectiveStatus: NeedDecisionStatus = decision?.status ?? "active";
          const result = rawResults[needId];
          const isOpen = !!openRow[needId];

          return (
            <NeedRow
              key={needId}
              it={it}
              isOpen={isOpen}
              toggleRow={toggleRow}
              setRowRef={setRowRef}
              result={result}
              decision={decision}
              effectiveStatus={effectiveStatus}
              changed={changedNeedIds.has(needId)}
              setDecision={setDecision}
              clearDecision={clearDecision}
            />
          );
        })}
      </div>
    );
  };

  return createPortal(
    <TooltipProvider delayDuration={200}>
      {/* overflow-hidden prevents the page behind from "stealing" scroll */}
      <div className="fixed inset-0 z-[12000] overflow-hidden">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />

        <aside
          className={[
            "fixed bg-background border-border shadow-xl",
            "inset-x-0 bottom-0 h-[85vh] border-t",
            "sm:inset-y-0 sm:right-0 sm:left-auto sm:bottom-auto sm:h-full sm:w-full sm:max-w-[560px] sm:border-l sm:border-t-0",
            // ✅ FLEX LAYOUT FIX: allows body to scroll reliably
            "flex flex-col",
          ].join(" ")}
          role="dialog"
          aria-modal="true"
          aria-label="Needs refinement sandbox"
          onClick={(e) => e.stopPropagation()}
        >
          {/* header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" />
              <div className="font-semibold">{title}</div>
            </div>
            <button
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              onClick={onClose}
              aria-label="Close"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* context */}
          <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground space-y-2 shrink-0">
            {hasDraft ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                    {items.length} needs
                  </Badge>

                  <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                    <span className="inline-flex items-center gap-1.5">
                      {view === "flat" ? (
                        <List className="h-3 w-3" />
                      ) : view === "grouped" ? (
                        <Layers className="h-3 w-3" />
                      ) : (
                        <Compass className="h-3 w-3" />
                      )}
                      {view}
                    </span>
                  </Badge>

                  <span className="tabular-nums">snapshot {new Date(draft!.createdAt).toLocaleString()}</span>

                  <span className="ml-auto text-[10px] tabular-nums">
                    {dirty ? `${changedNeedIds.size} changes pending` : "no pending changes"}
                  </span>
                </div>

                {/* query + run */}
                <div className="flex items-center gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask a question to triage this working set…"
                    className="h-8 text-[12px]"
                  />
                  <Button size="sm" className="h-8 text-[12px]" onClick={run} disabled={running || !query.trim()} type="button">
                    {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Run
                  </Button>
                </div>

                {/* pills + progress */}
                <div className="flex flex-wrap items-center gap-2">
                  <PillButton label="All" count={counts.total} active={filter === "ALL"} onClick={() => jumpToFirst("ALL")} />
                  <PillButton
                    label="Applies"
                    count={counts.applies}
                    active={filter === "APPLIES"}
                    onClick={() => jumpToFirst("APPLIES")}
                  />
                  <PillButton label="Not" count={counts.not} active={filter === "NOT"} onClick={() => jumpToFirst("NOT")} />
                  <PillButton
                    label="Errors"
                    count={counts.err}
                    active={filter === "ERROR"}
                    onClick={() => jumpToFirst("ERROR")}
                  />
                  <PillButton
                    label="Pending"
                    count={counts.pending}
                    active={filter === "PENDING"}
                    onClick={() => jumpToFirst("PENDING")}
                  />
                  <PillButton
                    label="Changed"
                    count={counts.changed}
                    active={filter === "CHANGED"}
                    onClick={() => jumpToFirst("CHANGED")}
                  />

                  <div className="ml-auto text-[10px] tabular-nums">
                    {running ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        scanning {progress.done}/{progress.total}
                      </span>
                    ) : (
                      <span>ready</span>
                    )}
                  </div>
                </div>

                {/* bulk actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={bulkDescopeNot}
                    disabled={!Object.keys(rawResults).length}
                    type="button"
                    title="Set De-scope on all items evaluated as Not"
                  >
                    <Ban className="h-3.5 w-3.5 mr-1.5" />
                    De-scope Not
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={bulkPinApplies}
                    disabled={!Object.keys(rawResults).length}
                    type="button"
                    title="Set Pin on all items evaluated as Applies"
                  >
                    <Pin className="h-3.5 w-3.5 mr-1.5" />
                    Pin Applies
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={resetToBase}
                    type="button"
                    title="Reset decisions/evals to what the table currently has"
                  >
                    Reset
                  </Button>
                </div>

                {errorMsg ? <div className="text-[11px] text-red-600">{errorMsg}</div> : null}
              </>
            ) : (
              "No snapshot loaded."
            )}
          </div>

          {/* ✅ BODY SCROLL FIX: flex-1 + min-h-0 */}
          <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
            {!hasDraft ? (
              <div className="p-4 text-sm text-muted-foreground">No snapshot loaded.</div>
            ) : view === "grouped" ? (
              groupedByClusters ? (
                <div className="p-4 space-y-3">
                  {groupedByClusters
                    .map((g: any) => ({ ...g, items: (g.items ?? []).filter(isVisible) }))
                    .filter((g: any) => g.items.length)
                    .map((g: any) => (
                      <div key={g.id} className="rounded-md border border-border">
                        <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
                          <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                            {g.id}
                          </Badge>
                          <div className="text-[12px] font-medium">{g.label}</div>
                          <div className="ml-auto text-[11px] text-muted-foreground">{g.items.length}</div>
                        </div>
                        {renderList(g.items)}
                      </div>
                    ))}
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">Cluster view selected but no cluster data.</div>
              )
            ) : view === "drivers" ? (
              groupedByDrivers ? (
                <div className="p-4 space-y-3">
                  {groupedByDrivers
                    .map((g: any) => ({ ...g, items: (g.items ?? []).filter(isVisible) }))
                    .filter((g: any) => g.items.length)
                    .map((g: any) => (
                      <div key={g.id} className="rounded-md border border-border">
                        <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
                          <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                            {g.id}
                          </Badge>
                          <div className="ml-auto text-[11px] text-muted-foreground">{g.items.length}</div>
                        </div>
                        {renderList(g.items)}
                      </div>
                    ))}
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">Drivers view selected but no driver data.</div>
              )
            ) : (
              <div className="p-4">
                <div className="rounded-md border border-border">
                  <div className="px-3 py-2 border-b border-border bg-muted/20 text-[12px] font-medium">
                    Needs ({items.filter(isVisible).length}/{items.length})
                  </div>
                  {renderList(items)}
                </div>
              </div>
            )}

            {/* actions */}
            <div className="p-4 pt-0">
              <div className="flex items-center gap-2 pt-2">
                <Button variant="outline" onClick={onClose} type="button">
                  Close
                </Button>
                <Button onClick={apply} disabled={!draft} type="button">
                  Apply to table
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </TooltipProvider>,
    document.body
  );
}