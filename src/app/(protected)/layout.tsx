// src/app/(protected)/layout.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const idToken = cookieStore.get("e42_it")?.value;

  if (!idToken) {
    redirect("/api/auth/login?next=/overview");
  }

  return (
    <AppShell>
        {children}
    </AppShell>
  );
}