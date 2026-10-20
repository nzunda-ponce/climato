import { addDays, Hour, Rules } from "./types";
import { dailyCapacity, HistoricalClimate, rulesSignature } from "./evidence";
import { dailyRainTotal } from "./weather-rules";
import { validateAnalogues } from "./seasonal";
export function assessHistoryYear(
  key: string,
  lat: number,
  lon: number,
  year: number,
  hours: Hour[],
  rules: Rules,
): HistoricalClimate {
  const groups = new Map<string, Hour[]>();
  for (const hour of hours) {
    const date = hour.time.slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), hour]);
  }
  const days: HistoricalClimate["days"] = {},
    features: NonNullable<HistoricalClimate["features"]> = [];
  for (const [date, h] of groups) {
    if (
      !date.startsWith(`${year}-`) ||
      !["10", "11", "12"].includes(date.slice(5, 7))
    )
      continue;
    const previous = groups.get(addDays(date, -1)) ?? [],
      slots = dailyCapacity(h, rules, previous);
    days[date] = slots;
    const sample = h.filter(
      (v) =>
        Number(v.time.slice(11, 13)) % 6 === 0 &&
        Number(v.time.slice(11, 13)) >= rules.startHour &&
        Number(v.time.slice(11, 13)) < rules.endHour,
    );
    const rain = dailyRainTotal(h),
      previousRain = dailyRainTotal(previous);
    if (
      slots !== null &&
      sample.length &&
      sample.every((v) => v.wind !== null) &&
      rain !== null &&
      previousRain !== null
    )
      features.push({
        date,
        slots,
        wind: Math.max(...sample.map((v) => v.wind!)),
        rain,
        previousRain,
      });
  }
  return mergeHistory(undefined, {
    key,
    lat,
    lon,
    years: [year],
    days,
    features,
    monthly: {},
    source: "ERA5",
    rulesSignature: rulesSignature(rules),
    fetchedAt: new Date().toISOString(),
  });
}
export function mergeHistory(
  old: HistoricalClimate | undefined,
  incoming: HistoricalClimate,
): HistoricalClimate {
  const compatible =
    old?.rulesSignature === incoming.rulesSignature && old.key === incoming.key;
  const years = [
    ...new Set([...(compatible ? old.years : []), ...incoming.years]),
  ].sort((a, b) => a - b);
  const days = {
    ...(compatible
      ? Object.fromEntries(
          Object.entries(old.days).filter(
            ([date]) => !incoming.years.includes(Number(date.slice(0, 4))),
          ),
        )
      : {}),
    ...incoming.days,
  };
  const features = [
    ...(compatible ? (old.features ?? []) : []).filter(
      (f) => !incoming.years.includes(Number(f.date.slice(0, 4))),
    ),
    ...(incoming.features ?? []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const monthly: HistoricalClimate["monthly"] = {};
  for (const [date, slots] of Object.entries(days)) {
    if (slots === null) continue;
    const month = date.slice(5, 7),
      m = (monthly[month] ??= { days: 0, operable: 0, fraction: 0 });
    m.days++;
    if (slots > 0) m.operable++;
    m.fraction = m.operable / m.days;
  }
  return {
    ...incoming,
    years,
    days,
    features,
    monthly,
    validation: years.length >= 45 ? validateAnalogues(features) : undefined,
    source: `ERA5 horario · octubre–diciembre ${years[0]}–${years.at(-1)} · ${years.length} años · reanálisis, no estación`,
  };
}
