import type { ClimateMachineLearning } from "./boosted-model";
import {
  addDays,
  Hour,
  ModelForecast,
  Rules,
  WeatherForecast,
  Window,
} from "./types";
import { previousRainEligible, windowRainEligible } from "./weather-rules";
// Cache and analysis key per equipment coordinate (~1 m), not a 0.25° regional cell.
export const cellKey = (lat: number, lon: number) =>
  `${Math.round(lat * 100000) / 100000},${Math.round(lon * 100000) / 100000}`;
export const rulesSignature = (r: Rules) =>
  JSON.stringify([
    "dry-trial-window-previous-rain-v5",
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
// A source with a shorter horizon must not veto other well-covered sources.
// Coverage is checked before combining, never by treating missing values as zero.
export function usableMemberGroups(paths: MemberPath[], dates: string[]) {
  return [...new Set(paths.map((p) => p.family))]
    .map((family) => {
      const all = paths.filter((p) => p.family === family);
      const complete = all.filter((p) =>
        dates.every(
          (date) =>
            typeof p.days[date] === "number" &&
            Number.isFinite(p.days[date]) &&
            p.days[date]! >= 0,
        ),
      );
      return { family, all, complete };
    })
    .filter(
      (g) => g.complete.length >= 10 && g.complete.length / g.all.length >= 0.8,
    );
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
  machineLearning?: ClimateMachineLearning;
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
  const eligible = previousRainEligible(previous, r);
  if (eligible !== true) return eligible === false ? 0 : null;
  const relevant = hours.filter(
    (h) =>
      Number(h.time.slice(11, 13)) >= r.startHour &&
      Number(h.time.slice(11, 13)) < r.endHour,
  );
  if (
    relevant.length !== r.endHour - r.startHour ||
    new Set(relevant.map((h) => h.time)).size !== relevant.length ||
    relevant.some(
      (h) =>
        h.wind === null ||
        !Number.isFinite(h.wind) ||
        h.rain === null ||
        !Number.isFinite(h.rain) ||
        h.rain < 0,
    )
  )
    return null;
  relevant.sort((a, b) => a.time.localeCompare(b.time));
  let slots = 0;
  for (let i = 0; i <= relevant.length - r.minHours;) {
    const block = relevant.slice(i, i + r.minHours);
    const contiguous = block.every(
      (h, j) =>
        !j || Date.parse(h.time) - Date.parse(block[j - 1].time) === 3600000,
    );
    if (
      contiguous &&
      block.every((h) => h.wind! <= r.wind) &&
      windowRainEligible(block, r) === true
    ) {
      slots++;
      i += r.minHours;
    } else i++;
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
