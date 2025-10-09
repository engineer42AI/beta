/** src/app/(protected)/system-b/browse-cert-specs-V4/page_debugging_dashboard.tsx */

'use client';

import React from 'react';
import { Button } from "@/components/ui/button";
import JSONView from '@uiw/react-json-view';

type NodeStats = { total: number; relevant: number; notRelevant: number };

export default function PageDebuggingDashboard(props: {
  // Binding + identity
  isBound: boolean;
  route: string;
  boundTabId: string | null;
  pageId: string | undefined;
  displayScopedKey: string | undefined;
  activeKey: string;
  binding: any;

  // Persistence
  hydratedKey: string | null;
  storageTabKey: string | undefined;
  config: any;

  // Backend payload + stats
  backendStats: { subpartsCount: number; sectionsCount: number; tracesTotal: number };
  rawPayload: any | null;
  httpStatus: number | null;
  durationMs: number | null;
  bytes: number | null;
  attempt: number;
  loading: boolean;
  loadError: string | null;
  loadOutline: () => Promise<void> | void;
}) {
  const {
    isBound, route, boundTabId, pageId, displayScopedKey, activeKey, binding,
    hydratedKey, storageTabKey, config,
    backendStats, rawPayload, httpStatus, durationMs, bytes, attempt, loading, loadError, loadOutline
  } = props;

  return (
    <section className="mt-6 space-y-4">
      {/* Binding */}
      <div className="rounded-lg border bg-card text-card-foreground">
        <div className="border-b px-4 py-2">
          <h2 className="text-sm font-semibold">Debug — Tab Binding</h2>
        </div>
        <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          <DebugField label="Bound">
            <code>{String(isBound)}</code>
          </DebugField>
          <DebugField label="Route">
            <code className="break-all">{route}</code>
          </DebugField>
          <DebugField label="Tab ID">
            <code>{boundTabId ?? "—"}</code>
          </DebugField>
          <DebugField label="Page ID">
            <code>{pageId ?? "—"}</code>
          </DebugField>
          <DebugField label="Scoped Key (tab::page)">
            <code className="break-all">{displayScopedKey ?? "—"}</code>
          </DebugField>

          <DebugField label="Active Key (route::tab)">
            <code className="break-all">{activeKey}</code>
          </DebugField>
        </div>
        {!!binding && (
          <>
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              Binding object (from console store)
            </div>
            <pre className="m-0 max-h-56 overflow-auto px-4 py-3 text-xs bg-muted/40">
{JSON.stringify(binding, null, 2)}
            </pre>
          </>
        )}
      </div>

      {/* Persistence */}
      <div className="rounded-lg border bg-card text-card-foreground">
        <div className="border-b px-4 py-2">
          <h2 className="text-sm font-semibold">Debug — Persistence (this tab)</h2>
        </div>

        {/* quick meta */}
        <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          <DebugField label="Hydrated">
            <code>{String(hydratedKey === activeKey)}</code>
          </DebugField>
          <DebugField label="Store Scope">
            <code className="break-all">({route}, {storageTabKey ?? "—"})</code>
          </DebugField>
          <DebugField label="Selected IDs (count)">
            <code className="tabular-nums">{config?.selectedTraceIds?.length ?? 0}</code>
          </DebugField>
        </div>

        {/* toolbar */}
        <div className="border-t px-4 py-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Binding key:</span>
          <code className="break-all">
            {route}::{storageTabKey ?? "—"}
          </code>
          <span className="ml-3 text-muted-foreground">Size:</span>
          <code>
            {
              (() => {
                try { return `${(JSON.stringify(config).length / 1024).toFixed(1)} KB`; }
                catch { return "—"; }
              })()
            }
          </code>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                try { navigator.clipboard.writeText(JSON.stringify(config ?? {}, null, 2)); } catch {}
              }}
            >
              Copy JSON
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                try {
                  const blob = new Blob([JSON.stringify(config ?? {}, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "persisted-config.json";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch {}
              }}
            >
              Download
            </Button>
          </div>
        </div>

        {/* interactive JSON */}
        <div className="px-4 pb-3">
          <JSONView
            value={config ?? {}}
            collapsed={1}                 // expand root only; click to drill in
            displayDataTypes={false}
            enableClipboard
            shortenTextAfterLength={120}
            style={{ maxHeight: 384, overflow: 'auto', fontSize: 12 }}
          />
        </div>
      </div>

      {/* Backend payload (raw) */}
      <div className="rounded-lg border bg-card text-card-foreground">
        <div className="border-b px-4 py-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Debug — Backend payload</h2>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Status:</span>
            <code>
              {loading ? "loading…" : loadError ? "error" : rawPayload ? "ok" : "idle"}
            </code>

            <span className="ml-3 text-muted-foreground">HTTP:</span>
            <code>{httpStatus ?? "—"}</code>

            <span className="ml-3 text-muted-foreground">Duration:</span>
            <code>{durationMs != null ? `${durationMs} ms` : "—"}</code>

            <span className="ml-3 text-muted-foreground">Bytes:</span>
            <code>{bytes != null ? bytes.toLocaleString() : "—"}</code>

            <span className="ml-3 text-muted-foreground">Attempt:</span>
            <code>{attempt}</code>

            <div className="ml-3 flex items-center gap-2">
              <Button size="xs" variant="outline" onClick={loadOutline} disabled={loading}>
                {loading ? "Loading…" : "Retry"}
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  try { navigator.clipboard.writeText(JSON.stringify(rawPayload ?? {}, null, 2)); } catch {}
                }}
                disabled={!rawPayload}
              >
                Copy JSON
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  try {
                    const blob = new Blob([JSON.stringify(rawPayload ?? {}, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "backend-payload.json";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                  } catch {}
                }}
                disabled={!rawPayload}
              >
                Download
              </Button>
            </div>
          </div>
        </div>

        {/* quick facts (only when we have a payload) */}
        {rawPayload && (
          <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <DebugField label="Subparts">
              <code className="tabular-nums">{backendStats.subpartsCount}</code>
            </DebugField>
            <DebugField label="Sections">
              <code className="tabular-nums">{backendStats.sectionsCount}</code>
            </DebugField>
            <DebugField label="Traces (total rows)">
              <code className="tabular-nums">{backendStats.tracesTotal}</code>
            </DebugField>
          </div>
        )}

        {/* error note */}
        {loadError && (
          <div className="px-4 pb-2 text-xs text-red-600">
            {loadError}
          </div>
        )}

        {/* JSON viewer */}
        <div className="px-4 pb-3">
          <JSONView
            value={rawPayload ?? {}}
            collapsed={1}             // compact: expand root only; click to drill in
            displayDataTypes={false}
            enableClipboard
            shortenTextAfterLength={120}
            style={{ maxHeight: 384, overflow: 'auto', fontSize: 12 }}
          />
        </div>
      </div>
    </section>
  );
}

function DebugField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-28 text-muted-foreground">{label}:</span>
      <span className="font-mono">{children}</span>
    </div>
  );
}