import { HistoricalClimate } from "./evidence";
export const PUBLIC_WEATHER_BOUNDS = {
  south: -46,
  north: -20,
  west: -82,
  east: -42,
};
export const PUBLIC_FINE_BOUNDS = {
  south: -42,
  north: -24,
  west: -70,
  east: -54,
};
export function publicGridPoints() {
  const nodes = new Map<string, { lat: number; lon: number }>();
  for (const [bounds, step] of [
    [PUBLIC_FINE_BOUNDS, 1],
    [PUBLIC_WEATHER_BOUNDS, 2],
  ] as const)
    for (let lat = bounds.south; lat <= bounds.north; lat += step)
      for (let lon = bounds.west; lon <= bounds.east; lon += step)
        nodes.set(`${lat},${lon}`, { lat, lon });
  return [...nodes.values()];
}
export interface SeasonalDay {
  probability: number | null;
  slots: number | null;
  wind: number | null;
  rain: number | null;
  source: "EC46" | "SEAS5";
  members: number;
}
export interface SeasonalAssessment {
  key: string;
  lat: number;
  lon: number;
  fetchedAt: string;
  rulesSignature: string;
  days: Record<string, SeasonalDay>;
  years: number[];
  method: string;
  errors: string[];
}
export interface EnsoIndex {
  fetchedAt: string;
  source: string;
  values: Record<string, number>;
  phases: Record<string, string>;
  latest: { season: string; value: number; phase: string };
}
export interface ForecastGrid {
  fetchedAt: string;
  rainRepairs?: Record<string, string>;
  start: string;
  end: string;
  step: number;
  coarseStep?: number;
  bounds: { south: number; north: number; west: number; east: number };
  nodes: {
    lat: number;
    lon: number;
    days: Record<
      string,
      {
        wind: number | null;
        rain: number | null;
        u: number | null;
        v: number | null;
      }
    >;
  }[];
  model: string;
  errors: string[];
}
export function parseRoni(
  html: string,
  fetchedAt = new Date().toISOString(),
): EnsoIndex {
  const values: Record<string, number> = {};
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [
      ...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),
    ].map((m) =>
      m[1]
        .replace(/<[^>]*>/g, " ")
        .replace(/&[^;]+;/g, " ")
        .trim(),
    );
    const year = Number(cells[0]);
    if (!Number.isInteger(year) || year < 1950 || year > 2100) continue;
    for (let i = 1; i <= 12; i++) {
      const n = Number(cells[i]);
      if (cells[i] && Number.isFinite(n) && Math.abs(n) < 10)
        values[`${year}-${String(i).padStart(2, "0")}`] = n;
    }
  }
  const keys = Object.keys(values).sort(),
    phases: Record<string, string> = {};
  keys.forEach((k) => (phases[k] = "Neutral"));
  for (let i = 0; i < keys.length;) {
    const sign = values[keys[i]] >= 0.5 ? 1 : values[keys[i]] <= -0.5 ? -1 : 0;
    let j = i + 1;
    while (
      sign &&
      j < keys.length &&
      (sign > 0 ? values[keys[j]] >= 0.5 : values[keys[j]] <= -0.5)
    )
      j++;
    if (sign && j - i >= 5)
      for (let p = i; p < j; p++) phases[keys[p]] = sign > 0 ? "Niño" : "Niña";
    i = sign ? j : i + 1;
  }
  if (keys.length < 500)
    throw new Error("Serie RONI incompleta o formato no reconocido");
  const key = keys.at(-1)!;
  return {
    fetchedAt,
    source:
      "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/",
    values,
    phases,
    latest: {
      season: key,
      value: values[key],
      phase:
        values[key] >= 0.5 ? "Niño" : values[key] <= -0.5 ? "Niña" : "Neutral",
    },
  };
}

// Interpretable analogue model. Forecast wind/rain drive the prediction;
// Hourly ERA5 labels carry the continuous wind and rain window criteria.
// This is statistical downscaling, not a validated seasonal hindcast calibration.
export function analogueModel(
  features: NonNullable<HistoricalClimate["features"]>,
) {
  const cache = new Map<string, { probability: number; slots: number }>();
  return (month: string, wind: number, rain: number, previousRain = 0) => {
    const w = Math.round(wind / 2) * 2,
      r = Math.round(Math.log1p(Math.max(0, rain)) * 4) / 4;
    const previous = Math.round(Math.log1p(Math.max(0, previousRain)) * 4) / 4;
    const key = `${month}/${w}/${r}/${previous}`;
    const old = cache.get(key);
    if (old) return old;
    const candidates = features
      .filter((d) => d.date.slice(5, 7) === month)
      .map((d) => ({
        d,
        distance:
          ((d.wind - w) / 5) ** 2 +
          ((Math.log1p(d.rain) - r) / 0.8) ** 2 +
          ((Math.log1p(d.previousRain ?? 0) - previous) / 0.8) ** 2,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 60);
    if (candidates.length < 30) return null;
    let weight = 0,
      probability = 0,
      slots = 0;
    for (const c of candidates) {
      const k = 1 / (0.25 + c.distance);
      weight += k;
      probability += (c.d.slots > 0 ? 1 : 0) * k;
      slots += c.d.slots * k;
    }
    const result = { probability: probability / weight, slots: slots / weight };
    cache.set(key, result);
    return result;
  };
}
export function validateAnalogues(
  features: NonNullable<HistoricalClimate["features"]>,
) {
  const train = features.filter((d) => d.date < "2016"),
    test = features
      .filter((d) => d.date >= "2016")
      .filter((_, i) => i % 5 === 0);
  if (train.length < 1000 || test.length < 100) return undefined;
  const model = analogueModel(train);
  let sum = 0,
    baseline = 0,
    count = 0;
  const means = new Map<string, number>();
  for (const month of ["10", "11", "12"]) {
    const v = train.filter((d) => d.date.slice(5, 7) === month);
    means.set(month, v.filter((d) => d.slots > 0).length / v.length);
  }
  for (const d of test) {
    const p = model(d.date.slice(5, 7), d.wind, d.rain, d.previousRain);
    if (!p) continue;
    const truth = d.slots > 0 ? 1 : 0;
    sum += (p.probability - truth) ** 2;
    baseline += (means.get(d.date.slice(5, 7))! - truth) ** 2;
    count++;
  }
  return {
    brier: sum / count,
    baseline: baseline / count,
    count,
    trainEnd: 2015,
    testStart: 2016,
    label:
      "Validación temporal interna con ERA5; no mide habilidad del pronóstico SEAS5 ni resultados de campo.",
  };
}
export function gridSample(
  grid: ForecastGrid,
  lat: number,
  lon: number,
  start: string,
  end: string,
  field: "wind" | "rain",
) {
  const { south, west, north, east } = grid.bounds;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  const y = Math.floor((lat - south) / grid.step),
    x = Math.floor((lon - west) / grid.step);
  const a = south + y * grid.step,
    b = west + x * grid.step;
  const nodes = [
    [a, b],
    [a, b + grid.step],
    [a + grid.step, b],
    [a + grid.step, b + grid.step],
  ].map(([la, lo]) =>
    grid.nodes.find(
      (n) => Math.abs(n.lat - la) < 0.001 && Math.abs(n.lon - lo) < 0.001,
    ),
  );
  if (nodes.some((n) => !n)) return null;
  const values = nodes.map((n) => {
    const v = Object.entries(n!.days)
      .filter(([d]) => d >= start && d <= end)
      .map(([, v]) => v[field])
      .filter((v): v is number => v !== null);
    return v.length ? v.reduce((s, v) => s + v, 0) / v.length : null;
  });
  if (values.some((v) => v === null)) return null;
  const fx = (lon - b) / grid.step,
    fy = (lat - a) / grid.step;
  return (
    values[0]! * (1 - fx) * (1 - fy) +
    values[1]! * fx * (1 - fy) +
    values[2]! * (1 - fx) * fy +
    values[3]! * fx * fy
  );
}
