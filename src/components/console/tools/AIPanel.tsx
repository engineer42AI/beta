// src/components/console/tools/AIPanel.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useConsoleStore } from "@/stores/console-store";
import { hasAiView, loadAiView } from "./aiViewRegistry";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";

export default function AIPanel() {
  const pathname        = usePathname() || "/";
  const activeTabId     = useConsoleStore((s) => s.activeTabId.ai);
  const getBinding      = useConsoleStore((s) => s.getBinding);
  const findTabsByRoute = useConsoleStore((s) => s.findTabsByRoute);
  const setActiveTab    = useConsoleStore((s) => s.setActiveTab);
  const newTab          = useConsoleStore((s) => s.newTab);

  const binding = activeTabId ? getBinding(activeTabId) : undefined;

  // ---- Grace period to avoid flicker during route/tab handoff ----
  const [mismatchReady, setMismatchReady] = useState(false);
  const rawMismatch = !!binding?.route && binding.route !== pathname;

  useEffect(() => {
    setMismatchReady(false);
    const id = setTimeout(() => setMismatchReady(true), 350); // 300–400ms
    return () => clearTimeout(id);
  }, [pathname, binding?.route, activeTabId]);

  // Only show overlay (and blur) when mismatch is stable
  const showOverlay = rawMismatch && mismatchReady;

  // ---- Load route-specific AI view for the tab’s bound route (if any) ----
  const [View, setView] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const route = binding?.route;
      if (!route || !hasAiView(route)) { setView(null); return; }
      const Cmp = await loadAiView(route);
      if (!cancelled) setView(() => Cmp ?? null);
    })();
    return () => { cancelled = true; };
  }, [binding?.route]);

  // ---- Actions ----
  const openFreshForCurrentPage = useCallback(() => {
    newTab("ai", undefined, pathname);
    queueMicrotask(() => {
      const after = findTabsByRoute(pathname);
      if (after.length > 0) setActiveTab("ai", after[after.length - 1]);
    });
  }, [newTab, pathname, findTabsByRoute, setActiveTab]);

  return (
    <div className="relative h-full min-h-0">
      {/* Underlay: keep mounted so state persists; blur ONLY when the debounced overlay is shown */}
      <div className={showOverlay ? "pointer-events-none select-none blur-lg" : ""}>
        {View ? (
          <View key={activeTabId ?? "no-tab"} />
        ) : (
          <NoViewFallback
            bindingRoute={binding?.route}
            pathname={pathname}
            onOpenFresh={openFreshForCurrentPage}
          />
        )}
      </div>

      {/* Minimal centered overlay, shown only after the grace window */}
      {showOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-sm">
          <Card className="w-[360px] max-w-[90vw] p-4 text-center shadow-lg">
            <Button size="sm" className="w-full justify-center" onClick={openFreshForCurrentPage}>
              <Plus className="mr-2 h-4 w-4" />
              Open new AI tab for this page
            </Button>
            <div className="mt-2 text-xs text-muted-foreground">
              Keeps workflows separate. Your current tab stays intact.
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* Smarter fallback:
   - If the current page has NO AI view registered → show message only (no button).
   - If the current page DOES have an AI view and we’re just unlinked → show the button.
*/
function NoViewFallback({
  bindingRoute,
  pathname,
  onOpenFresh,
}: {
  bindingRoute?: string;
  pathname: string;
  onOpenFresh: () => void;
}) {
  const hasForCurrent = hasAiView(pathname);
  const hasForBinding = bindingRoute ? hasAiView(bindingRoute) : undefined;

  // Case 1: Tab is linked to a route with no view
  if (bindingRoute && hasForBinding === false) {
    return (
      <div className="h-full grid place-items-center p-4">
        <Card className="w-[360px] max-w-[90vw] p-4 text-center">
          <div className="text-sm">No AI workflow is available for this page.</div>
          <div className="mt-2 text-xs text-muted-foreground">
            This page doesn’t provide a console AI view yet.
          </div>
        </Card>
      </div>
    );
  }

  // Case 2: Not linked yet
  if (!bindingRoute) {
    if (!hasForCurrent) {
      // No view for the current page either → message only
      return (
        <div className="h-full grid place-items-center p-4">
          <Card className="w-[360px] max-w-[90vw] p-4 text-center">
            <div className="text-sm">No AI workflow is available for this page.</div>
            <div className="mt-2 text-xs text-muted-foreground">
              This page doesn’t provide a console AI view yet.
            </div>
          </Card>
        </div>
      );
    }
    // The current page has a view → offer to open a fresh tab
    return (
      <div className="h-full grid place-items-center p-4">
        <Card className="w-[360px] max-w-[90vw] p-4 text-center">
          <Button size="sm" className="w-full justify-center" onClick={onOpenFresh}>
            <Plus className="mr-2 h-4 w-4" />
            Open new AI tab for this page
          </Button>
          <div className="mt-2 text-xs text-muted-foreground">
            Start a fresh workflow for this page.
          </div>
        </Card>
      </div>
    );
  }

  // Generic fallback (should rarely hit)
  return (
    <div className="h-full grid place-items-center p-4">
      <Card className="w-[360px] max-w-[90vw] p-4 text-center">
        <div className="text-sm">Preparing the console view…</div>
        <div className="mt-2 text-xs text-muted-foreground">Please wait.</div>
      </Card>
    </div>
  );
}