// src/components/console/bottom-console.tsx
"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConsoleStore, type ToolId } from "@/stores/console-store";
import { Button } from "@/components/ui/button";
import {
  Plus, X, Bot, ListTree, TerminalSquare, ClipboardList,
  ChevronLeft, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import AIPanel from "./tools/AIPanel";
import LogPanel from "@/components/log/LogPanel";

const TOOLS: { id: ToolId; icon: any; label: string; singleton?: boolean }[] = [
  { id: "logs",   icon: TerminalSquare, label: "Logs",  singleton: true },
  { id: "ai",     icon: Bot,            label: "AI" },
  { id: "traces", icon: ListTree,       label: "Traces" },
  { id: "tasks",  icon: ClipboardList,  label: "Tasks" },
];

export default function BottomConsole() {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const {
    open, toggle, activeTool, openTool,
    tabs, activeTabId, setActiveTab, newTab, closeTab,
    railCollapsed, toggleRail,
  } = useConsoleStore();

  // We need access to the binding to know which route to navigate to.
  const getBinding = useConsoleStore(s => s.getBinding);

  // Show ALL tabs for the active tool
  const visibleTabs = useMemo(() => tabs[activeTool], [tabs, activeTool]);

  const activeToolMeta = TOOLS.find(t => t.id === activeTool);
  const isSingleton = !!activeToolMeta?.singleton;

  const handleTabClick = (tool: ToolId, tabId: string) => {
    setActiveTab(tool, tabId);
    if (tool === "ai") {
      const binding = getBinding(tabId);
      const targetRoute = binding?.route;
      if (targetRoute && targetRoute !== pathname) {
        // Navigate to the page this tab is linked with
        router.push(targetRoute);
      }
      // If no binding yet, we just focus the tab; page will be linked on first send/create.
    }
  };

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
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={toggleRail}
                  aria-label={railCollapsed ? "Expand tool rail" : "Collapse tool rail"}
                >
                  {railCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </Button>
              </div>
              <div className="flex-1 p-2 flex flex-col gap-1">
                {TOOLS.map(t => {
                  const active = activeTool === t.id;
                  return (
                    <Button
                      key={t.id}
                      variant={active ? "default" : "ghost"}
                      size="sm"
                      className={cn("h-9", railCollapsed ? "justify-center" : "justify-start px-2")}
                      onClick={() => openTool(t.id)}
                      aria-label={t.label}
                      title={railCollapsed ? t.label : undefined}
                    >
                      <t.icon className="w-4 h-4 shrink-0" />
                      {!railCollapsed && <span className="ml-2 truncate">{t.label}</span>}
                    </Button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Right content */}
          <section className="h-full min-w-0 flex flex-col">
            {/* Tabs header — hidden for logs */}
            {activeTool !== "logs" && (
              <div className="h-9 border-b px-2 flex items-center gap-2 overflow-x-auto">
                <div className="flex items-center gap-1">
                  {visibleTabs.map(tab => {
                    const isActive = activeTabId[activeTool] === tab.id;
                    return (
                      <div
                        key={tab.id}
                        className={cn(
                          "group inline-flex items-center gap-2 px-2 h-7 rounded-md text-xs cursor-pointer",
                          isActive ? "bg-muted font-medium" : "hover:bg-muted/60"
                        )}
                        onClick={() => handleTabClick(activeTool, tab.id)}
                      >
                        <span className="truncate max-w-[12rem]">{tab.title}</span>
                        <button
                          className="opacity-60 hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); closeTab(activeTool, tab.id); }}
                          aria-label="Close tab"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                  {activeTool === "ai" && visibleTabs.length === 0 && (
                    <div className="text-xs text-muted-foreground px-2">
                      No AI tabs yet.
                    </div>
                  )}
                </div>

                {!isSingleton && (
                  // Pass current pathname so the new AI tab seeds its binding to this page
                  <Button size="xs" variant="ghost" onClick={() => newTab(activeTool, undefined, pathname)}>
                    <Plus className="w-3 h-3 mr-1" /> New {activeTool}
                  </Button>
                )}
              </div>
            )}

            {/* Active tool surface */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <ToolSurface tool={activeTool as ToolId} activeTabId={activeTabId[activeTool]} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ToolSurface({ tool, activeTabId }: { tool: ToolId; activeTabId: string | null }) {
  useMemo(() => activeTabId ?? "No tab", [activeTabId]); // keep memoized to avoid unused var lint

  if (tool === "ai") {
    return (
      <div className="h-full min-h-0">
        <AIPanel />
      </div>
    );
  }

  if (tool === "logs") return <LogPanel />;

  if (tool === "traces") {
    return <div className="h-full min-h-0 overflow-auto p-3 text-sm text-muted-foreground">Traces panel (MVP)</div>;
  }

  return <div className="h-full min-h-0 overflow-auto p-3 text-sm text-muted-foreground">Tasks panel (MVP)</div>;
}