// app/components/app-shell.tsx
"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useConsoleStore } from "@/stores/console-store";
import { useConsoleOffsetVar } from "@/hooks/useConsoleOffsetVar";
import { useUser } from "@/hooks/useUser";
import { UserMenu } from "@/components/user-menu";
import { ModeToggle } from "@/components/mode-toggle";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FileCheck } from "lucide-react";

import * as Dialog from "@radix-ui/react-dialog";

import {
  Home, Network, FileText, Settings, Menu, Users,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { type LucideIcon } from "lucide-react";

import { IS_PROD } from "@/lib/env";

const ConsolePanels = dynamic(() => import("@/components/console/ConsolePanels"), {
  ssr: false,
});

/* --- Nav items --- */
type NavLink = {
  href: string;
  label: string;
  icon?: LucideIcon;
  public?: boolean;
  devOnly?: boolean;   // ✅ add this
};
type NavSection = {
  label: string;
  children: NavLink[];
  public?: boolean;
  devOnly?: boolean;   // optional
};
type NavItem = NavLink | NavSection;

const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview", icon: Home, public: false },
  { href: "/graph", label: "Graph", icon: Network, devOnly: true },
  { href: "/projects", label: "Projects", icon: Network, devOnly: true },
  { href: "/docs", label: "Docs", icon: FileText, devOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, devOnly: true },
  {
    label: "Workflows",
    children: [
      { label: "TDP V1", href: "/system-c/technology-development-plan-V1", icon: Users, devOnly: true },
      { label: "TDP V2", href: "/system-c/technology-development-plan-V2", icon: Users, devOnly: true },
      { label: "Stakeholders V1", href: "/system-b/stakeholders-V1", icon: Users, devOnly: true },
      { label: "Stakeholders V2", href: "/system-b/stakeholders-V2", icon: Users, devOnly: true },
      { label: "Stakeholders V3", href: "/system-b/stakeholders-V3", icon: Users, devOnly: true },
      { label: "Browse cert spec V1", href: "/system-b/browse-cert-specs-V1", icon: Users, devOnly: true },
      { label: "Browse cert spec V2", href: "/system-b/browse-cert-specs-V2", icon: Users, devOnly: true },
      { label: "Browse cert spec V3", href: "/system-b/browse-cert-specs-V3", icon: Users, devOnly: true },
      { label: "CS25 tool", href: "/system-b/browse-cert-specs-V4", icon: FileCheck },
      { label: "CS25 tool V2", href: "/system-b/certification-basis-V1", icon: FileCheck },
      { label: "Functional Ontology V1", href: "/system-a/functional-ontology-V1", icon: Users, devOnly: true },
      { label: "Functional Ontology V2", href: "/system-a/functional-ontology-V2", icon: Users, devOnly: true },
      { label: "Functional Ontology V3", href: "/system-a/functional-ontology-V3", icon: Users, devOnly: true },
      { label: "Console ai-bus test", href: "/tests/console-bus-test", icon: Users, devOnly: true },
      { label: "Persistence inspector test", href: "/tests/persistence-inspector", icon: Users, devOnly: true },
      { label: "Orchestrator debug", href: "/tests/orchestrator-debug", icon: Users, devOnly: true },
      { label: "Event bus monitor", href: "/tests/event-bus-monitor", icon: Users, devOnly: true },
    ],
  },
];

/* --- helper: best label for a pathname from NAV_ITEMS --- */
function resolvePageTitle(pathname: string): string | undefined {
  for (const i of NAV_ITEMS) {
    if ("children" in i) {
      for (const c of i.children) {
        if (pathname.startsWith(c.href)) return c.label;
      }
    } else if (pathname.startsWith(i.href)) {
      return i.label;
    }
  }
  return undefined;
}

/* --- NavItem --- */
function NavItemRow({
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
      {Icon ? <Icon className="h-5 w-5 shrink-0" /> : null}
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

/* --- SidebarNav --- */
function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {


  const pathname = usePathname();
  const { data } = useUser();
  const authed = !!data?.authenticated;

  const isAllowedByEnv = (link?: { devOnly?: boolean }) =>
    !(IS_PROD && link?.devOnly);

  const canSeeLink = (link: NavLink) =>
    isAllowedByEnv(link) && ((link.public ?? false) || authed);

  const canSeeItem = (i: NavItem) => {
    if (!isAllowedByEnv(i as any)) return false;

    if ("children" in i) {
      return i.children.some(canSeeLink); // section shown only if it has ≥1 visible child
    }
    return (i.public ?? false) || authed;
  };

  return (
    <nav className="space-y-3">
      {NAV_ITEMS.filter(canSeeItem).map((item) => {
        if ("children" in item) {
          const children = item.children.filter(canSeeLink);

          return (
            <div key={item.label}>
              {!collapsed && (
                <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </div>
              )}
              <div className="space-y-1">
                {children.map((child) => {
                  const active =
                    pathname === child.href || pathname.startsWith(child.href + "/");
                  const Icon = child.icon;
                  const base =
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
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

        // plain link item
        const link = item as NavLink;
        const active = pathname === link.href || pathname.startsWith(link.href + "/");
        const Icon = link.icon;
        const base = "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
        const cls = active ? base + " bg-muted" : base + " hover:bg-muted";

        return (
          <Link
            key={link.href}
            href={link.href}
            className={cls}
            aria-label={link.label}
            aria-current={active ? "page" : undefined}
            title={collapsed ? link.label : undefined}
          >
            {Icon ? <Icon className="h-5 w-5 shrink-0" /> : null}
            {!collapsed && <span className="truncate">{link.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/* --- AppShell --- */
export default function AppShell({ children }: { children: React.ReactNode }) {

  // DEV-ONLY: install inspector
  useEffect(() => {
      if (IS_PROD) return;
      (async () => {
        const { installOrchestratorInspector } = await import("@/lib/debug/orchestratorInspector");
        const { orchestrator } = await import("@/lib/pageOrchestrator");
        installOrchestratorInspector(orchestrator as any);
      })();
  }, []);

  const pathname = usePathname();
  const setContext = useConsoleStore(s => s.setContext);   // <— get the setter

  useEffect(() => {
    const label = resolvePageTitle(pathname || "/") ?? "Chat";
    setContext(label);                                     // <— just pass the title (no keys yet)
  }, [pathname, setContext]);

  useConsoleOffsetVar(); // keeps --console-offset current
  const [collapsed, setCollapsed] = useState(false);
  const { data } = useUser();
  const authed = !!data?.authenticated;
//debugging
//
    //<div className="grid grid-rows-[auto_1fr] min-h-dvh overflow-visible border-8 border-green-500">
    //<div className="fixed inset-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-visible border-8 border-green-500">
  return (

    <div className="grid grid-rows-[auto_minmax(0,1fr)] h-dvh overflow-hidden">
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
              {/* Hidden but satisfies accessibility requirement */}
              <Dialog.Title className="sr-only">Primary navigation</Dialog.Title>
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
          className={`hidden md:flex min-h-0 overflow-auto flex-col border-r transition-all duration-200 ${
            collapsed ? "w-14" : "w-60"
          }`}
        >
          <div className="px-2 py-2">
            <SidebarNav collapsed={collapsed} />
          </div>
        </aside>

        {/* Right column with console */}
        <div className="min-h-0 min-w-0 h-full overflow-hidden col-span-full md:col-auto">
          <ConsolePanels>{children}</ConsolePanels>
        </div>
      </div>
    </div>
  );
}