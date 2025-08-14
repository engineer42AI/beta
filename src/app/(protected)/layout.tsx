// src/app/(protected)/layout.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const idToken = cookies().get("e42_it")?.value;
  if (!idToken) redirect("/api/auth/login?next=/overview"); // after login, land on overview
  return <AppShell>{children}</AppShell>;
}
