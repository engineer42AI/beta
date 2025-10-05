// src/components/console/bottom-console.tsx
"use client";

import { useMemo } from "react";
import { useConsoleStore, type ToolId } from "@/stores/console-store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, X, Bot, ListTree, TerminalSquare, ClipboardList, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const TOOLS: { id: ToolId; icon: any; label: string }[] = [
  { id: "logs",   icon: TerminalSquare, label: "Logs" },
  { id: "ai",     icon: Bot,            label: "AI" },
  { id: "traces", icon: ListTree,       label: "Traces" },
  { id: "tasks",  icon: ClipboardList,  label: "Tasks" },
];

export default function BottomConsole() {
  const {
    open, toggle, activeTool, openTool,
    tabs, activeTabId, setActiveTab, newTab, closeTab,
    railCollapsed, toggleRail,
  } = useConsoleStore();

  return (
    <div className="bg-background h-full flex flex-col">
      {/* Title bar */}
      <div className="h-10 px-2 flex items-center justify-between border-b">
        <span className="text-xs font-medium">Console</span>
        <Button size="sm" variant="secondary" onClick={toggle}>
          {open ? "Collapse" : "Expand"}
        </Button>
      </div>

      {/* Body: rail | content */}
      <div className="flex-1 min-h-0">
        <div className="grid grid-cols-[auto_1fr] h-full min-w-0">
          {/* Left rail */}
          <aside className={cn("border-r h-full transition-all duration-200", railCollapsed ? "w-12" : "w-52")}>
            <div className="h-full flex flex-col">
              <div className="h-9 px-2 flex items-center justify-between border-b">
                {!railCollapsed && <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Tools</span>}
                <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={toggleRail}
                        aria-label={railCollapsed ? "Expand tool rail" : "Collapse tool rail"}>
                  {railCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </Button>
              </div>
              <div className="flex-1 p-2 flex flex-col gap-1">
                {TOOLS.map(t => {
                  const active = activeTool === t.id;
                  return (
                    <Button key={t.id} variant={active ? "default" : "ghost"} size="sm"
                            className={cn("h-9", railCollapsed ? "justify-center" : "justify-start px-2")}
                            onClick={() => openTool(t.id)} aria-label={t.label} title={railCollapsed ? t.label : undefined}>
                      <t.icon className="w-4 h-4 shrink-0" />
                      {!railCollapsed && <span className="ml-2 truncate">{t.label}</span>}
                    </Button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Right content (tabs + active tool) */}
          <section className="h-full min-w-0 flex flex-col">
            {/* Tabs header */}
            <div className="h-9 border-b px-2 flex items-center gap-2 overflow-x-auto">
              <div className="flex items-center gap-1">
                {tabs[activeTool].map(tab => {
                  const isActive = activeTabId[activeTool] === tab.id;
                  return (
                    <div key={tab.id}
                         className={cn("group inline-flex items-center gap-2 px-2 h-7 rounded-md text-xs cursor-pointer",
                                       isActive ? "bg-muted font-medium" : "hover:bg-muted/60")}
                         onClick={() => setActiveTab(activeTool, tab.id)}>
                      <span className="truncate max-w-[12rem]">{tab.title}</span>
                      <button className="opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); closeTab(activeTool, tab.id); }}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <Button size="xs" variant="ghost" onClick={() => newTab(activeTool)}>
                <Plus className="w-3 h-3 mr-1" /> New {activeTool}
              </Button>
            </div>

            {/* Active tool surface */}
            <div className="flex-1 min-h-0">
              <ToolSurface tool={activeTool} activeTabId={activeTabId[activeTool]} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ToolSurface({ tool, activeTabId }: { tool: ToolId; activeTabId: string | null }) {
  const tabTitle = useMemo(() => activeTabId ?? "No tab", [activeTabId]);

  if (tool === "logs") {
    return (
      <ScrollArea className="h-full">
        <pre className="text-xs p-3">
{`[12:00:01] run#842 started: CS25.1309 analysis
[12:00:02] linking hazard#123 -> control#A7 (MITIGATES)
[12:00:05] LLM suggestion created: mitigation candidate M-42
[12:00:07] run#842 completed

(active tab: ${tabTitle})`}
        </pre>
      </ScrollArea>
    );
  }

  if (tool === "ai") {
    return (
      <div className="h-full p-3 grid grid-rows-[1fr_auto] gap-2">
        <ScrollArea>
          <div className="text-sm text-muted-foreground">👋 Ask the AI about compliance artifacts here…</div>
        </ScrollArea>
        <div className="flex gap-2">
          <input className="flex-1 border rounded-md px-2 h-9 text-sm" placeholder="Type a prompt…" />
          <Button size="sm">Send</Button>
        </div>
      </div>
    );
  }

  if (tool === "traces") {
    return <div className="h-full p-3 text-sm text-muted-foreground">Trace diffs and Run justifications will appear here.</div>;
  }

  return <div className="h-full p-3 text-sm text-muted-foreground">Background tasks & exports will appear here.</div>;
}
