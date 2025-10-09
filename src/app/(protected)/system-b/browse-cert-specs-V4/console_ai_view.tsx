// src/app/(protected)/system-b/browse-cert-specs-V4/console_ai_view.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { orchestrator, type OrchestratorState, type WireEntry } from "@/lib/pageOrchestrator";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Inspector } from "react-inspector";

export default function ConsoleAiView() {
  // live orchestrator state + wire feed
  const [state, setState] = useState<OrchestratorState>(orchestrator.getState?.() ?? {});
  const [wire, setWire] = useState<WireEntry[]>([]);

  useEffect(() => orchestrator.subscribe?.(setState), []);
  useEffect(() => orchestrator.subscribeWire?.(setWire), []);

  // Only show messages the orchestrator addressed to the console (e.g., state:emit).
  const rows = useMemo(
    () =>
      [...wire]
        .filter((e) => e.to === "console")
        .sort((a, b) => b.ts - a.ts), // newest first
    [wire]
  );

  const binding = state.binding;
  const status = state.status ?? "idle";

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      {/* Context card */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs text-muted-foreground">
            route <span className="font-mono ml-1">{binding?.route ?? "—"}</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="text-xs text-muted-foreground">
            page <span className="font-mono ml-1">{binding?.pageId?.slice(0, 8) ?? "—"}</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="text-xs text-muted-foreground">
            tab <span className="font-mono ml-1">{binding?.tabId ?? "—"}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[11px]"
            >
              status: <span className="ml-1 font-mono">{status}</span>
            </Badge>
            {state.lastError && (
              <Badge className="text-[11px] bg-red-600 text-white">
                error: <span className="ml-1">{state.lastError}</span>
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Wire feed to console */}
      <Card className="p-0 flex-1 min-h-0">
        <div className="px-3 py-2 border-b bg-muted/40 text-[11px] text-muted-foreground">
          Orchestrator → Console (newest first)
        </div>

        <div className="min-h-0">
          {rows.length === 0 && (
            <div className="px-3 py-6 text-xs text-muted-foreground">No console-directed events yet.</div>
          )}

          {rows.map((e) => (
            <details key={e.id} className="border-b open:bg-muted/10">
              <summary className="list-none px-3 py-2 grid grid-cols-[120px_1fr_200px] gap-3 items-center cursor-pointer">
                <div className="font-mono tabular-nums text-[11px] text-muted-foreground">
                  {new Date(e.ts).toLocaleTimeString(undefined, { hour12: false })}
                </div>

                <div className="min-w-0 flex items-center gap-2">
                  <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
                    {e.channel}
                  </Badge>
                  <span className="truncate">{e.label ?? "—"}</span>
                </div>

                <div className="text-[11px] text-muted-foreground justify-self-end">
                  <span className="mr-2">
                    from <span className="font-mono">{e.from}</span>
                  </span>
                  <span>
                    to <span className="font-mono">{e.to}</span>
                  </span>
                </div>
              </summary>

              {/* payload inspector */}
              <div className="px-3 pb-3">
                <div className="rounded-md border bg-background">
                  <div className="px-2 py-1.5 border-b text-xs text-muted-foreground">Payload</div>
                  <div className="p-2 overflow-auto">
                    <Inspector
                      theme="chromeLight"
                      table={false}
                      expandLevel={1}
                      sortObjectKeys
                      data={e.payload ?? {}}
                    />
                  </div>
                </div>

                {/* footer context */}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>
                    route <span className="font-mono">{e.route ?? "—"}</span>
                  </span>
                  <span>
                    page <span className="font-mono">{e.pageId?.slice(0, 8) ?? "—"}</span>
                  </span>
                  <span>
                    tab <span className="font-mono">{e.tabId ?? "—"}</span>
                  </span>
                </div>
              </div>
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}