"use client";
import { useEffect, useState } from "react";
import type { SyncStatus } from "@/providers/sync-runner";

export default function AutoSyncStatus({
  onReload,
  inline = false,
}: {
  onReload: () => Promise<void>;
  inline?: boolean;
}) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let polling = false;
    let lastStart = 0;
    let lastReload = 0;
    let wasRunning = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const start = Date.now() - lastStart >= 60000;
        const response = await fetch("/api/auto-sync", {
          method: start ? "POST" : "GET",
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            "No se pudo consultar la carga automática. Reintentando…",
          );
        const next: SyncStatus = await response.json();
        if (start) lastStart = Date.now();
        if (!disposed) {
          setStatus(next);
          setError("");
        }
        if (
          Date.now() - lastReload >= (next.running ? 15000 : 60000) ||
          (wasRunning && !next.running)
        ) {
          if (!disposed) await onReload();
          lastReload = Date.now();
        }
        wasRunning = next.running;
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "No se pudo cargar");
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [onReload]);
  if (!error && status && !status.running && !status.errors.length) return null;
  return (
    <aside
      className={`auto-sync-status${inline ? " inline" : ""}`}
      role="status"
      aria-live="polite"
    >
      <strong>
        {error || status?.message || "Iniciando carga automática…"}
      </strong>
      {status?.running && (
        <span>
          {status.completed}/{status.total || "—"} pasos procesados. Podés
          seguir usando la app; los datos aparecen a medida que se descargan.
        </span>
      )}
      {status?.running && (
        <small>
          La primera carga de históricos puede tardar bastante. Se guarda el
          avance para continuar al reiniciar.
        </small>
      )}
      {!!status?.errors.length && (
        <details>
          <summary>
            {status.errors.length} fuentes pendientes de reintento
          </summary>
          <ul>
            {status.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
