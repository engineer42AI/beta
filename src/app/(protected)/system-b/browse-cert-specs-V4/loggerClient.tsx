// src/app/(protected)/system-b/browse-cert-specs-V4/loggerClient.tsx

"use client";

import { useMemo } from "react";
import { useNeedsLogStore } from "./stores/needs-store-logger-and-debugger";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function LoggerClient(props: {
  tabId: string | null;
  pageId?: string | null;
}) {
  const tabId = props.tabId ?? "—";
  const pageId = props.pageId ?? null;

  const byTab = useNeedsLogStore((s) => s.byTab);
  const clearTab = useNeedsLogStore((s) => s.clearTab);

  const rows = useMemo(() => byTab[tabId] ?? [], [byTab, tabId]);

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">Needs log</div>

          <Badge variant="outline" className="text-[11px]">
            tab {tabId}
          </Badge>

          {pageId && (
            <Badge variant="outline" className="text-[11px]">
              page {pageId.slice(0, 6)}
            </Badge>
          )}

          <Badge variant="outline" className="text-[11px]">
            {rows.length} events
          </Badge>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          onClick={() => clearTab(tabId)}
          disabled={tabId === "—"}
        >
          Clear
        </Button>
      </div>

      <div className="max-h-[260px] overflow-auto rounded-lg border bg-background">
        {rows.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">No needs logs yet.</div>
        ) : (
          <div className="divide-y">
            {rows
              .slice()
              .reverse()
              .map((r, i) => (
                <div key={`${r.ts}-${i}`} className="p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">
                      [{r.level}] {r.event}
                    </div>
                    <div className="text-muted-foreground">
                      {new Date(r.ts).toLocaleTimeString()}
                    </div>
                  </div>

                  {r.message && <div className="mt-1">{r.message}</div>}

                  {r.runId && (
                    <div className="mt-1 text-muted-foreground">runId: {r.runId}</div>
                  )}

                  {r.data != null && (
                    <pre className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
                      {JSON.stringify(r.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}