import {
  EnsembleAssessment,
  HistoricalClimate,
  memberPaths,
  rulesSignature,
  alignHourlyIntervals,
} from "@/domain/evidence";
import {
  Rules,
  WeatherForecast,
  ModelForecast,
  Hour,
  localDate,
} from "@/domain/types";
import { calculateOperationalWindows } from "@/domain/windows";
import { readResearchRaw, saveResearchRaw } from "@/persistence/store";
export const ENSEMBLE_SOURCES = [
  { model: "ecmwf_ifs025", family: "ECMWF" },
  { model: "gfs_seamless", family: "GEFS" },
  { model: "dwd_icon_global_eps", family: "ICON EPS" },
  { model: "gem_global", family: "GEM EPS" },
];
type RawHourly = { time: string[]; [key: string]: unknown[] };
const numeric = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export function parseEnsemble(
  hourly: RawHourly,
  family: string,
): ModelForecast[] {
  const keys = Object.keys(hourly).filter((k) =>
    /^wind_speed_10m(?:_member\d+)?$/.test(k),
  );
  return keys.map((key) => {
    const suffix = key.slice("wind_speed_10m".length);
    return {
      model: family + suffix,
      family,
      member: suffix || "control",
      kind: "ensemble",
      hours: hourly.time.map((time, i) => ({
        time,
        wind: numeric(hourly[key]?.[i]),
        gust: numeric(hourly["wind_gusts_10m" + suffix]?.[i + 1]),
        rain: numeric(hourly["precipitation" + suffix]?.[i + 1]),
        soil: null,
      })),
    };
  });
}
async function jsonFetch(url: URL) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(90000),
    });
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      continue;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 140)}`);
    }
    return response.json();
  }
  throw new Error("Límite de consultas del proveedor");
}
export async function loadEnsemble(
  key: string,
  lat: number,
  lon: number,
  r: Rules,
): Promise<EnsembleAssessment> {
  let raw = await readResearchRaw<WeatherForecast>(key, "ensemble");
  if (
    !raw ||
    Date.now() - Date.parse(raw.fetchedAt) > 3 * 3600000 ||
    (raw.errors.length > 0 && Date.now() - Date.parse(raw.fetchedAt) > 60000)
  ) {
    const results = await Promise.allSettled(
      ENSEMBLE_SOURCES.map(async (source) => {
        const url = new URL(
          process.env.WEATHER_API_KEY
            ? "https://customer-ensemble-api.open-meteo.com/v1/ensemble"
            : "https://ensemble-api.open-meteo.com/v1/ensemble",
        );
        const params: Record<string, string> = {
          latitude: String(lat),
          longitude: String(lon),
          models: source.model,
          hourly: "wind_speed_10m,wind_gusts_10m,precipitation",
          forecast_days: "35",
          timezone: "America/Argentina/Buenos_Aires",
          wind_speed_unit: "kmh",
        };
        if (process.env.WEATHER_API_KEY)
          params.apikey = process.env.WEATHER_API_KEY;
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        const data = await jsonFetch(url);
        if (!data.hourly?.time) throw new Error("Sin datos horarios");
        return parseEnsemble(data.hourly, source.family);
      }),
    );
    raw = {
      intervalAligned: true,
      fetchedAt: new Date().toISOString(),
      models: results.flatMap((res) =>
        res.status === "fulfilled" ? res.value : [],
      ),
      errors: results.flatMap((res, i) =>
        res.status === "rejected"
          ? [`${ENSEMBLE_SOURCES[i].family}: ${res.reason.message}`]
          : [],
      ),
      source: "Open-Meteo Ensemble API",
    };
    if (!raw.models.length) throw new Error(raw.errors.join(" · "));
    await saveResearchRaw(key, "ensemble", raw);
  }
  if (!raw.intervalAligned) {
    raw.models = raw.models.map((m) => ({
      ...m,
      hours: alignHourlyIntervals(m.hours),
    }));
    raw.intervalAligned = true;
    await saveResearchRaw(key, "ensemble", raw);
  }
  return {
    key,
    lat,
    lon,
    fetchedAt: raw.fetchedAt,
    rulesSignature: rulesSignature(r),
    windows: calculateOperationalWindows(raw, r),
    paths: memberPaths(raw.models, r),
    sources: ENSEMBLE_SOURCES.map((s) => {
      const models = raw!.models.filter((m) => m.family === s.family);
      return {
        family: s.family,
        members: models.length,
        usableMembers: models.filter((m) =>
          m.hours.some((h) => h.wind !== null && h.rain !== null),
        ).length,
      };
    }),
    errors: raw.errors,
    nativeResolution:
      "Datos nativos de 3–6 h interpolados por el proveedor a 1 h; la continuidad subhoraria no está garantizada.",
  };
}
export async function loadHistoricalClimate(
  key: string,
  lat: number,
  lon: number,
  r: Rules,
): Promise<HistoricalClimate> {
  const currentYear = Number(localDate().slice(0, 4));
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 5 + i);
  let raw = await readResearchRaw<{
    years: number[];
    hours: Hour[];
    fetchedAt: string;
    intervalAligned?: boolean;
  }>(key, "history");
  if (!raw || raw.years.at(-1) !== currentYear - 1) {
    const hours: Hour[] = [];
    // Five independent seasonal histories, with hourly gusts from the IFS archive.
    for (const year of years) {
      const url = new URL(
        process.env.WEATHER_API_KEY
          ? "https://customer-archive-api.open-meteo.com/v1/archive"
          : "https://archive-api.open-meteo.com/v1/archive",
      );
      const params: Record<string, string> = {
        latitude: String(lat),
        longitude: String(lon),
        start_date: `${year}-10-01`,
        end_date: `${year}-12-31`,
        models: "ecmwf_ifs",
        hourly:
          "wind_speed_10m,wind_gusts_10m,precipitation,soil_moisture_0_to_7cm",
        timezone: "America/Argentina/Buenos_Aires",
        wind_speed_unit: "kmh",
      };
      if (process.env.WEATHER_API_KEY)
        params.apikey = process.env.WEATHER_API_KEY;
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      const d = await jsonFetch(url);
      if (!d.hourly?.time) throw new Error("Archivo sin datos");
      const h = d.hourly;
      hours.push(
        ...h.time.map((time: string, i: number) => ({
          time,
          wind: numeric(h.wind_speed_10m?.[i]),
          gust: numeric(h.wind_gusts_10m?.[i]),
          rain: numeric(h.precipitation?.[i]),
          soil: numeric(h.soil_moisture_0_to_7cm?.[i]),
        })),
      );
    }
    raw = { years, hours, fetchedAt: new Date().toISOString() };
    await saveResearchRaw(key, "history", raw);
  }
  if (!raw.intervalAligned) {
    raw.hours = alignHourlyIntervals(raw.hours);
    raw.intervalAligned = true;
    await saveResearchRaw(key, "history", raw);
  }
  const paths = memberPaths(
    [{ model: "IFS histórico", hours: raw.hours }],
    r,
  )[0].days;
  const monthly: HistoricalClimate["monthly"] = {};
  for (const [date, capacity] of Object.entries(paths)) {
    if (capacity === null) continue;
    const month = date.slice(5, 7);
    const m = monthly[month] ?? { days: 0, operable: 0, fraction: 0 };
    m.days++;
    if (capacity > 0) m.operable++;
    m.fraction = m.operable / m.days;
    monthly[month] = m;
  }
  if (!Object.keys(monthly).length)
    throw new Error(
      "El archivo no tiene cobertura completa de viento y lluvia.",
    );
  return {
    key,
    lat,
    lon,
    fetchedAt: raw.fetchedAt,
    rulesSignature: rulesSignature(r),
    years: raw.years,
    days: paths,
    monthly,
    source:
      "Archivo histórico IFS · octubre–diciembre 2021–2025 · referencia modelada, no estación observada",
  };
}
