import { calendarWeekStart } from "./history-weeks";
import type { PlanningZone } from "./planning-report";
import { availabilityCell } from "./availability-matrix";

export const estimateSources = [
  "pronóstico",
  "subestacional",
  "estacional",
  "histórico",
] as const;
export type EstimateSource = (typeof estimateSources)[number];

// Keep source contributions on the same denominator as the displayed estimate.
// A shared coordinate contributes once, even if equipment is split across zones.
export function estimateEvidence(zones: PlanningZone[], dates: string[]) {
  const seen = new Set<string>();
  const unique = zones.filter((z) => {
    const key = z.locationKey ?? z.key;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const wanted = new Set(dates);
  const summary = availabilityCell(unique, dates);
  const sources = estimateSources.map((source) => {
    let sum = 0,
      count = 0;
    for (const zone of unique)
      for (const day of zone.outlook) {
        if (
          wanted.has(day.date) &&
          day.source === source &&
          day.probability !== null
        ) {
          sum += day.probability;
          count++;
        }
      }
    return {
      source,
      count,
      contribution: summary.availableLocations
        ? sum / summary.availableLocations
        : null,
    };
  });
  return {
    ...summary,
    sourceBreakdown: sources,
    missing: summary.total - summary.covered,
  };
}

export function estimateTimeline(
  zones: PlanningZone[],
  dates: string[],
  step = 1,
) {
  if (step === 7) {
    const weeks = new Map<string, string[]>();
    for (const date of dates) {
      const key = calendarWeekStart(date);
      const days = weeks.get(key) ?? [];
      days.push(date);
      weeks.set(key, days);
    }
    return [...weeks.values()].map((days) => ({
      start: days[0],
      end: days.at(-1)!,
      days,
      ...estimateEvidence(zones, days),
    }));
  }
  const rows = [];
  for (let i = 0; i < dates.length; i += step) {
    const days = dates.slice(i, i + step);
    rows.push({
      start: days[0],
      end: days.at(-1)!,
      days,
      ...estimateEvidence(zones, days),
    });
  }
  return rows;
}

export function estimateMonths(zones: PlanningZone[], dates: string[]) {
  const months = new Map<string, string[]>();
  for (const day of dates) {
    const key = day.slice(0, 7);
    const days = months.get(key) ?? [];
    days.push(day);
    months.set(key, days);
  }
  return [...months].map(([month, days]) => ({
    month,
    days,
    ...estimateEvidence(zones, days),
  }));
}
