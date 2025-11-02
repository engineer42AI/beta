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
    <div {...props} className={"h-10 bg-background border-t border-b px-2 flex items-center justify-between " + (props.className ?? "")}>
      <span className="text-xs font-medium">Console</span>
      <Button size="sm" variant="secondary" onClick={toggle}>Expand</Button>
    </div>
  );
}

export default function ConsolePanels({ children }: { children: React.ReactNode }) {
  const { open, consoleSize, setConsoleSize } = useConsoleStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  //if (!mounted) return <div className="h-full" />;
  if (!mounted) return <div className="h-full min-h-0 overflow-hidden" />;


  return (
    //<ResizablePanels
    //  direction="vertical"
    //  className="h-full min-h-0 overflow-hidden"
    //  onLayout={(sizes) => {
    //    if (!open) return;
    //    const s = Math.round(sizes[1] ?? 0);
    //    if (s >= 20 && s <= 70) setConsoleSize(s);
    //  }}
    //>
    <ResizablePanels
      direction="vertical"
      className="h-full console-debug-border"
      onLayout={(sizes) => {
        if (!open) return;
        const s = Math.round(sizes[1] ?? 0);
        if (s >= 20 && s <= 70) setConsoleSize(s);
      }}
    >
      <Panel defaultSize={100 - consoleSize} minSize={10}>
        <main className="relative h-full min-h-0">
          <div className="content-scroll h-full overflow-auto p-3" suppressHydrationWarning>
            {children}
            <div className="h-4" />
          </div>
        </main>
      </Panel>

      {open ? (
        //<PanelResizeHandle id="console-edge" className="h-3 cursor-row-resize" />
        <PanelResizeHandle
           id="console-edge"
           className="h-3 cursor-row-resize border-t-4 border-black-500"
           //className="h-3 cursor-row-resize outline outline-4 outline-yellow-500"
         />
      ) : (
        <div className="h-0" />
      )}

      {open ? (
          <Panel
            key="console-open"
            defaultSize={consoleSize}
            minSize={20}
            maxSize={70}
            collapsedSize={0}
            collapsible
          >
            <div className="h-full min-h-0 overflow-hidden">
              <div className="h-full rounded-md">
                <BottomConsole />
              </div>
            </div>
          </Panel>
        ) : (
        <Panel key="console-closed" defaultSize={6} minSize={6} maxSize={6}>
          <div className="h-full rounded-md">
            <ConsoleBar id="console-edge" />
          </div>
        </Panel>
      )}
    </ResizablePanels>
  );
}