import { promises as fs } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { addDays, Hour, localDate, Rules } from "@/domain/types";
import { dailyRainTotal } from "@/domain/weather-rules";
import {
  alignHourlyIntervals,
  dailyCapacity,
  HistoricalClimate,
  rulesSignature,
} from "@/domain/evidence";
import {
  analogueModel,
  EnsoIndex,
  ForecastGrid,
  parseRoni,
  SeasonalAssessment,
  validateAnalogues,
} from "@/domain/seasonal";
const root = path.join(process.cwd(), "data", "long-range");
export async function readLongCache<T>(name: string): Promise<T | undefined> {
  if (!/^[\w.,-]+$/.test(name)) throw new Error("Nombre de caché inválido");
  try {
    return JSON.parse(
      gunzipSync(
        await fs.readFile(path.join(root, name + ".json.gz")),
      ).toString(),
    ) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
export async function writeLongCache(name: string, value: unknown) {
  if (!/^[\w.,-]+$/.test(name)) throw new Error("Nombre de caché inválido");
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, name + ".json.gz"),
    temp = target + `.${process.pid}.tmp`;
  await fs.writeFile(temp, gzipSync(JSON.stringify(value)));
  // OneDrive can briefly lock an existing cache during synchronization.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temp, target);
      break;
    } catch (error) {
      if (
        !["EPERM", "EBUSY", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        ) ||
        attempt >= 5
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}
export async function fetchJson(url: URL) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(120000),
      cache: "no-store",
    });
    if (r.status === 429 && i < 3) {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      continue;
    }
    if (!r.ok)
      throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 180)}`);
    try {
      return await r.json();
    } catch (error) {
      if (i === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Límite de consultas de Open-Meteo");
}
function endpoint(
  kind: "archive" | "seasonal" | "forecast",
  params: Record<string, string>,
) {
  const host = kind === "forecast" ? "api" : `${kind}-api`;
  const u = new URL(
    `https://${process.env.WEATHER_API_KEY ? "customer-" : ""}${host}.open-meteo.com/v1/${kind === "forecast" ? "forecast" : kind}`,
  );
  for (const [k, v] of Object.entries({
    ...params,
    timezone: "America/Argentina/Buenos_Aires",
    wind_speed_unit: "kmh",
  }))
    u.searchParams.set(k, v);
  if (process.env.WEATHER_API_KEY)
    u.searchParams.set("apikey", process.env.WEATHER_API_KEY);
  return u;
}
export async function loadEnso(): Promise<EnsoIndex> {
  const old = await readLongCache<EnsoIndex>("enso-roni");
  if (old && Date.now() - Date.parse(old.fetchedAt) < 86400000)
    return {
      ...old,
      latest: {
        ...old.latest,
        phase:
          old.latest.value >= 0.5
            ? "Niño"
            : old.latest.value <= -0.5
              ? "Niña"
              : "Neutral",
      },
    };
  const url =
    "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/";
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`RONI HTTP ${r.status}`);
  const result = parseRoni(await r.text());
  await writeLongCache("enso-roni", result);
  return result;
}
type RawHour = { time: string[]; [key: string]: unknown[] };
const number = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export async function loadLongHistory(
  key: string,
  lat: number,
  lon: number,
  r: Rules,
  enso: EnsoIndex,
  cachedOnly = false,
): Promise<HistoricalClimate> {
  const last = Number(localDate().slice(0, 4)) - 1,
    years = Array.from({ length: 45 }, (_, i) => last - 44 + i);
  const cached = await readLongCache<HistoricalClimate>(`summary-${key}`);
  if (
    cached?.rulesSignature === rulesSignature(r) &&
    cached.years.length === 45 &&
    cached.years.at(-1) === last
  )
    return cached;
  const hours: Hour[] = [];
  for (let i = 0; i < years.length; i += 3) {
    const batch = await Promise.all(
      years.slice(i, i + 3).map(async (year) => {
        const name = `era5-${key}-${year}`;
        let raw = await readLongCache<{ hourly: RawHour }>(name);
        if (!raw) {
          if (cachedOnly)
            throw new Error(`Falta el archivo ERA5 ${year} de ${key}`);
          raw = await fetchJson(
            endpoint("archive", {
              latitude: String(lat),
              longitude: String(lon),
              models: "era5",
              hourly: "wind_speed_10m,wind_gusts_10m,precipitation",
              start_date: `${year}-10-01`,
              end_date: `${year + 1}-01-01`,
            }),
          );
          if (!raw?.hourly?.time) throw new Error(`ERA5 ${year}: sin datos`);
          await writeLongCache(name, raw);
        }
        const h = raw!.hourly;
        return alignHourlyIntervals(
          h.time.map((time, i) => ({
            time,
            wind: number(h.wind_speed_10m?.[i]),
            gust: number(h.wind_gusts_10m?.[i]),
            rain: number(h.precipitation?.[i]),
            soil: null,
          })),
        );
      }),
    );
    hours.push(...batch.flat());
  }
  const groups = new Map<string, Hour[]>();
  for (const h of hours) {
    if (!["10", "11", "12"].includes(h.time.slice(5, 7))) continue;
    const date = h.time.slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), h]);
  }
  const days: Record<string, number | null> = {},
    features: NonNullable<HistoricalClimate["features"]> = [],
    monthly: HistoricalClimate["monthly"] = {},
    phases: NonNullable<HistoricalClimate["enso"]> = {};
  for (const [date, h] of groups) {
    const previous = groups.get(addDays(date, -1)) ?? [];
    const slots = dailyCapacity(h, r, previous);
    days[date] = slots;
    if (slots === null) continue;
    const sample = h.filter(
      (h) =>
        Number(h.time.slice(11, 13)) % 6 === 0 &&
        Number(h.time.slice(11, 13)) >= r.startHour &&
        Number(h.time.slice(11, 13)) < r.endHour,
    );
    if (
      sample.length &&
      sample.every((h) => h.wind !== null) &&
      h.length === 24 &&
      h.every((h) => h.rain !== null)
    )
      features.push({
        date,
        slots,
        wind: Math.max(...sample.map((h) => h.wind!)),
        rain: h.reduce((s, h) => s + h.rain!, 0),
        previousRain: dailyRainTotal(previous)!,
      });
    const month = date.slice(5, 7),
      m = monthly[month] ?? { days: 0, operable: 0, fraction: 0 };
    m.days++;
    if (slots > 0) m.operable++;
    m.fraction = m.operable / m.days;
    monthly[month] = m;
    const phase = enso.phases[date.slice(0, 7)] ?? "Sin índice",
      g = phases[phase] ?? { years: [], days: 0, operable: 0, fraction: 0 };
    g.days++;
    if (slots > 0) g.operable++;
    g.fraction = g.operable / g.days;
    const year = Number(date.slice(0, 4));
    if (!g.years.includes(year)) g.years.push(year);
    phases[phase] = g;
  }
  const result: HistoricalClimate = {
    key,
    lat,
    lon,
    fetchedAt: new Date().toISOString(),
    rulesSignature: rulesSignature(r),
    years,
    days,
    monthly,
    features,
    enso: phases,
    validation: validateAnalogues(features),
    source: `ERA5 horario · octubre–diciembre ${years[0]}–${last} · 45 años · reanálisis, no estación`,
  };
  await writeLongCache(`summary-${key}`, result);
  return result;
}
export async function loadSeasonal(
  key: string,
  lat: number,
  lon: number,
  r: Rules,
  history?: HistoricalClimate,
  cachedOnly = false,
): Promise<SeasonalAssessment> {
  const start = localDate(),
    end = addDays(r.deadline, 1),
    name = `seasonal-${key}`;
  let raw = await readLongCache<{
    fetchedAt: string;
    hourly: RawHour;
    end: string;
  }>(name);
  if (
    !raw ||
    raw.end !== end ||
    (!cachedOnly && Date.now() - Date.parse(raw.fetchedAt) > 12 * 3600000)
  ) {
    if (cachedOnly) throw new Error(`Falta la serie estacional de ${key}`);
    const response = await fetchJson(
      endpoint("seasonal", {
        latitude: String(lat),
        longitude: String(lon),
        models: "ecmwf_seasonal_seamless",
        hourly: "wind_speed_10m,wind_gusts_10m,precipitation",
        start_date: start,
        end_date: end,
      }),
    );
    if (!response.hourly?.time) throw new Error("Sin serie EC46/SEAS5");
    raw = { ...response, fetchedAt: new Date().toISOString(), end };
    await writeLongCache(name, raw);
  }
  const hourly = raw!.hourly,
    keys = Object.keys(hourly).filter((k) =>
      /^wind_speed_10m(?:_member\d+)?$/.test(k),
    );
  const model =
    history?.features &&
    history.years.length >= 30 &&
    history.rulesSignature === rulesSignature(r)
      ? analogueModel(history.features)
      : undefined;
  const indices = new Map<string, number[]>();
  hourly.time.forEach((t, i) => {
    const d = t.slice(0, 10);
    indices.set(d, [...(indices.get(d) ?? []), i]);
  });
  const days: SeasonalAssessment["days"] = {};
  for (const [date, indicesForDay] of indices) {
    if (date <= start || date > r.deadline) continue;
    const samples: {
      probability: number;
      slots: number;
      wind: number;
      rain: number;
    }[] = [];
    for (const k of keys) {
      const suffix = k.slice("wind_speed_10m".length);
      const work = indicesForDay.filter(
        (i) =>
          Number(hourly.time[i].slice(11, 13)) >= r.startHour &&
          Number(hourly.time[i].slice(11, 13)) < r.endHour,
      );
      const winds = work.map((i) => number(hourly[k][i])),
        rains = indicesForDay.map((i) =>
          number(hourly[`precipitation${suffix}`]?.[i + 1]),
        ),
        before = (indices.get(addDays(date, -1)) ?? []).map((i) =>
          number(hourly[`precipitation${suffix}`]?.[i + 1]),
        );
      if (
        before.length !== 4 ||
        before.some((v) => v === null) ||
        !winds.length ||
        winds.some((v) => v === null) ||
        rains.length !== 4 ||
        rains.some((v) => v === null)
      )
        continue;
      const wind = Math.max(...(winds as number[])),
        rain = (rains as number[]).reduce((s, v) => s + v, 0),
        previousRain = (before as number[]).reduce((s, v) => s + v, 0),
        prediction =
          rain > r.rain || previousRain >= r.rain24Limit
            ? { probability: 0, slots: 0 }
            : model?.(date.slice(5, 7), wind, rain, previousRain);
      if (prediction) samples.push({ ...prediction, wind, rain });
    }
    const source = indicesForDay.some(
      (i) => number(hourly.wind_gusts_10m?.[i]) !== null,
    )
      ? "EC46"
      : "SEAS5";
    days[date] = {
      source,
      members: samples.length,
      probability: samples.length
        ? samples.reduce((s, v) => s + v.probability, 0) / samples.length
        : null,
      slots: samples.length
        ? samples.reduce((s, v) => s + v.slots, 0) / samples.length
        : null,
      wind: samples.length
        ? samples.reduce((s, v) => s + v.wind, 0) / samples.length
        : null,
      rain: samples.length
        ? samples.reduce((s, v) => s + v.rain, 0) / samples.length
        : null,
    };
  }
  return {
    key,
    lat,
    lon,
    fetchedAt: raw!.fetchedAt,
    rulesSignature: rulesSignature(r),
    days,
    years: history?.years ?? [],
    method:
      "Ensemble dinámico EC46/SEAS5 + 60 análogos ERA5 por miembro y mes; viento y lluvia del pronóstico, ventanas horarias históricas de viento y lluvia. Experimental, sin calibración contra hindcasts SEAS5.",
    errors: model
      ? []
      : ["Faltan al menos 30 años de datos compatibles para estimar ventanas."],
  };
}
export function gridCoordinates(bounds: ForecastGrid["bounds"], step = 1) {
  const nodes: { lat: number; lon: number }[] = [];
  for (let lat = bounds.south; lat <= bounds.north + 0.001; lat += step)
    for (let lon = bounds.west; lon <= bounds.east + 0.001; lon += step)
      nodes.push({ lat, lon });
  return nodes;
}
// Restore only missing rainfall from the public regional grid. No equipment
// coordinates are used and existing observations are preserved.
export async function repairGridRain() {
  const grid = await readLongCache<ForecastGrid>("grid");
  if (!grid) throw new Error("Falta la malla meteorológica");
  const dates = [
    ...new Set(
      grid.nodes.flatMap((n) =>
        Object.entries(n.days)
          .filter(
            ([date, day]) =>
              date >= localDate() && date <= grid.end && day.rain === null,
          )
          .map(([date]) => date),
      ),
    ),
  ].sort();
  let repaired = 0;
  for (const date of dates) {
    const missing = grid.nodes.filter((n) => n.days[date]?.rain === null);
    for (let offset = 0; offset < missing.length; offset += 100) {
      const points = missing.slice(offset, offset + 100);
      const raw = await fetchJson(
        endpoint("seasonal", {
          latitude: points.map((p) => p.lat).join(","),
          longitude: points.map((p) => p.lon).join(","),
          models: "ecmwf_seasonal_ensemble_mean_seamless",
          hourly: "precipitation",
          start_date: date,
          end_date: addDays(date, 1),
        }),
      );
      const rows = Array.isArray(raw) ? raw : [raw];
      if (rows.length !== points.length)
        throw new Error("Respuesta de malla incompleta");
      rows.forEach((row, i) => {
        const h = row.hourly as RawHour | undefined;
        if (!h?.time) return;
        const amounts = h.time.flatMap((t, j) =>
          t.startsWith(date) ? [number(h.precipitation?.[j + 1])] : [],
        );
        if (amounts.length !== 4 || amounts.some((v) => v === null)) return;
        points[i].days[date].rain = (amounts as number[]).reduce(
          (sum, v) => sum + v,
          0,
        );
        repaired++;
      });
    }
    (grid.rainRepairs ??= {})[date] = new Date().toISOString();
    await writeLongCache("grid", grid);
  }
  return { dates, repaired };
}
export async function loadGridBatch(
  points: { lat: number; lon: number }[],
  end: string,
) {
  const params = {
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    hourly: "wind_speed_10m,wind_direction_10m,precipitation",
    start_date: localDate(),
    end_date: addDays(end, 1),
  };
  const seasonal = await fetchJson(
    endpoint("seasonal", {
      ...params,
      models: "ecmwf_seasonal_ensemble_mean_seamless",
    }),
  );
  const shorter = await fetchJson(
    endpoint("forecast", {
      latitude: params.latitude,
      longitude: params.longitude,
      hourly: params.hourly,
      forecast_days: "15",
    }),
  );
  const seasonRows = Array.isArray(seasonal) ? seasonal : [seasonal],
    shortRows = Array.isArray(shorter) ? shorter : [shorter];
  return points.map((p, n) => {
    const days: ForecastGrid["nodes"][number]["days"] = {};
    for (const [raw, interval] of [
      [seasonRows[n], 6],
      [shortRows[n], 1],
    ] as const) {
      const h = raw?.hourly as RawHour | undefined;
      if (!h?.time) throw new Error("Malla sin datos horarios");
      const groups = new Map<string, number[]>();
      h.time.forEach((t, i) => {
        const d = t.slice(0, 10);
        groups.set(d, [...(groups.get(d) ?? []), i]);
      });
      for (const [d, ix] of groups) {
        if (d > end) continue;
        const ws = ix.map((i) => number(h.wind_speed_10m?.[i])),
          ps = ix.map((i) => number(h.precipitation?.[i + 1])),
          dirs = ix.map((i) => number(h.wind_direction_10m?.[i]));
        const full = ix.length === 24 / interval;
        const wind =
          full && ws.every((v) => v !== null)
            ? (ws as number[]).reduce((s, v) => s + v, 0) / ws.length
            : null;
        const rain =
          full && ps.every((v) => v !== null)
            ? (ps as number[]).reduce((s, v) => s + v, 0)
            : null;
        const previous = days[d];
        const valid = wind !== null && dirs.every((v) => v !== null);
        days[d] = {
          wind: wind ?? previous?.wind ?? null,
          rain: rain ?? previous?.rain ?? null,
          u: valid
            ? ws.reduce<number>(
                (s, w, i) => s - w! * Math.sin((dirs[i]! * Math.PI) / 180),
                0,
              ) / ws.length
            : (previous?.u ?? null),
          v: valid
            ? ws.reduce<number>(
                (s, w, i) => s - w! * Math.cos((dirs[i]! * Math.PI) / 180),
                0,
              ) / ws.length
            : (previous?.v ?? null),
        };
      }
    }
    return { ...p, days };
  });
}
