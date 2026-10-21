import { addDays } from "./types";
export interface WeatherDayInput {
  wind: number | null;
  rain: number | null;
  previousRain?: number | null;
}
export const calendarFeatureNames = [
  "Ciclo anual · seno",
  "Ciclo anual · coseno",
  "Ciclo semestral · seno",
  "Ciclo semestral · coseno",
  "Avance de la temporada",
];
export const weatherFeatureNames = [
  ...calendarFeatureNames,
  "Viento en jornada",
  "Lluvia del día",
  "Lluvia del día anterior",
  "Lluvia previa · 3 días",
  "Lluvia previa · 7 días",
  "Cambio de viento",
  "Racha seca previa",
];
export function calendarFeatures(date: string): (number | null)[] {
  const year = date.slice(0, 4);
  const day =
    (Date.parse(date + "T12:00Z") - Date.parse(`${year}-01-01T12:00Z`)) /
    86400000;
  const phase = (day / 365.25) * 2 * Math.PI;
  const season =
    (Date.parse(date + "T12:00Z") - Date.parse(`${year}-10-01T12:00Z`)) /
    86400000 /
    92;
  return [
    Math.sin(phase),
    Math.cos(phase),
    Math.sin(2 * phase),
    Math.cos(2 * phase),
    season,
  ];
}
const finite = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) && value >= 0 ? value : null;
export function weatherFeatures(
  date: string,
  current: WeatherDayInput,
  previous: (date: string) => WeatherDayInput | undefined,
): (number | null)[] {
  // Only past dates are read here. Target labels/capacity never enter predictors.
  const before = previous(addDays(date, -1));
  const previousRain = finite(current.previousRain) ?? finite(before?.rain);
  const rains = Array.from({ length: 7 }, (_, i) =>
    i === 0 ? previousRain : finite(previous(addDays(date, -i - 1))?.rain),
  );
  const accumulated = (length: number) =>
    rains.slice(0, length).every((v) => v !== null)
      ? rains.slice(0, length).reduce<number>((sum, v) => sum + v!, 0)
      : null;
  let dry: number | null = 0;
  for (const rain of rains) {
    if (rain === null) {
      dry = null;
      break;
    }
    if (rain > 0) break;
    dry++;
  }
  const wind = finite(current.wind),
    priorWind = finite(before?.wind);
  const log = (value: number | null) =>
    value === null ? null : Math.log1p(Math.max(0, value));
  return [
    ...calendarFeatures(date),
    wind,
    log(finite(current.rain)),
    log(previousRain),
    log(accumulated(3)),
    log(accumulated(7)),
    wind !== null && priorWind !== null ? wind - priorWind : null,
    dry,
  ];
}
