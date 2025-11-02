"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * The frozen snapshot row shape.
 * page.tsx will build an array of these and pass it in.
 */
export type FrozenNeedRow = {
  trace_uuid: string;
  path_labels: string[];          // cleaned / normalized pills, in order
  relevant: boolean | undefined;  // latest relevance flag for that trace
  rationale: string | undefined;  // latest rationale text
};

/**
 * Tiny relevance indicator chip (green / red / dash).
 * Self-contained copy so we don't import from OutlineUI.
 */
function RelevanceDot({ v }: { v: boolean | undefined }) {
  const cls =
    v === true
      ? "bg-emerald-600"
      : v === false
      ? "bg-red-500"
      : "bg-muted-foreground/40";

  const label =
    v === true ? "Relevant" : v === false ? "Not relevant" : "—";

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`}
        title={label}
        aria-label={label}
      />
      <span className="hidden sm:inline text-[11px] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/**
 * Visually styled "pill" for each part of the trace path.
 * The last pill (the bottom clause) is emphasized.
 */
function PathPills({ parts }: { parts: string[] }) {
  return (
    <div className="flex flex-wrap items-start gap-1 min-w-0">
      {parts.map((p, i) => {
        const isLast = i === parts.length - 1;
        return (
          <span
            key={i}
            className={[
              "inline-flex max-w-[180px] truncate items-center rounded border px-1.5 py-0.5 text-[11px] leading-tight",
              isLast
                ? "bg-foreground text-background border-foreground"
                : "bg-muted/40 text-foreground/80 border-border",
            ].join(" ")}
            title={p}
          >
            {p}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Self-contained Needs Table UI.
 * Renders a two-column grid:
 *  - Column 1: the clause / path the need came from
 *  - Column 2: relevance + rationale (repeated here for clarity)
 *
 * We DO NOT reach into any global state or other modules.
 * We just consume props.
 */
export function NeedsTableUI({
  rows,
  frozenAt,
}: {
  rows: FrozenNeedRow[];
  frozenAt?: string;
}) {
  return (
    <Card className="border border-border rounded-lg overflow-hidden">
      {/* header bar */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-accent/20 px-3 py-2">
        <div className="text-[12px] font-semibold text-foreground">
          Needs Table
        </div>

        <Badge
          variant="outline"
          className="h-5 px-2 text-[10px] rounded-full"
        >
          {rows.length} selected
        </Badge>

        {frozenAt && (
          <div className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            frozen {frozenAt}
          </div>
        )}
      </div>

      {/* column headers */}
      <div className="grid grid-cols-[1fr,1.3fr] items-center text-[11px] font-medium bg-accent/60 text-accent-foreground px-3 py-1.5">
        <div>Trace / Clause</div>
        <div>Relevance &amp; Rationale</div>
      </div>

      {/* body */}
      <div className="divide-y divide-border">
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-muted-foreground italic">
            No relevant selections at freeze time.
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.trace_uuid}
              className={[
                "grid grid-cols-[1fr,1.3fr] gap-3 px-3 py-2 text-[12px] leading-snug",
                "hover:bg-accent/20 transition-colors",
              ].join(" ")}
            >
              {/* LEFT COLUMN: Path pills */}
              <div className="min-w-0">
                <PathPills parts={row.path_labels} />
              </div>

              {/* RIGHT COLUMN: relevance + rationale */}
              <div className="text-[11px] leading-snug text-muted-foreground space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <RelevanceDot v={row.relevant} />
                  {/* small uuid token */}
                  <span className="text-[10px] font-mono text-muted-foreground/70">
                    {row.trace_uuid.slice(0, 6)}…
                    {row.trace_uuid.slice(-4)}
                  </span>
                </div>

                <div className="text-[11px] text-foreground/90 whitespace-pre-wrap break-words">
                  {row.rationale ? (
                    row.rationale
                  ) : (
                    <span className="italic text-muted-foreground/70">
                      (no rationale captured)
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}