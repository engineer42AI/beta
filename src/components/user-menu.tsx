"use client";

import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, Home, CreditCard, BookOpen, MessageCircleQuestion,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Small helper
function initials(given?: string, family?: string) {
  const a = (given?.[0] ?? "").toUpperCase();
  const b = (family?.[0] ?? "").toUpperCase();
  return (a + b) || "U";
}

export function UserMenu() {
  const { loading, data } = useUser();

  if (loading) {
    // Subtle skeleton so the header doesn’t jump
    return (
      <div className="h-9 w-28 rounded-full bg-muted/40 animate-pulse" aria-hidden />
    );
  }

  if (!data?.authenticated) {
    return (
      <Button asChild size="sm">
        <Link href="/api/auth/login">Login</Link>
      </Button>
    );
  }

  const u = data.user as any;
  const name = [u?.given_name, u?.family_name].filter(Boolean).join(" ") || u?.email || "User";
  const first = u?.given_name || name.split(" ")[0];
  const isAdmin = (data.groups ?? []).includes("admin");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* pill button like your example */}
        <Button
          variant="secondary"
          size="sm"
          className={cn(
            "h-9 rounded-full pr-2 pl-1",
            "bg-muted text-foreground hover:bg-muted/80",
            "flex items-center gap-2"
          )}
        >
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-[10px]">
              {initials(u?.given_name, u?.family_name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline font-medium">{first}</span>
          <ChevronDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 p-0 overflow-hidden">
        {/* Header block */}
        <div className="p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(u?.given_name, u?.family_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold truncate">{name}</p>
                {isAdmin && <Badge variant="secondary" className="h-5 px-2 text-[10px]">Admin</Badge>}
              </div>
              <p className="text-xs text-muted-foreground truncate">{u?.email}</p>
            </div>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Quick links section */}
        <div className="py-1">
          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <Link href="/" className="w-full flex items-center">
              <Home className="h-4 w-4 mr-2" /> Home
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <Link href="/billing" className="w-full flex items-center">
              <CreditCard className="h-4 w-4 mr-2" /> Billing
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <Link href="/docs" className="w-full flex items-center">
              <BookOpen className="h-4 w-4 mr-2" /> Documentation
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <Link href="/support" className="w-full flex items-center">
              <MessageCircleQuestion className="h-4 w-4 mr-2" /> Questions?
            </Link>
          </DropdownMenuItem>
        </div>

        <DropdownMenuSeparator />

        {/* Logout row */}
        <DropdownMenuItem asChild className="cursor-pointer text-red-600 focus:text-red-600">
          <Link href="/api/auth/logout" className="w-full flex items-center">
            <LogOut className="h-4 w-4 mr-2" /> Log out
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
