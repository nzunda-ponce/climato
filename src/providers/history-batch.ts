import { alignHourlyIntervals } from "@/domain/evidence";
import { assessHistoryYear } from "@/domain/history-training";
import { Rules, Hour } from "@/domain/types";
import { readLongCache, writeLongCache } from "./long-range";
import type { EnsemblePoint } from "./research";
import { weatherJson } from "./weather-request";
type Raw = {
  hourly: {
    time: string[];
    wind_speed_10m?: unknown[];
    precipitation?: unknown[];
    wind_gusts_10m?: unknown[];
  };
};
export async function loadHistoryYearBatch(
  points: EnsemblePoint[],
  year: number,
  rules: Rules,
  request?: typeof fetch,
  cache: {
    read: (name: string) => Promise<Raw | undefined>;
    write: (name: string, value: Raw) => Promise<void>;
  } = { read: (name) => readLongCache<Raw>(name), write: writeLongCache },
) {
  const cached = await Promise.all(
    points.map((p) => cache.read(`era5-${p.key}-${year}`)),
  );
  const missing = points.filter((_, i) => !cached[i]);
  const downloaded = new Map<string, Raw>();
  if (missing.length) {
    const url = new URL(
      process.env.WEATHER_API_KEY
        ? "https://customer-archive-api.open-meteo.com/v1/archive"
        : "https://archive-api.open-meteo.com/v1/archive",
    );
    const params: Record<string, string> = {
      latitude: missing.map((p) => p.lat).join(","),
      longitude: missing.map((p) => p.lon).join(","),
      models: "era5",
      hourly: "wind_speed_10m,precipitation",
      start_date: `${year}-09-30`,
      end_date: `${year + 1}-01-01`,
      timezone: "America/Argentina/Buenos_Aires",
      wind_speed_unit: "kmh",
    };
    if (process.env.WEATHER_API_KEY)
      params.apikey = process.env.WEATHER_API_KEY;
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const payload = await weatherJson<Raw | Raw[]>(url, request),
      rows: Raw[] = Array.isArray(payload) ? payload : [payload];
    if (
      rows.length !== missing.length ||
      rows.some((r) => !Array.isArray(r.hourly?.time))
    )
      throw new Error(
        "Respuesta histórica incompleta: se reintentará sin asignar datos a otra ubicación.",
      );
    for (let i = 0; i < missing.length; i++) {
      downloaded.set(missing[i].key, rows[i]);
      await cache.write(`era5-${missing[i].key}-${year}`, rows[i]);
    }
  }
  const numeric = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) ? n : null;
  return points.map((p, i) => {
    const h = (downloaded.get(p.key) ?? cached[i]!).hourly;
    const hours: Hour[] = alignHourlyIntervals(
      h.time.map((time, i) => ({
        time,
        wind: numeric(h.wind_speed_10m?.[i]),
        rain: numeric(h.precipitation?.[i]),
        gust: numeric(h.wind_gusts_10m?.[i]),
        soil: null,
      })),
    );
    return assessHistoryYear(p.key, p.lat, p.lon, year, hours, rules);
  });
}
