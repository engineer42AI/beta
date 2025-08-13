"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Home,
  Network,
  FileText,
  Settings,
  Menu,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

function NavItem({
  href,
  icon: Icon,
  label,
  collapsed,
}: {
  href: string;
  icon: any;
  label: string;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  const base =
    "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted";
  const cls = active ? base + " bg-muted" : base;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={href} className={cls}>
            <Icon className="h-5 w-5" />
            {!collapsed && <span>{label}</span>}
          </Link>
        </TooltipTrigger>
        {collapsed && <TooltipContent side="right">{label}</TooltipContent>}
      </Tooltip>
    </TooltipProvider>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="grid grid-cols-[auto_1fr] grid-rows-[auto_1fr] h-dvh">
      {/* Header */}
      <header className="col-span-2 flex items-center gap-2 border-b px-3 h-12">
        {/* Mobile menu */}
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
                <nav className="space-y-1">
                  <NavItem
                    href="/"
                    icon={Home}
                    label="Overview"
                    collapsed={false}
                  />
                  <NavItem
                    href="/graph"
                    icon={Network}
                    label="Graph"
                    collapsed={false}
                  />
                  <NavItem
                    href="/docs"
                    icon={FileText}
                    label="Docs"
                    collapsed={false}
                  />
                  <NavItem
                    href="/settings"
                    icon={Settings}
                    label="Settings"
                    collapsed={false}
                  />
                </nav>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>

        {/* Desktop collapse toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="hidden md:inline-flex"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
        <div className="font-semibold">Engineer42</div>
      </header>

      {/* Sidebar (desktop) */}
      <aside
        className={`hidden md:flex flex-col border-r transition-all duration-200 ${
          collapsed ? "w-14" : "w-60"
        }`}
      >
        <div className="px-2 py-2">
          <nav className="space-y-1">
            <NavItem
              href="/"
              icon={Home}
              label="Overview"
              collapsed={collapsed}
            />
            <NavItem
              href="/graph"
              icon={Network}
              label="Graph"
              collapsed={collapsed}
            />
            <NavItem
              href="/docs"
              icon={FileText}
              label="Docs"
              collapsed={collapsed}
            />
            <NavItem
              href="/settings"
              icon={Settings}
              label="Settings"
              collapsed={collapsed}
            />
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="overflow-hidden">
        <div className="h-full p-3">{children}</div>
      </main>
    </div>
  );
}
