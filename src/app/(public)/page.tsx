// src/app/(public)/page.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold">Engineer42</h1>
      <p className="text-muted-foreground text-center max-w-prose">
        Build, analyze, and trace your safety graph — all in one place.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/api/auth/login?next=/overview">Login / Sign up</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/docs">Docs</Link>
        </Button>
      </div>
    </main>
  );
}
