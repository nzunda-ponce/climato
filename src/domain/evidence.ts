import {
  addDays,
  Hour,
  ModelForecast,
  Rules,
  WeatherForecast,
  Window,
} from "./types";
import { dayRainEligible } from "./weather-rules";
export const cellKey = (lat: number, lon: number) =>
  `${Math.round(lat * 4) / 4},${Math.round(lon * 4) / 4}`;
export const rulesSignature = (r: Rules) =>
  JSON.stringify([
    "dry-day-previous-rain-v4",
    r.wind,
    r.rain,
    r.rain24Limit,
    r.minHours,
    r.startHour,
    r.endHour,
  ]);
// Rain and gust maxima at t describe the preceding hour in Open-Meteo.
// The domain uses intervals [t,t+1), so use the next timestamp's accumulations.
export function alignHourlyIntervals(hours: Hour[]): Hour[] {
  return hours.map((h, i) => {
    const next = hours[i + 1];
    const contiguous =
      next && Date.parse(next.time) - Date.parse(h.time) === 3600000;
    return {
      ...h,
      gust: contiguous ? next.gust : null,
      rain: contiguous ? next.rain : null,
    };
  });
}
export interface MemberPath {
  family: string;
  member: string;
  days: Record<string, number | null>;
}
export interface EnsembleAssessment {
  key: string;
  lat: number;
  lon: number;
  fetchedAt: string;
  rulesSignature: string;
  windows: Window[];
  paths: MemberPath[];
  sources: { family: string; members: number; usableMembers: number }[];
  errors: string[];
  nativeResolution: string;
}
export interface HistoricalClimate {
  key: string;
  lat: number;
  lon: number;
  fetchedAt: string;
  rulesSignature: string;
  years: number[];
  days: Record<string, number | null>;
  monthly: Record<string, { days: number; operable: number; fraction: number }>;
  source: string;
  features?: {
    date: string;
    wind: number;
    rain: number;
    previousRain?: number;
    slots: number;
  }[];
  enso?: Record<
    string,
    { years: number[]; days: number; operable: number; fraction: number }
  >;
  validation?: {
    brier: number;
    baseline: number;
    count: number;
    trainEnd: number;
    testStart: number;
    label: string;
  };
}
export function dailyCapacity(
  hours: Hour[],
  r: Rules,
  previous: Hour[] = [],
): number | null {
  const eligible = dayRainEligible(hours, previous, r);
  if (eligible !== true) return eligible === false ? 0 : null;
  const relevant = hours.filter(
    (h) =>
      Number(h.time.slice(11, 13)) >= r.startHour &&
      Number(h.time.slice(11, 13)) < r.endHour,
  );
  if (
    relevant.length !== r.endHour - r.startHour ||
    relevant.some((h) => h.wind === null || h.rain === null)
  )
    return null;
  let run = 0,
    slots = 0;
  for (const h of relevant) {
    if (h.wind! <= r.wind && h.rain! <= r.rain) {
      run++;
      if (run === r.minHours) {
        slots++;
        run = 0;
      }
    } else run = 0;
  }
  return slots;
}
export function memberPaths(
  models: ModelForecast[],
  rules: Rules,
): MemberPath[] {
  return models.map((m) => {
    const groups = new Map<string, Hour[]>();
    for (const h of m.hours) {
      const date = h.time.slice(0, 10);
      const group = groups.get(date) ?? [];
      group.push(h);
      groups.set(date, group);
    }
    return {
      family: m.family ?? m.model,
      member: m.member ?? "control",
      days: Object.fromEntries(
        [...groups].map(([d, h]) => [
          d,
          dailyCapacity(h, rules, groups.get(addDays(d, -1)) ?? []),
        ]),
      ),
    };
  });
}
export interface Observation {
  id: string;
  pivotId: string;
  issuedAt: string;
  validAt: string;
  probability: number;
  operable: boolean;
  wind?: number;
  rain?: number;
  access?: boolean;
  source: string;
}
export interface Calibration {
  ready: boolean;
  reason: string;
  count: number;
  intercept?: number;
  slope?: number;
  trainedUntil?: string;
  brierRaw?: number;
  brierCalibrated?: number;
  testCount?: number;
}
const logit = (p: number) =>
  Math.log(
    Math.max(0.005, Math.min(0.995, p)) /
      (1 - Math.max(0.005, Math.min(0.995, p))),
  );
const sigmoid = (x: number) =>
  1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
export function trainCalibration(input: Observation[]): Calibration {
  const data = [...input].sort((a, b) => a.validAt.localeCompare(b.validAt));
  if (data.length < 200)
    return {
      ready: false,
      reason:
        "Se requieren al menos 200 ventanas verificadas; no se entrena con pronósticos como si fueran observaciones.",
      count: data.length,
    };
  const cutoff = data[Math.floor(data.length * 0.75)].validAt;
  const train = data.filter(
      (d) => d.validAt < cutoff && d.issuedAt < d.validAt,
    ),
    test = data.filter((d) => d.validAt >= cutoff && d.issuedAt < d.validAt);
  if (
    train.filter((d) => d.operable).length < 20 ||
    train.filter((d) => !d.operable).length < 20 ||
    test.length < 40
  )
    return {
      ready: false,
      reason:
        "Faltan casos de ambas clases o un bloque temporal de validación independiente.",
      count: data.length,
    };
  let a = 0,
    b = 1;
  for (let epoch = 0; epoch < 1500; epoch++) {
    let ga = 0,
      gb = 0;
    for (const d of train) {
      const x = logit(d.probability);
      const e = sigmoid(a + b * x) - Number(d.operable);
      ga += e;
      gb += e * x;
    }
    a -= (0.05 * ga) / train.length;
    b -= 0.05 * (gb / train.length + 0.01 * (b - 1));
  }
  const raw =
    test.reduce((s, d) => s + (d.probability - Number(d.operable)) ** 2, 0) /
    test.length;
  const calibrated =
    test.reduce(
      (s, d) =>
        s + (sigmoid(a + b * logit(d.probability)) - Number(d.operable)) ** 2,
      0,
    ) / test.length;
  return {
    ready: calibrated < raw - 0.005,
    reason:
      calibrated < raw - 0.005
        ? "Calibración logística mejora el Brier score en validación temporal."
        : "La calibración no mejora el baseline en validación temporal; no se aplica.",
    count: data.length,
    intercept: a,
    slope: b,
    trainedUntil: train.at(-1)!.validAt,
    brierRaw: raw,
    brierCalibrated: calibrated,
    testCount: test.length,
  };
}
export function calibratedProbability(p: number, c?: Calibration) {
  return c?.ready && c.intercept !== undefined && c.slope !== undefined
    ? sigmoid(c.intercept + c.slope * logit(p))
    : p;
}
