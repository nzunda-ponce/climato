import { readState, mutateState } from "@/persistence/store";
import { parsePivots } from "@/domain/import";
import { syncPivots } from "@/domain/sync-pivots";
import { cellKey, rulesSignature } from "@/domain/evidence";
import { localDate, locationWarning } from "@/domain/types";
import {
  EnsoIndex,
  ForecastGrid,
  PUBLIC_WEATHER_BOUNDS,
  publicGridPoints,
} from "@/domain/seasonal";
import { operationalSync } from "./operational-sync";
import {
  loadEnso,
  loadGridBatch,
  loadLongHistory,
  loadSeasonal,
  readLongCache,
  writeLongCache,
} from "./long-range";
import { createSyncRunner, SyncTask } from "./sync-runner";

const fresh = (date: string | undefined, hours: number) => {
  const age = date ? Date.now() - Date.parse(date) : NaN;
  return age >= 0 && age < hours * 3600000;
};

async function plan(): Promise<SyncTask[]> {
  let state = await readState();
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
    await mutateState((s) => {
      // Another tab or a manual import may have seeded the installation meanwhile.
      if (!s.pivots.length) s.pivots = syncPivots(s.pivots, incoming).pivots;
    });
    state = await readState();
  }
  const points = [
    ...new Map(
      state.pivots
        .filter((p) => !locationWarning(p))
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
      await operationalSync.start();
      // The status endpoint reads this lane's live errors directly. Copying
      // them into a long-running historical job would keep resolved errors visible.
    },
  });
  const old = await readLongCache<ForecastGrid>("grid");
  const grid: ForecastGrid =
    old && old.start === localDate() && old.end === state.rules.deadline
      ? { ...old, bounds: PUBLIC_WEATHER_BOUNDS, coarseStep: 2 }
      : {
          bounds: PUBLIC_WEATHER_BOUNDS,
          step: 1,
          coarseStep: 2,
          start: localDate(),
          end: state.rules.deadline,
          fetchedAt: new Date().toISOString(),
          nodes: [],
          model: "Open-Meteo corto plazo / ECMWF EC46 / SEAS5 ensemble mean",
          errors: [],
        };
  const missing = publicGridPoints().filter(
    (p) =>
      !grid.nodes.some(
        (n) =>
          n.lat === p.lat &&
          n.lon === p.lon &&
          Object.values(n.days).some((d) => d.wind !== null && d.rain !== null),
      ),
  );
  for (let i = 0; i < missing.length; i += 8) {
    const batch = missing.slice(i, i + 8);
    tasks.push({
      label: `Mapa de lluvia y viento · ${Math.min(i + 8, missing.length)}/${missing.length} puntos pendientes`,
      run: async () => {
        try {
          const nodes = await loadGridBatch(batch, state.rules.deadline);
          // Read the latest cache so automatic imports don't overwrite manual updates.
          const latest = await readLongCache<ForecastGrid>("grid");
          const next =
            latest?.start === grid.start && latest.end === grid.end
              ? latest
              : grid;
          next.nodes = next.nodes
            .filter(
              (n) => !nodes.some((p) => p.lat === n.lat && p.lon === n.lon),
            )
            .concat(nodes);
          next.fetchedAt = new Date().toISOString();
          await writeLongCache("grid", next);
        } finally {
          await new Promise((resolve) => setTimeout(resolve, 8000));
        }
      },
    });
  }
  for (const [key, p] of points) {
    const history = state.climate?.[key];
    const needsHistory =
      !history ||
      history.rulesSignature !== signature ||
      history.years.length !== 45 ||
      history.years.at(-1) !== Number(localDate().slice(0, 4)) - 1;
    const forecast = state.seasonal?.[key];
    if (
      !needsHistory &&
      fresh(forecast?.fetchedAt, 12) &&
      forecast?.rulesSignature === signature &&
      !forecast.errors.length &&
      forecast.days[state.rules.deadline]
    )
      continue;
    tasks.push({
      label: `${needsHistory ? "Históricos ERA5 y pronóstico" : "Pronóstico hasta fin de año"} · zona ${key}`,
      run: async () => {
        const h = needsHistory
          ? await loadLongHistory(
              key,
              p.lat,
              p.lon,
              state.rules,
              await loadEnso(),
            )
          : history;
        // Persist history before requesting the forecast, so a forecast failure cannot lose it.
        await mutateState((s) => {
          if (rulesSignature(s.rules) === signature)
            (s.climate ??= {})[key] = h;
        });
        const result = await loadSeasonal(key, p.lat, p.lon, state.rules, h);
        await mutateState((s) => {
          if (rulesSignature(s.rules) === signature)
            (s.seasonal ??= {})[key] = result;
        });
        if (result.errors.length) throw new Error(result.errors.join(" · "));
      },
    });
  }
  return tasks;
}
const shared = globalThis as unknown as {
  climatoAutoSync?: ReturnType<typeof createSyncRunner>;
};
export const autoSync = (shared.climatoAutoSync ??= createSyncRunner(plan));
