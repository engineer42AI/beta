"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { IS_PROD } from "@/lib/env";

import { useConsoleStore } from "@/stores/console-store";
import { usePageConfigStore } from "@/stores/pageConfig-store";

import { useCS25TraceStore } from "@/app/(protected)/system-b/browse-cert-specs-V4/stores/cs25-trace-store";
import { useCS25ChatStore } from "@/app/(protected)/system-b/browse-cert-specs-V4/stores/chat-store";

import { useUser } from "@/hooks/useUser";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export default function OverviewPage() {

  const { loading, data } = useUser();

  const u = (data?.user as any) ?? {};
  const fullName =
    [u?.given_name, u?.family_name].filter(Boolean).join(" ") ||
    u?.email ||
    "User";

  const firstName = u?.given_name || fullName.split(" ")[0] || "User";

  // --------- 1) Console bindings (AI tabs bound to pages)
  const aiBindings = useConsoleStore((s) => s.aiBindings);

  const activeBindings = useMemo(() => {
    const rows: { route: string; tabId: string }[] = [];
    for (const [tabId, b] of Object.entries(aiBindings ?? {})) {
      const route = (b as any)?.route;
      if (route) rows.push({ route, tabId });
    }
    return rows;
  }, [aiBindings]);

  const uniqueRoutes = useMemo(() => {
    const s = new Set(activeBindings.map((r) => r.route));
    return s.size;
  }, [activeBindings]);

  // --------- 2) Page configs (selected trace IDs live here)
  const pageConfigs = usePageConfigStore((s) => s.configs);
  const pageConfigKeys = usePageConfigStore((s) => s.listKeys)();

  // focus on CS-25 tool sessions only (you can expand later)
  const CS25_ROUTE = "/system-b/browse-cert-specs-V4";
  const cs25SessionKeys = useMemo(
    () => pageConfigKeys.filter((k) => k.startsWith(`${CS25_ROUTE}::`)),
    [pageConfigKeys]
  );

  const totalSelectedTraceIds = useMemo(() => {
    let total = 0;
    for (const k of cs25SessionKeys) {
      const cfg = (pageConfigs as any)[k];
      const ids = cfg?.selectedTraceIds ?? [];
      if (Array.isArray(ids)) total += ids.length;
    }
    return total;
  }, [pageConfigs, cs25SessionKeys]);

  // --------- 3) Trace store (stored trace outcomes per route::tab)
  const traceByKey = useCS25TraceStore((s) => s.byKey);

  const cs25TraceStats = useMemo(() => {
    let traceItems = 0;      // number of trace records stored
    let relevantTrue = 0;    // how many marked relevant (if present)
    for (const [k, v] of Object.entries(traceByKey ?? {})) {
      if (!k.startsWith(`${CS25_ROUTE}::`)) continue;
      const traces = (v as any)?.traces ?? {};
      for (const t of Object.values(traces)) {
        traceItems += 1;
        if ((t as any)?.relevant === true) relevantTrue += 1;
      }
    }
    return { traceItems, relevantTrue };
  }, [traceByKey]);

  // --------- 4) Chat store (messages stored per route::tab)
  const messages = useCS25ChatStore((s) => s.messages);

  const cs25MessageCount = useMemo(() => {
    let n = 0;
    for (const [k, arr] of Object.entries(messages ?? {})) {
      if (!k.startsWith(`${CS25_ROUTE}::`)) continue;
      if (Array.isArray(arr)) n += arr.length;
    }
    return n;
  }, [messages]);

  // --------- 5) Build a small “session list” for the user
  const cs25Sessions = useMemo(() => {
    return cs25SessionKeys
      .map((k) => {
        const [, tabId] = k.split("::");
        const cfg = (pageConfigs as any)[k];
        const selected = Array.isArray(cfg?.selectedTraceIds) ? cfg.selectedTraceIds.length : 0;
        return { key: k, tabId: tabId ?? "—", selected };
      })
      .sort((a, b) => b.selected - a.selected);
  }, [cs25SessionKeys, pageConfigs]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
          <h1 className="text-xl font-semibold">
            {loading ? "Hello" : `Hello, ${firstName}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Here’s a quick snapshot of your recent work.
          </p>
      </header>

      {/* At a glance */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="AI sessions"
          value={activeBindings.length}
          hint={`${uniqueRoutes} page(s) bound`}
        />
        <StatCard
          label="Saved selections (CS-25)"
          value={totalSelectedTraceIds}
          hint="Trace IDs you've ticked"
        />
        <StatCard
          label="Saved traces (CS-25)"
          value={cs25TraceStats.traceItems}
          hint={`${cs25TraceStats.relevantTrue} marked relevant`}
        />
        <StatCard
          label="Saved messages (CS-25)"
          value={cs25MessageCount}
          hint="Chat history"
        />
      </div>

      {/* Continue */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Continue where you left off</div>
            <div className="text-xs text-muted-foreground">
              Your CS-25 tool sessions (one per AI tab).
            </div>
          </div>
          <Button asChild>
            <Link href={CS25_ROUTE}>Open CS-25 Tool</Link>
          </Button>
        </div>

        {cs25Sessions.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No saved CS-25 sessions yet. Open the tool to start one.
          </div>
        ) : (
          <div className="space-y-2">
            {cs25Sessions.slice(0, 5).map((s) => (
              <div key={s.key} className="flex items-center justify-between rounded border px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">CS-25 session</div>
                  <div className="text-xs text-muted-foreground">
                    tabId: <span className="font-mono">{s.tabId}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{s.selected} selected</Badge>
                  <Button asChild size="sm" variant="outline">
                    <Link href={CS25_ROUTE}>Continue</Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Dev-only utilities */}
      {!IS_PROD && (
        <Card className="p-4 space-y-2">
          <div className="text-base font-semibold">Developer tools</div>
          <div className="text-xs text-muted-foreground">
            Visible only in development.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/system-b/persistence-inspector">Persistence Inspector</Link>
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}