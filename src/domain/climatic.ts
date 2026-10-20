import { addDays, localDate, PivotPlan, Rules } from "./types";
import {
  cellKey,
  EnsembleAssessment,
  HistoricalClimate,
  rulesSignature,
  usableMemberGroups,
} from "./evidence";
import { SeasonalAssessment } from "./seasonal";

export interface ClimateDay {
  date: string;
  probability: number | null;
  slots: number | null;
  source: "pronóstico" | "subestacional" | "estacional" | "sin datos";
}
export interface ClimateZone {
  key: string;
  lat: number;
  lon: number;
  name: string;
  pending: number;
  days: ClimateDay[];
  historicalRange: [number, number] | null;
  enso?: HistoricalClimate["enso"];
  years: number[];
}
export function periodPotential(zone: ClimateZone, start: string, end: string) {
  const days = zone.days.filter((d) => d.date >= start && d.date <= end);
  const covered = days.filter((d) => d.probability !== null);
  return {
    expectedDays: covered.length
      ? covered.reduce((s, d) => s + d.probability!, 0)
      : null,
    slots: covered.length
      ? covered.reduce((s, d) => s + (d.slots ?? 0), 0)
      : null,
    fraction: covered.length
      ? covered.reduce((s, d) => s + d.probability!, 0) / covered.length
      : null,
    covered: covered.length,
    total: days.length,
    forecast: covered.filter((d) => d.source === "pronóstico").length,
    seasonal: covered.filter((d) => d.source === "estacional").length,
    subseasonal: covered.filter((d) => d.source === "subestacional").length,
  };
}

// Climate-only potential: no access, routing, assignment or execution assumptions.
// Member families have equal weight. Missing observations never become bad weather.
export function climatePotential(
  plans: PivotPlan[],
  rules: Rules,
  ensembles: Record<string, EnsembleAssessment> = {},
  climates: Record<string, HistoricalClimate> = {},
  today = localDate(),
  now = Date.now(),
  seasonals: Record<string, SeasonalAssessment> = {},
) {
  const groups = new Map<string, PivotPlan[]>();
  for (const p of plans) {
    if (p.locationWarning || p.pivot.status === "TERMINADO") continue;
    const key = cellKey(p.pivot.lat, p.pivot.lon);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const signature = rulesSignature(rules);
  const zones: ClimateZone[] = [];
  for (const [key, group] of groups) {
    const climate =
      climates[key]?.rulesSignature === signature ? climates[key] : undefined;
    const candidate = ensembles[key];
    const age = candidate ? now - Date.parse(candidate.fetchedAt) : Infinity;
    const ensemble =
      candidate?.rulesSignature === signature && age >= 0 && age < 12 * 3600000
        ? candidate
        : undefined;
    const days: ClimateDay[] = [];
    const candidateSeasonal = seasonals[key];
    const seasonal =
      candidateSeasonal?.rulesSignature === signature &&
      now - Date.parse(candidateSeasonal.fetchedAt) >= 0 &&
      now - Date.parse(candidateSeasonal.fetchedAt) < 36 * 3600000
        ? candidateSeasonal
        : undefined;
    for (let date = today; date <= rules.deadline; date = addDays(date, 1)) {
      const families = new Map<string, number[]>();
      // Keep the low-level translator compatible with small research samples;
      // the planning report applies the publication minimum. Use well-covered
      // sources alone when at least two are available for this specific day.
      const eligible = usableMemberGroups(ensemble?.paths ?? [], [date]);
      const paths =
        eligible.length >= 2
          ? eligible.flatMap((g) => g.complete)
          : (ensemble?.paths ?? []);
      if (date > today && date <= addDays(today, 14))
        for (const path of paths) {
          const slots = path.days[date];
          if (slots === null || slots === undefined) continue;
          families.set(path.family, [
            ...(families.get(path.family) ?? []),
            slots,
          ]);
        }
      if (families.size) {
        const values = [...families.values()];
        days.push({
          date,
          source: "pronóstico",
          probability:
            values.reduce(
              (s, v) => s + v.filter((n) => n > 0).length / v.length,
              0,
            ) / values.length,
          slots:
            values.reduce(
              (s, v) => s + v.reduce((a, b) => a + b, 0) / v.length,
              0,
            ) / values.length,
        });
      } else if (date > today) {
        const prediction = seasonal?.days[date];
        days.push(
          prediction && prediction.probability !== null
            ? {
                date,
                source:
                  prediction.source === "EC46" ? "subestacional" : "estacional",
                probability: prediction.probability,
                slots: prediction.slots,
              }
            : { date, source: "sin datos", probability: null, slots: null },
        );
      }
    }
    const yearly = (climate?.years ?? []).flatMap((y) => {
      const values = days.map((d) => climate!.days[`${y}${d.date.slice(4)}`]);
      return values.length && values.every((v) => v !== null && v !== undefined)
        ? [values.filter((v) => v! > 0).length]
        : [];
    });
    zones.push({
      key,
      lat: climate?.lat ?? group[0].pivot.lat,
      lon: climate?.lon ?? group[0].pivot.lon,
      name: [
        ...new Set(
          group.map(
            (p) =>
              p.pivot.region ||
              p.pivot.field ||
              p.pivot.province ||
              `Zona ${key}`,
          ),
        ),
      ].join(" / "),
      pending: group.length,
      years: climate?.years ?? [],
      enso: climate?.enso,
      days,
      historicalRange:
        yearly.length >= 3 ? [Math.min(...yearly), Math.max(...yearly)] : null,
    });
  }
  return {
    start: addDays(today, 1),
    end: rules.deadline,
    zones,
    excluded: plans.filter(
      (p) => p.locationWarning && p.pivot.status !== "TERMINADO",
    ).length,
  };
}
