// src/components/console/tools/AIPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { useConsoleStore } from "@/stores/console-store";
import { hasAiView, loadAiView } from "./aiViewRegistry";

export default function AIPanel() {
  const activeTabId = useConsoleStore((s) => s.activeTabId.ai);
  const getBinding  = useConsoleStore((s) => s.getBinding);
  const binding     = activeTabId ? getBinding(activeTabId) : undefined;

  const [View, setView] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const route = binding?.route;
      if (!route || !hasAiView(route)) {
        setView(null);
        return;
      }
      const Cmp = await loadAiView(route);
      if (!cancelled) setView(() => Cmp);
    }

    load();
    return () => { cancelled = true; };
  }, [binding?.route]);

  return (
    <div className="h-full min-h-0">
      {View ? (
        // key forces remount when switching tabs so per-tab state doesn't bleed
        <View key={activeTabId ?? "no-tab"} />
      ) : (
        <div className="p-3 text-sm text-muted-foreground">
          {binding?.route
            ? <>No <code>console_ai_view.tsx</code> registered for <code>{binding.route}</code>. Add it to <code>aiViewRegistry.ts</code>.</>
            : <>No route bound to this AI tab.</>}
        </div>
      )}
    </div>
  );
}