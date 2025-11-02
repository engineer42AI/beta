// src/app/(protected)/system-b/browse-cert-specs-V4/console_ai_view.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { orchestrator, type OrchestratorState, type WireEntry } from "@/lib/pageOrchestrator";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Inspector } from "react-inspector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_WF, AGENT } from "./agent_langgraph.handlers";
import { useCS25ChatStore } from "./stores/chat-store";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Info, ChevronsUpDown, Square } from "lucide-react";

import { registerAgentLangGraphHandlers } from "./agent_langgraph.handlers";


/* ---------------- types ---------------- */

type ActivityItemT = {
  id: string;
  title: string;
  detail?: string;
  tone?: "blue" | "green" | "slate";
  ts?: number;
};

type InlineRun = {
  id: string;
  tabId: string;
  at: number;
  phase: "seed" | "start" | "tick" | "batch" | "done" | "aborted" | "error";
  pct: number;
  total: number;
  done: number;
  tokensIn?: number;
  tokensOut?: number;
  batchCost?: number;
  label: string;
};

/* ---------------- UI helpers ---------------- */

function bubbleCls(role: "user" | "assistant" | "tool") {
  const base =
    "inline-block rounded-2xl px-3 py-2 whitespace-pre-wrap break-words " +
    "shadow-sm ring-1 max-w-[78ch] sm:max-w-[80ch] md:max-w-[85ch]";
  if (role === "user") return base + " bg-primary/10 ring-primary/20 text-foreground";
  if (role === "tool") return base + " bg-accent/40 ring-accent/50 text-muted-foreground";
  return base + " bg-muted/40 ring-border";
}

function ActivityItem({ item }: { item: ActivityItemT }) {
  const tone =
    item.tone === "green"
      ? { dot: "text-emerald-600 dark:text-emerald-400" }
      : item.tone === "slate"
      ? { dot: "text-slate-600 dark:text-slate-300" }
      : { dot: "text-blue-600 dark:text-blue-400" };

  return (
    <div className="flex items-start gap-2 py-1.5">
      <CheckCircle2 className={`h-4 w-4 mt-[2px] ${tone.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium leading-5">{item.title}</div>
        {item.detail && (
          <div className="text-[11px] text-muted-foreground leading-5 line-clamp-2">
            {item.detail}
          </div>
        )}
      </div>
      {item.ts && (
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {new Date(item.ts).toLocaleTimeString(undefined, { hour12: false })}
        </div>
      )}
    </div>
  );
}

function ActivityPanel({ items, defaultOpen = false }: { items: ActivityItemT[]; defaultOpen?: boolean }) {
  if (!items?.length) return null;
  return (
    <Collapsible defaultOpen={defaultOpen} className="w-full">
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 bg-accent/30 text-xs">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 opacity-80" />
          <span className="font-semibold">AI activity</span>
          <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
            {items.length}
          </Badge>
        </div>
        <CollapsibleTrigger className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border hover:bg-black/5 dark:hover:bg-white/5">
          Details
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-70" />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="mt-2 rounded-lg border px-3 py-2 bg-background">
          {items.map((it) => (
            <ActivityItem key={it.id} item={it} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ---------- Minimal status tick row ---------- */

function StatusTickRow({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="inline-flex w-full items-center gap-2 px-1 py-[2px] text-[11px] leading-5 text-muted-foreground"
    >
      <span
        aria-hidden
        className="grid place-items-center h-4 w-4 rounded-full border border-border/60 bg-background/60"
        style={{ lineHeight: 1 }}
      >
        ✓
      </span>
      <span className="whitespace-pre-wrap break-words font-[500] tracking-[-0.005em]">
        {text}
      </span>
    </div>
  );
}

function ProgressInlineBubble({
  run,
  onStop,
}: {
  run: {
    id: string;
    tabId: string;
    at: number;
    phase: "seed" | "start" | "tick" | "batch" | "done" | "aborted" | "error";
    pct: number;
    total: number;
    done: number;
    tokensIn?: number;
    tokensOut?: number;
    batchCost?: number;
    label: string;
  };
  onStop: () => void;
}) {
  const showStop = !(run.phase === "done" || run.phase === "aborted" || run.phase === "error");
  return (
    <div className="inline-block w-full rounded-2xl px-3 py-2 bg-accent/40 ring-1 ring-accent/50 text-muted-foreground shadow-sm">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
        <div className="flex items-center gap-2">
          <span>{run.label}</span>
          <span className="font-mono">{run.done}/{run.total} • {run.pct}%</span>
        </div>
        {showStop && (
          <Button size="sm" variant="outline" onClick={onStop} className="h-7 px-2 text-[11px]">
            <Square className="h-3.5 w-3.5 mr-1" /> Stop
          </Button>
        )}
      </div>

      <div className="h-2 rounded bg-muted overflow-hidden">
        <div
          className={[
            "h-full transition-[width] duration-150",
            run.phase === "error" ? "bg-red-600" :
            run.phase === "aborted" ? "bg-amber-500" :
            "bg-primary"
          ].join(" ")}
          style={{ width: `${run.pct}%` }}
        />
      </div>

      {/*
      // ─── Meta (tokens/cost) — disabled ─────────────────────────────────────

      {(typeof run.tokensIn === "number" ||
        typeof run.tokensOut === "number" ||
        typeof run.batchCost === "number") && (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          {typeof run.tokensIn  === "number" && (
            <span>in: <span className="font-mono">{run.tokensIn}</span></span>
          )}
          {typeof run.tokensOut === "number" && (
            <span>out: <span className="font-mono">{run.tokensOut}</span></span>
          )}
          {typeof run.batchCost === "number" && (
            <span>cost: <span className="font-mono">${run.batchCost.toFixed(4)}</span></span>
          )}
        </div>
      )}
      */}

    </div>
  );
}

/* ---------------- component ---------------- */

export default function ConsoleAiView() {

  useEffect(() => { try { registerAgentLangGraphHandlers(); } catch {} }, []);


  const [state, setState] = useState<OrchestratorState>(orchestrator.getState?.() ?? {});
  const [wire, setWire] = useState<WireEntry[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  // --- auto-scroll to bottom setup ---
  const pageEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
      pageEndRef.current?.scrollIntoView({ behavior, block: "end" });
  };

  // more robust "near bottom" check
  const isNearBottom = () => {
      const docEl = document.documentElement;
      const scrollTop = (window.scrollY ?? window.pageYOffset);
      const viewport = window.innerHeight;
      const fullHeight = Math.max(
        docEl.scrollHeight, docEl.offsetHeight, docEl.clientHeight,
        document.body.scrollHeight, document.body.offsetHeight
      );
      return scrollTop + viewport >= fullHeight - 100;
  };



  useEffect(() => orchestrator.subscribe?.(setState), []);
  useEffect(() => orchestrator.subscribeWire?.(setWire), []);




  const binding = state.binding;
  const status = state.status ?? "idle";

  const chatKey = `${binding?.route ?? ""}::${binding?.tabId ?? ""}`;
  const chatRows   = useCS25ChatStore((s) => s.messages[chatKey] ?? []);
  const statusTicks = useCS25ChatStore((s) => s.statusTicks[chatKey] ?? []);
  const progressRunsRaw = useCS25ChatStore((s) => {
      const byRun = s.progress[chatKey] ?? {};
      return Object.values(byRun);
  });

  // keep only this tab and drop 'seed' if a real phase exists
  const progressRuns = useMemo(() => {
      const runs = progressRunsRaw.filter((r: any) => r.tabId === (state?.binding?.tabId ?? ""));
      const hasReal = runs.some((r: any) => r.phase !== "seed");
      return hasReal ? runs.filter((r: any) => r.phase !== "seed") : runs;
  }, [progressRunsRaw, state?.binding?.tabId]);


  // scroll to bottom once when page loads
  useEffect(() => {
      const id = requestAnimationFrame(() => scrollToBottom("auto"));
      return () => cancelAnimationFrame(id);
  }, []);

  // scroll smoothly when new messages appear (only if user was near bottom)
  useEffect(() => {
      if (isNearBottom()) scrollToBottom("smooth");
  }, [chatRows.length, statusTicks.length, progressRuns.length]);


  /* ---------- console debug view ---------- */
  const debugRows = useMemo(
    () => [...wire].filter((e) => e.to === "console").sort((a, b) => b.ts - a.ts),
    [wire]
  );

  // composer
  const [input, setInput] = useState("");
  const canSend = Boolean(binding?.tabId && binding?.route && input.trim().length > 0);

  const sendQuery = () => {
    const q = input.trim();
    if (!q || !canSend) return;
    orchestrator.receiveFromConsole(AGENT_WF.SEND, { payload: { query: q } });
    setInput("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  };

  const stopRun = (runId?: string) => {
    const tabId = binding?.tabId;
    if (!tabId) return;
    orchestrator.receiveFromConsole(AGENT.STOP, { payload: { tabId, runId } });
  };

  // Do not show topic in the AI Activity panel; it will appear as a tick in the chat stream.
  const activityItems: ActivityItemT[] = [];

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <Card className="p-0">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">Agent Conversation</div>
          <div className="flex items-center gap-2">
            <Button
              variant={showDebug ? "default" : "outline"}
              size="sm"
              className="h-7 text-[12px]"
              onClick={() => setShowDebug((v) => !v)}
            >
              {showDebug ? "Hide debug" : "Show debug"}
            </Button>
          </div>
        </div>

        {/* AI activity (topic changes, etc.) */}
        <div className="px-3 pt-3">
          <div className="mx-auto w-full max-w-[880px]">
            <ActivityPanel items={activityItems} defaultOpen={false} />
          </div>
        </div>

        {/* chat body */}
        <div className="py-3">
          <div className="mx-auto w-full max-w-[880px] px-3 space-y-2">
            {(() => {
              // Bubbles
              const chatMsgs = chatRows
                .filter((m: any) => m?.role !== "topic")
                .map((m, i) => {
                  const role = (m.role as "user" | "assistant" | "tool") ?? "assistant";
                  const isUser = role === "user";
                  const bubble = bubbleCls(role);
                  const Avatar = (
                    <div
                      className={[
                        "h-6 w-6 rounded-full grid place-items-center text-[10px] font-semibold select-none",
                        isUser
                          ? "bg-primary/15 text-primary"
                          : role === "tool"
                          ? "bg-accent/40 text-foreground/70"
                          : "bg-muted/60 text-foreground/70",
                      ].join(" ")}
                      aria-hidden
                    >
                      {isUser ? "You" : role === "tool" ? "TL" : "E42"}
                    </div>
                  );

                  return {
                    kind: "chat" as const,
                    at: (m as any).at ?? (Date.now() + i),
                    render: (
                      <div
                        key={`chat-${i}`}
                        className={[
                          "flex items-start gap-2",
                          isUser ? "justify-end" : "justify-start",
                        ].join(" ")}
                      >
                        {!isUser && Avatar}
                        <div className={bubble}>{m.content}</div>
                        {isUser && Avatar}
                      </div>
                    ),
                  };
                });

              // Status ticks (persisted)
              const ticks = statusTicks.map((t, i) => ({
                kind: "status" as const,
                at: t.at,
                render: <StatusTickRow key={`status-${t.at}-${i}`} text={t.text} />,
              }));

              // Progress bubbles (persisted)
              const runs = progressRuns
                  // keep only this tab (already in key, but safe if reused)
                  .filter((r) => r.tabId === (state?.binding?.tabId ?? ""))
                  .map((r) => ({
                    kind: "progress" as const,
                    at: r.firstAt, // stable placement
                    render: (
                      <ProgressInlineBubble
                        key={`prog-${r.runId}`}
                        run={{
                          id: r.runId,
                          tabId: r.tabId,
                          at: r.firstAt,
                          phase: r.phase,
                          pct: r.pct,
                          total: r.total,
                          done: r.done,
                          tokensIn: r.tokensIn,
                          tokensOut: r.tokensOut,
                          batchCost: r.batchCost,
                          label: r.label,
                        }}
                        onStop={() => {
                          const tabId = state?.binding?.tabId;
                          if (!tabId) return;
                          orchestrator.receiveFromConsole(AGENT.STOP, { payload: { tabId, runId: r.runId } });
                        }}
                      />
                    ),
              }));

              const merged = [...chatMsgs, ...ticks, ...runs].sort((a, b) => a.at - b.at);
              if (merged.length === 0)
                return <div className="text-muted-foreground text-xs">No messages yet.</div>;
              return (
                  <>
                    {merged.map((row) => row.render)}
                  </>
              );
            })()}
          </div>
        </div>

        {/* composer */}
        <div className="border-t bg-muted/20 py-3">
          <div className="mx-auto w-full max-w-[880px] px-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  state?.binding?.tabId
                    ? "Type a message. Enter to send, Shift+Enter for newline…"
                    : "Open an AI tab to begin…"
                }
                className="min-h-[44px] max-h-40"
                disabled={!state?.binding?.tabId}
              />
              <Button onClick={sendQuery} disabled={!canSend} className="self-stretch">
                Send
              </Button>
            </div>
            {!state?.binding?.tabId && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                No tab is bound. Open an AI tab to chat.
              </div>
            )}
          </div>
        </div>
      </Card>

      <div ref={pageEndRef} />   {/* 👈 anchor now below the input area */}

      {/* Debug area */}
      {showDebug && (
        <div className="mt-3 space-y-3">
          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-xs text-muted-foreground">
                route <span className="font-mono ml-1">{state.binding?.route ?? "—"}</span>
              </div>
              <Separator orientation="vertical" className="h-4" />
              <div className="text-xs text-muted-foreground">
                page <span className="font-mono ml-1">{state.binding?.pageId?.slice(0, 8) ?? "—"}</span>
              </div>
              <Separator orientation="vertical" className="h-4" />
              <div className="text-xs text-muted-foreground">
                tab <span className="font-mono ml-1">{state.binding?.tabId ?? "—"}</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Badge variant="outline" className="text-[11px]">
                  status: <span className="ml-1 font-mono">{state.status ?? "idle"}</span>
                </Badge>
                {state.lastError && (
                  <Badge className="text-[11px] bg-red-600 text-white">
                    error: <span className="ml-1">{state.lastError}</span>
                  </Badge>
                )}
              </div>
            </div>
          </Card>

          <div>
            <div className="px-0 py-1 text-[11px] text-muted-foreground">
              Orchestrator → Console events (newest first)
            </div>
            <div className="space-y-2">
              {[...wire].filter((e) => e.to === "console").sort((a, b) => b.ts - a.ts).length === 0 ? (
                <div className="text-xs text-muted-foreground">No console-directed events yet.</div>
              ) : (
                [...wire]
                  .filter((e) => e.to === "console")
                  .sort((a, b) => b.ts - a.ts)
                  .map((e) => (
                    <details key={e.id} className="border rounded-md">
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

                      <div className="px-3 pb-3">
                        {typeof e.payload !== "undefined" && (
                          <div className="rounded-md border bg-background mb-2">
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
                        )}
                        {typeof e.metadata !== "undefined" && (
                          <div className="rounded-md border bg-background">
                            <div className="px-2 py-1.5 border-b text-xs text-muted-foreground">Metadata</div>
                            <div className="p-2 overflow-auto">
                              <Inspector
                                theme="chromeLight"
                                table={false}
                                expandLevel={1}
                                sortObjectKeys
                                data={e.metadata ?? {}}
                              />
                            </div>
                          </div>
                        )}

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
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}