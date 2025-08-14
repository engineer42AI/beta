// src/hooks/useUser.ts
"use client";
import { useEffect, useState } from "react";

export function useUser() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{authenticated:boolean; user?: any; groups?: string[]} | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me").then(async r => {
      const j = await r.json();
      if (!cancelled) setData(j);
    }).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  return { loading, data };
}
