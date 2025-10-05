// app/components/app-shell.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useConsoleOffsetVar } from "@/hooks/useConsoleOffsetVar";

import { useUser } from "@/hooks/useUser";
import { UserMenu } from "@/components/user-menu";
import { ModeToggle } from "@/components/mode-toggle";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Home, Network, FileText, Settings, Menu, Users,
  ChevronLeft, ChevronRight,
} from "lucide-react";

import dynamic from "next/dynamic";

const ConsolePanels = dynamic(() => import("@/components/console/ConsolePanels"), {
  ssr: false,
});

/* --- Nav items --- */
import type { LucideIcon } from "lucide-react";

type NavLink = {
  href: string;
  label: string;
  icon?: LucideIcon;
  public?: boolean;
};
type NavSection = {
  label: string;
  children: NavLink[];
  public?: boolean;
};
type NavItem = NavLink | NavSection;

const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview", icon: Home, public: false },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/projects", label: "Projects", icon: Network },
  { href: "/docs", label: "Docs", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
  {
    label: "Workflows",
    children: [
      { label: "TDP V1", href: "/system-c/technology-development-plan-V1", icon: Users },
      { label: "TDP V2", href: "/system-c/technology-development-plan-V2", icon: Users },
      { label: "Stakeholders V1", href: "/system-b/stakeholders-V1", icon: Users },
      { label: "Stakeholders V2", href: "/system-b/stakeholders-V2", icon: Users },
      { label: "Stakeholders V3", href: "/system-b/stakeholders-V3", icon: Users },
      { label: "Browse cert spec V1", href: "/system-b/browse-cert-specs-V1", icon: Users },
      { label: "Browse cert spec V2", href: "/system-b/browse-cert-specs-V2", icon: Users },
      { label: "Browse cert spec V3", href: "/system-b/browse-cert-specs-V3", icon: Users },
      { label: "Functional Ontology V1", href: "/system-a/functional-ontology-V1", icon: Users },
      { label: "Functional Ontology V2", href: "/system-a/functional-ontology-V2", icon: Users },
      { label: "Functional Ontology V3", href: "/system-a/functional-ontology-V3", icon: Users },
    ],
  },
];

/* --- NavItem --- */
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

/* --- SidebarNav --- */
function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const { data } = useUser();
  const authed = !!data?.authenticated;

  const isVisible = (i: NavItem) =>
    "children" in i ? (i.public ?? false) || authed : (i.public ?? false) || authed;

  return (
    <nav className="space-y-3">
      {NAV_ITEMS.filter(isVisible).map((item) => {
        if ("children" in item) {
          return (
            <div key={item.label}>
              {!collapsed && (
                <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </div>
              )}
              <div className="space-y-1">
                {item.children.map((child) => {
                  const active = pathname === child.href || pathname.startsWith(child.href + "/");
                  const Icon = child.icon;
                  const base = "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
                  const cls = active ? base + " bg-muted" : base + " hover:bg-muted";
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={cls}
                      aria-label={child.label}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? child.label : undefined}
                    >
                      {Icon ? <Icon className="h-5 w-5 shrink-0" /> : null}
                      {!collapsed && <span className="truncate">{child.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        }

        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        const base = "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
        const cls = active ? base + " bg-muted" : base + " hover:bg-muted";
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cls}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
          >
            {Icon ? <Icon className="h-5 w-5 shrink-0" /> : null}
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/* --- AppShell --- */
export default function AppShell({ children }: { children: React.ReactNode }) {
  useConsoleOffsetVar(); // <-- keeps --console-offset current
  const [collapsed, setCollapsed] = useState(false);
  const { data } = useUser();
  const authed = !!data?.authenticated;

  return (
    <div className="grid grid-rows-[auto_1fr] h-dvh">
      {/* Header */}
      <header className="flex items-center gap-2 border-b px-3 h-12">
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

        <Button
          variant="ghost"
          size="sm"
          className="hidden md:inline-flex"
          onClick={() => setCollapsed((v) => !v)}
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

      {/* Body: sidebar | console-panels */}
      <div className="grid grid-cols-[auto_1fr] min-h-0">
        {/* Sidebar */}
        <aside
          className={`hidden md:flex flex-col border-r transition-all duration-200 ${
            collapsed ? "w-14" : "w-60"
          }`}
        >
          <div className="px-2 py-2">
            <SidebarNav collapsed={collapsed} />
          </div>
        </aside>

        {/* Right column with console */}
        <div className="min-h-0 min-w-0 overflow-hidden">
          <ConsolePanels>{children}</ConsolePanels>
        </div>
      </div>
    </div>
  );
}
