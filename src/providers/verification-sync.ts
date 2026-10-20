import { readState, mutateState } from "@/persistence/store";
import { addDays, Hour, localDate } from "@/domain/types";
import { alignHourlyIntervals } from "@/domain/evidence";
import { verifyPredictionDays } from "@/domain/forecast-validation";
import { createSyncRunner, SyncTask } from "./sync-runner";

// ERA5 is a retrospective weather reference, not a field observation. It has
// publication latency; absent hours remain unverified and never count as dry.
export async function verificationTasks(): Promise<SyncTask[]> {
  const state = await readState(),
    archive = state.validationArchive;
  if (!archive) return [];
  const today = localDate(),
    start = addDays(today, -30),
    end = addDays(today, -1);
  const groups = new Map<string, typeof archive.predictions>();
  for (const p of archive.predictions) {
    if (
      p.date < start ||
      p.date > end ||
      archive.outcomes.some(
        (o) =>
          o.key === p.key && o.date === p.date && o.signature === p.signature,
      )
    )
      continue;
    groups.set(p.key, [...(groups.get(p.key) ?? []), p]);
  }
  const tasks: SyncTask[] = [];
  for (const [key, predictions] of groups) {
    const refreshed = archive.refreshed?.[key];
    if (refreshed && Date.now() - Date.parse(refreshed) < 24 * 3600000)
      continue;
    tasks.push({
      label: `Verificación de pronósticos · ${key}`,
      run: async () => {
        const p = predictions[0];
        const url = new URL(
          process.env.WEATHER_API_KEY
            ? "https://customer-archive-api.open-meteo.com/v1/archive"
            : "https://archive-api.open-meteo.com/v1/archive",
        );
        const params: Record<string, string> = {
          latitude: String(p.lat),
          longitude: String(p.lon),
          start_date: addDays(start, -1),
          end_date: end,
          models: "era5",
          hourly: "wind_speed_10m,precipitation",
          wind_speed_unit: "kmh",
          timezone: "America/Argentina/Buenos_Aires",
        };
        if (process.env.WEATHER_API_KEY)
          params.apikey = process.env.WEATHER_API_KEY;
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        const response = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok)
          throw new Error(`Verificación ERA5: HTTP ${response.status}`);
        const data = await response.json(),
          h = data.hourly;
        if (!Array.isArray(h?.time))
          throw new Error("ERA5 no devolvió datos horarios para verificar.");
        const number = (v: unknown) =>
          typeof v === "number" && Number.isFinite(v) ? v : null;
        const hours = alignHourlyIntervals(
          h.time.map((time: string, i: number): Hour => ({
            time,
            wind: number(h.wind_speed_10m?.[i]),
            rain: number(h.precipitation?.[i]),
            gust: null,
            soil: null,
          })),
        );
        const outcomes = verifyPredictionDays(
          predictions,
          hours,
          new Date().toISOString(),
        );
        await mutateState((s) => {
          const a = (s.validationArchive ??= { predictions: [], outcomes: [] });
          for (const o of outcomes)
            if (
              !a.outcomes.some(
                (v) =>
                  v.key === o.key &&
                  v.date === o.date &&
                  v.signature === o.signature,
              )
            )
              a.outcomes.push(o);
          (a.refreshed ??= {})[key] = new Date().toISOString();
        });
      },
    });
  }
  return tasks;
}
const shared = globalThis as unknown as {
  climatoVerificationSync?: ReturnType<typeof createSyncRunner>;
};
export const verificationSync = (shared.climatoVerificationSync ??=
  createSyncRunner(verificationTasks));
