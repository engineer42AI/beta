// src/components/console/ConsolePanels.tsx
"use client";

import { useEffect, useState } from "react";
import { ResizablePanels, Panel, PanelResizeHandle } from "@/components/ui/ResizablePanels";
import BottomConsole from "@/components/console/bottom-console";
import { useConsoleStore } from "@/stores/console-store";
import { Button } from "@/components/ui/button";

function ConsoleBar(props: React.HTMLAttributes<HTMLDivElement>) {
  const { toggle } = useConsoleStore();
  return (
    <div className="h-10 bg-background border-t border-b px-2 flex items-center justify-between">
      <span className="text-xs font-medium">Console</span>
      <Button size="sm" variant="secondary" onClick={toggle}>Expand</Button>
    </div>
  );
}

export default function ConsolePanels({ children }: { children: React.ReactNode }) {
  const { open, consoleSize, setConsoleSize } = useConsoleStore();

  // ✅ render the panel layout only on the client
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    // keep layout height stable to avoid jumps
    return <div className="h-full" />;
  }

  return (
    <ResizablePanels
      direction="vertical"
      className="h-full"
      onLayout={(sizes) => {
        if (!open) return;
        const s = Math.round(sizes[1] ?? 0);
        if (s >= 20 && s <= 70) setConsoleSize(s);
      }}
    >
      {/* MAIN CONTENT */}
      <Panel defaultSize={100 - consoleSize} minSize={10}>
        <main className="relative h-full min-h-0">
          {/* suppress tiny SSR/CSR diffs (like stray whitespace) */}
          <div
            className="content-scroll h-full overflow-auto p-3"
            suppressHydrationWarning
          >
            {children}
            <div className="h-4" /> {/* spacer for sticky toolbar */}
          </div>
        </main>
      </Panel>

      {/* Resize handle only when console is open */}
      {open ? (
        <PanelResizeHandle
            id="console-edge"
            className="group relative h-3 z-50"
        >
          <div className="absolute inset-0 cursor-row-resize" />
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-border
                          group-hover:h-2 group-hover:bg-muted-foreground/50 rounded" />
        </PanelResizeHandle>
      ) : (
        <div className="h-0" />
      )}

      {/* CONSOLE */}
      {open ? (
        <Panel
          key="console-open"
          defaultSize={consoleSize}
          minSize={20}
          maxSize={70}
          collapsedSize={0}
          collapsible
        >
          <BottomConsole />
        </Panel>
      ) : (
        <Panel key="console-closed" defaultSize={6} minSize={6} maxSize={6}>
          <ConsoleBar id="console-edge" />
        </Panel>
      )}
    </ResizablePanels>
  );
}
