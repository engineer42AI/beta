// src/app/(protected)/system-b/browse-cert-specs-V4/NeedsSnapshotCta.tsx
"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, ShieldCheck } from "lucide-react";

export type FrozenNeedRow = {
  trace_uuid: string;
  path_labels: string[];
  relevant: boolean | undefined;
  rationale: string | undefined;
};

export function NeedsSnapshotCta({
  rows,
  onFreeze,
  disabled,
}: {
  rows?: FrozenNeedRow[];   // ✅ optional to avoid runtime crash
  onFreeze: () => void;
  disabled?: boolean;
}) {
  const relevantCount = React.useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return list.filter(r => r.relevant === true).length;
  }, [rows]);

  const isDisabled = disabled ?? relevantCount === 0;

  return (
    <Card className="max-w-lg mx-auto text-center border border-dashed border-border/70 bg-muted/10 rounded-xl p-6 flex flex-col items-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-background border border-border shadow-sm">
        <ClipboardList className="h-6 w-6 text-foreground" strokeWidth={1.5} />
      </div>

      <div className="space-y-1">
        <div className="text-base font-semibold text-foreground">
          Freeze Needs from CS-25
        </div>
        <div className="text-[13px] leading-5 text-muted-foreground max-w-[42ch] mx-auto">
          You’re reviewing which CS-25 clauses are relevant to your system.
          When you’re confident, capture them here and we’ll generate a
          “Needs” snapshot for requirements work.
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 opacity-70" />
          <span>Only traces marked <strong>relevant</strong> will be kept</span>
        </div>
        <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
          {relevantCount} relevant
        </Badge>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
        <Button
          disabled={isDisabled}
          onClick={onFreeze}
          className="text-[12px] h-9 px-3 sm:px-4 w-full sm:w-auto"
        >
          Review &amp; Freeze Needs
        </Button>
      </div>

      <div className="text-[11px] text-muted-foreground/80 leading-snug max-w-[46ch] mx-auto">
        We’ll snapshot the <strong>relevant</strong> clauses (with rationale)
        and show them below as a table to carry into requirement drafting.
      </div>
    </Card>
  );
}