import Link from "next/link";

export default function Home() {
  return (
    <div className="h-full grid place-items-center">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-semibold">Engineer42 — UI Skeleton</h1>
        <p className="text-sm text-muted-foreground">
          shadcn sidebar + React Flow center area
        </p>
        <Link href="/graph" className="underline">
          Go to Graph
        </Link>
      </div>
    </div>
  );
}
