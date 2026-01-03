// src/app/(public)/page.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto flex flex-col items-center gap-3">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Engineer42
          </h1>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-stretch justify-center gap-3">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/api/auth/login?next=/overview">Login / Sign up</Link>
          </Button>

          <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
            <Link href="https://engineer42.ai" target="_blank" rel="noreferrer">
              Visit engineer42.ai
            </Link>
          </Button>
        </div>


      </div>
    </main>
  );
}