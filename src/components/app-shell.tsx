"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useUser } from "@/hooks/useUser";
import { UserMenu } from "@/components/user-menu";
import { ModeToggle } from "@/components/mode-toggle";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Home, Network, FileText, Settings, Menu,
  ChevronLeft, ChevronRight,
} from "lucide-react";

import BottomConsole from "@/components/console/bottom-console";
import { useConsoleStore } from "@/store/console-store";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";

/* ---- Nav model ---- */
type NavItemDef = {
  href: string;
  label: string;
  icon: any;
  public?: boolean; // true = visible when logged out
};

const NAV_ITEMS: NavItemDef[] = [
  { href: "/", label: "Overview", icon: Home, public: true },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/docs", label: "Docs", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

/* ---- Single NavItem component ---- */
function NavItem({
  href, icon: Icon, label, collapsed,
}: { href: string; icon: any; label: string; collapsed: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  const base = "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
  const cls = active ? base + " bg-muted" : base + " hover:bg-muted";

  return (
    <Link
      href={href}
      className={cls}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function ConsoleBar() {
  const { toggle } = useConsoleStore();
  return (
    <div className="h-10 bg-background border-t border-b px-2 flex items-center justify-between">
      <span className="text-xs font-medium">Console</span>
      <Button size="sm" variant="secondary" onClick={toggle}>Expand</Button>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { open, consoleSize, setConsoleSize } = useConsoleStore();

  // ✅ hooks must be inside a component
  const { data } = useUser();
  const authed = !!data?.authenticated;

  function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
    const items = NAV_ITEMS.filter(i => i.public || authed);
    return (
      <nav className="space-y-1">
        {items.map(it => (
          <NavItem key={it.href} href={it.href} icon={it.icon} label={it.label} collapsed={collapsed} />
        ))}
      </nav>
    );
  }

  return (
    <div className="grid grid-rows-[auto_1fr] h-dvh">
      {/* Header */}
      <header className="flex items-center gap-2 border-b px-3 h-12">
        {/* Mobile */}
        <div className="md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-60">
              <div className="px-3 py-2 font-semibold">Engineer42</div>
              <Separator />
              <ScrollArea className="h-[calc(100dvh-3rem)] p-2">
                <SidebarNav />
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>

        {/* Collapse sidebar */}
        <Button
          variant="ghost" size="sm" className="hidden md:inline-flex"
          onClick={() => setCollapsed(v => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>

        <div className="font-semibold">Engineer42</div>

        <div className="ml-auto flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </header>

      {/* Body: sidebar | (main + console vertical split) */}
      <div className="grid grid-cols-[auto_1fr] min-h-0">
        {/* Sidebar */}
        <aside className={`hidden md:flex flex-col border-r transition-all duration-200 ${collapsed ? "w-14" : "w-60"}`}>
          <div className="px-2 py-2">
            <SidebarNav collapsed={collapsed} />
          </div>
        </aside>

        {/* Right column: vertical resizable split */}
        <div className="min-h-0 min-w-0">
          <PanelGroup
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
              <main className="h-full overflow-hidden min-h-0">
                <div className="h-full p-3">{children}</div>
              </main>
            </Panel>

            {/* Resize handle only when console is open */}
            {open ? (
              <PanelResizeHandle className="group relative h-3 z-50">
                <div className="absolute inset-0 cursor-row-resize" />
                <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-border
                                group-hover:h-2 group-hover:bg-muted-foreground/50 rounded" />
              </PanelResizeHandle>
            ) : (
              <div className="h-0" />
            )}

            {/* CONSOLE AREA */}
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
                <ConsoleBar />
              </Panel>
            )}
          </PanelGroup>
        </div>
      </div>
    </div>
  );
}
