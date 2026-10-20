import { acquireSyncLease } from "@/persistence/store";
import { readState, mutateState, mergeClimateBatch } from "@/persistence/store";
import { parsePivots } from "@/domain/import";
import { syncPivots } from "@/domain/sync-pivots";
import { cellKey, rulesSignature } from "@/domain/evidence";
import { localDate, locationWarning } from "@/domain/types";
import { EnsoIndex } from "@/domain/seasonal";
import { operationalSync } from "./operational-sync";
import { loadEnso, readLongCache } from "./long-range";
import { loadHistoryYearBatch } from "./history-batch";
import { fairEnsembleOrder } from "./ensemble-order";
import { createSyncRunner, SyncTask } from "./sync-runner";

const fresh = (date: string | undefined, hours: number) => {
  const age = date ? Date.now() - Date.parse(date) : NaN;
  return age >= 0 && age < hours * 3600000;
};

async function plan(): Promise<SyncTask[]> {
  let state = await readState({ purpose: "planning" });
  // Seed only an empty installation. Existing equipment, edits and work status stay intact.
  if (!state.pivots.length) {
    autoSync.status.message = "Importando equipos de Google My Maps";
    const url = new URL("https://www.google.com/maps/d/kml");
    url.searchParams.set("mid", "1XjGPX2pxGOVbN53k-B6TIUnDzWAA_P4");
    url.searchParams.set("forcekml", "1");
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        `No se pudo importar Google My Maps (HTTP ${response.status}). Se reintentará automáticamente.`,
      );
    const incoming = parsePivots(
      new Uint8Array(await response.arrayBuffer()),
      "source-map.kml",
    );
    if (!incoming.length)
      throw new Error("El mapa de origen no devolvió equipos.");
    await mutateState(
      (s) => {
        // Another tab or a manual import may have seeded the installation meanwhile.
        if (!s.pivots.length) s.pivots = syncPivots(s.pivots, incoming).pivots;
      },
      { namespaces: ["settings", "pivot"] },
    );
    state = await readState({ purpose: "planning" });
  }
  const points = [
    ...new Map(
      state.pivots
        .filter((p) => !locationWarning(p) && p.status !== "TERMINADO")
        .map((p) => [cellKey(p.lat, p.lon), p]),
    ).entries(),
  ];
  if (!points.length)
    throw new Error(
      "No hay equipos con coordenadas válidas para descargar el clima.",
    );
  const signature = rulesSignature(state.rules);
  const tasks: SyncTask[] = [];
  const enso = await readLongCache<EnsoIndex>("enso-roni");
  if (!fresh(enso?.fetchedAt, 24)) {
    tasks.push({
      label: "Índice NOAA",
      run: async () => {
        await loadEnso();
      },
    });
  }
  tasks.push({
    label: "Actualizando pronóstico de corto plazo",
    run: async () => {
      void operationalSync.start();
      // The status endpoint reads this lane's live errors directly. Copying
      // them into a long-running historical job would keep resolved errors visible.
    },
  });
  const ordered = fairEnsembleOrder(points, (key) => !!state.climate?.[key]);
  const last = Number(localDate().slice(0, 4)) - 1;
  // One recent season for every location before proceeding to the next year.
  // This yields an initial ten-year baseline everywhere before extending to 45.
  for (let offset = 0; offset < 45; offset++) {
    const year = last - offset;
    const missing = ordered.filter(
      ([key]) =>
        state.climate?.[key]?.rulesSignature !== signature ||
        !state.climate[key].years.includes(year),
    );
    for (let i = 0; i < missing.length; i += 6) {
      const batch = missing
        .slice(i, i + 6)
        .map(([key, p]) => ({ key, lat: p.lat, lon: p.lon }));
      tasks.push({
        label: `Referencia histórica ${year} · ${Math.min(i + 6, missing.length)}/${missing.length} ubicaciones · ${offset < 10 ? "base inicial de 10 años" : "ampliando a 45 años"}`,
        run: async () => {
          const results = await loadHistoryYearBatch(batch, year, state.rules);
          await mergeClimateBatch(results, signature);
        },
      });
    }
  }
  // Seasonal forecasts have an independent lane once sufficient history is
  // available. NOAA is a separate diagnostic and cannot block ERA5 imports.
  return tasks;
}
const shared = globalThis as unknown as {
  climatoAutoSync?: ReturnType<typeof createSyncRunner>;
};
export const autoSync = (shared.climatoAutoSync ??= createSyncRunner(
  plan,
  Date.now,
  () => acquireSyncLease("history"),
));
