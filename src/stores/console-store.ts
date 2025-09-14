import { create } from "zustand";

export type ToolId = "logs" | "ai" | "traces" | "tasks";

export type ConsoleTab = {
  id: string;
  tool: ToolId;
  title: string;
};

type ConsoleState = {
  // console open/closed and size (percent of the right column height)
  open: boolean;
  toggle: () => void;
  consoleSize: number;                 // e.g., 35 (%)
  setConsoleSize: (n: number) => void;

  // left rail inside console (like your sidebar)
  railCollapsed: boolean;
  toggleRail: () => void;

  // tabs & tools
  activeTool: ToolId;
  tabs: Record<ToolId, ConsoleTab[]>;
  activeTabId: Record<ToolId, string | null>;
  openTool: (tool: ToolId) => void;
  newTab: (tool: ToolId, title?: string) => void;
  closeTab: (tool: ToolId, tabId: string) => void;
  setActiveTab: (tool: ToolId, tabId: string) => void;
};

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  open: true,
  toggle: () => set(s => ({ open: !s.open })),
  consoleSize: 35,
  setConsoleSize: (n) =>
    set({ consoleSize: Math.max(20, Math.min(70, n)) }),

  railCollapsed: true,
  toggleRail: () => set(s => ({ railCollapsed: !s.railCollapsed })),

  activeTool: "logs",
  tabs: {
    logs: [{ id: "run-1", tool: "logs", title: "Run #1" }],
    ai:   [{ id: "chat-1", tool: "ai",   title: "Chat 1" }],
    traces: [],
    tasks:  [],
  },
  activeTabId: { logs: "run-1", ai: "chat-1", traces: null, tasks: null },

  openTool: (tool) => set({ activeTool: tool, open: true }),
  newTab: (tool, title) => {
    const id = `${tool}-${Math.random().toString(36).slice(2, 8)}`;
    set(s => {
      const tabs = { ...s.tabs, [tool]: [...s.tabs[tool], { id, tool, title: title ?? `New ${tool}` }] };
      const activeTabId = { ...s.activeTabId, [tool]: id };
      return { tabs, activeTabId, activeTool: tool, open: true };
    });
  },
  closeTab: (tool, tabId) => set(s => {
    const remaining = s.tabs[tool].filter(t => t.id !== tabId);
    const nextActive = s.activeTabId[tool] === tabId ? (remaining[0]?.id ?? null) : s.activeTabId[tool];
    return {
      tabs: { ...s.tabs, [tool]: remaining },
      activeTabId: { ...s.activeTabId, [tool]: nextActive }
    };
  }),
  setActiveTab: (tool, tabId) => set(s => ({
    activeTool: tool,
    activeTabId: { ...s.activeTabId, [tool]: tabId }
  })),
}));
