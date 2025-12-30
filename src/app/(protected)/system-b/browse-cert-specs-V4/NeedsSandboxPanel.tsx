// src/app/(protected)/system-b/browse-cert-specs-V4/NeedsSandboxPanel.tsx
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X, Wand2, Layers, Compass, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type NeedsSandboxDraft = {
  createdAt: string;
  view: "flat" | "grouped" | "drivers";
  items: any[];      // StreamedNeedItem[]
  clusters?: any;    // NeedsClusterResult
  strands?: any;     // NeedsStrandsResult
};

type Props = {
  open: boolean;
  title?: string;
  draft: NeedsSandboxDraft | null;
  onClose: () => void;
  onApply?: (draft: NeedsSandboxDraft) => void;
};

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

export function NeedsSandboxPanel({
  open,
  title = "Refine working set",
  draft,
  onClose,
  onApply,
}: Props) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const hasDraft = !!draft;
  const items = draft?.items ?? [];
  const view = draft?.view ?? "flat";

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

    const order = [
      "FUNCTIONAL_DESIGN_PERFORMANCE",
      "MATERIALS",
      "MANUFACTURING_METHOD",
      "INTEGRATION_ENVIRONMENT",
      "OTHER",
    ];

    return order
      .filter((k) => (buckets[k] ?? []).length)
      .map((k) => ({ id: k, label: k, items: buckets[k] }));
  }, [draft?.strands, items]);

  // ✅ Now it's safe to return early (all hooks already ran)
  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[12000]">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />

      {/* panel */}
      <aside
        className={[
          "fixed bg-background border-border shadow-xl",
          // mobile
          "inset-x-0 bottom-0 h-[85vh] border-t",
          // desktop
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:bottom-auto sm:h-full sm:w-full sm:max-w-[560px] sm:border-l sm:border-t-0",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Needs refinement sandbox"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
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
        <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
          {hasDraft ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                {items.length} needs
              </Badge>

              <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                <span className="inline-flex items-center gap-1.5">
                  {view === "flat" ? <List className="h-3 w-3" /> : view === "grouped" ? <Layers className="h-3 w-3" /> : <Compass className="h-3 w-3" />}
                  {view}
                </span>
              </Badge>

              <span className="tabular-nums">
                snapshot {new Date(draft.createdAt).toLocaleString()}
              </span>
            </div>
          ) : (
            "No snapshot loaded."
          )}
        </div>

        {/* body */}
        <div className="p-4 space-y-3 overflow-auto h-[calc(100%-112px)]">
          {/* Your “query → ranking → grey-out” area can stay here */}
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="font-medium mb-1">Sandbox workspace</div>
            <div className="text-muted-foreground text-xs">
              Run questions here, review ranked needs, deactivate items, then apply back to the table.
            </div>
          </div>

          {/* ✅ CLONED VIEW */}
          {!hasDraft ? (
            <div className="text-sm text-muted-foreground">No snapshot loaded.</div>
          ) : view === "grouped" ? (
            groupedByClusters ? (
              <div className="space-y-3">
                {groupedByClusters.map((g: any) => (
                  <div key={g.id} className="rounded-md border border-border">
                    <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
                      <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                        {g.id}
                      </Badge>
                      <div className="text-[12px] font-medium">{g.label}</div>
                      <div className="ml-auto text-[11px] text-muted-foreground">{g.items.length}</div>
                    </div>
                    <div className="divide-y divide-border">
                      {g.items.map((it: any) => (
                        <div key={it.need_id} className="px-3 py-2 flex items-start gap-3">
                          <div className="text-[10px] font-mono text-muted-foreground/70 pt-0.5 w-[76px] shrink-0">
                            {displayId(it)}
                          </div>
                          <div className="text-[12px] leading-snug">{displayNeed(it)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Cluster view selected but no cluster data in the snapshot.
              </div>
            )
          ) : view === "drivers" ? (
            groupedByDrivers ? (
              <div className="space-y-3">
                {groupedByDrivers.map((g: any) => (
                  <div key={g.id} className="rounded-md border border-border">
                    <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
                      <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                        {g.id}
                      </Badge>
                      <div className="ml-auto text-[11px] text-muted-foreground">{g.items.length}</div>
                    </div>
                    <div className="divide-y divide-border">
                      {g.items.map((it: any) => (
                        <div key={it.need_id} className="px-3 py-2 flex items-start gap-3">
                          <div className="text-[10px] font-mono text-muted-foreground/70 pt-0.5 w-[76px] shrink-0">
                            {displayId(it)}
                          </div>
                          <div className="text-[12px] leading-snug">{displayNeed(it)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Drivers view selected but no driver tags in the snapshot.
              </div>
            )
          ) : (
            <div className="rounded-md border border-border">
              <div className="px-3 py-2 border-b border-border bg-muted/20 text-[12px] font-medium">
                Needs ({items.length})
              </div>
              <div className="divide-y divide-border">
                {items.map((it: any) => (
                  <div key={it.need_id} className="px-3 py-2 flex items-start gap-3">
                    <div className="text-[10px] font-mono text-muted-foreground/70 pt-0.5 w-[76px] shrink-0">
                      {displayId(it)}
                    </div>
                    <div className="text-[12px] leading-snug">{displayNeed(it)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" onClick={onClose} type="button">
              Close
            </Button>
            <Button onClick={() => draft && onApply?.(draft)} disabled={!draft} type="button">
              Apply to table
            </Button>
          </div>
        </div>
      </aside>
    </div>,
    document.body
  );
}