// src/hooks/useConsoleOffsetVar.ts
import { useEffect } from "react";

export function useConsoleOffsetVar() {
  useEffect(() => {
    const edge = () => document.getElementById("console-edge");

    const update = () => {
      const el = edge();
      if (!el) {
        document.documentElement.style.setProperty("--console-offset", "0px");
        return;
      }
      const r = el.getBoundingClientRect();
      const offset = Math.max(0, Math.round(window.innerHeight - r.top));
      document.documentElement.style.setProperty("--console-offset", `${offset}px`);
    };

    const ro = new ResizeObserver(update);
    const mo = new MutationObserver(update);
    const start = () => {
      const el = edge();
      if (el) ro.observe(el);
      mo.observe(document.body, { childList: true, subtree: true });
      update();
    };

    start();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("pointerup", update);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("pointerup", update);
    };
  }, []);
}
