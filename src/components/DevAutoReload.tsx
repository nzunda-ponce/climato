"use client";
import { useEffect } from "react";
export default function DevAutoReload() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    let version: string | undefined,
      stopped = false,
      busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch("/api/dev-version", { cache: "no-store" });
        if (!response.ok || stopped) return;
        const next = (await response.json()).version;
        if (!next) return;
        if (version && version !== next) window.location.reload();
        version = next;
      } catch {
        /* Wait for the server to finish restarting. */
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return null;
}
