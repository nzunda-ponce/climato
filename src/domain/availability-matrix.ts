import type { PlanningZone } from "./planning-report";
import { equipmentZoneNames } from "./work-zones";
export const availabilityRegion = (
  z: Pick<PlanningZone, "regions" | "provinces" | "fields"> & {
    equipment?: { name: string }[];
  },
) =>
  (z.equipment?.length
    ? equipmentZoneNames(z.equipment).join(" / ")
    : z.regions.join(" / ") ||
      z.provinces.join(" / ") ||
      z.fields.join(" / ") ||
      "Sin zona asignada"
  ).replace(/\bOESTE\b/g, "Oeste");
export interface AvailabilityCell {
  expected: number | null;
  probability: number | null;
  covered: number;
  total: number;
  locations: number;
  availableLocations: number;
  complete: boolean;
  sources: Record<string, number>;
}
type OutlookLocation = Pick<PlanningZone, "outlook"> & {
  locationKey?: string;
  key?: string;
};
function uniqueLocations<T extends { locationKey?: string; key?: string }>(
  zones: T[],
) {
  const seen = new Set<string>();
  return zones.filter((z) => {
    const key = z.locationKey ?? z.key;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// Average per unique equipment coordinate, never multiplied by equipment count.
// Unknown days are excluded and coverage remains explicit; no zero imputation.
export function availabilityCell(
  zones: OutlookLocation[],
  dates: string[],
): AvailabilityCell {
  zones = uniqueLocations(zones);
  const wanted = new Set(dates),
    sources: Record<string, number> = {};
  let sum = 0,
    covered = 0,
    locations = 0;
  for (const z of zones) {
    let usable = 0;
    for (const d of z.outlook) {
      if (!wanted.has(d.date) || d.probability === null) continue;
      sum += d.probability;
      covered++;
      usable++;
      sources[d.source] = (sources[d.source] ?? 0) + 1;
    }
    if (usable) locations++;
  }
  const total = zones.length * dates.length;
  return {
    expected: locations ? sum / locations : null,
    probability: covered ? sum / covered : null,
    covered,
    total,
    locations: zones.length,
    availableLocations: locations,
    complete: total > 0 && covered === total,
    sources,
  };
}
export function availabilityGroups(zones: PlanningZone[]) {
  const groups = new Map<string, PlanningZone[]>();
  for (const z of zones) {
    const name = availabilityRegion(z);
    groups.set(name, [...(groups.get(name) ?? []), z]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "es"));
}
export function availabilityColor(probability: number | null) {
  if (probability === null)
    return { backgroundColor: "#f1f3f3", color: "#697776" };
  const palette = [
    [246, 245, 237],
    [225, 233, 214],
    [179, 210, 183],
    [99, 163, 135],
    [25, 99, 77],
  ];
  const value = Math.max(0, Math.min(1, probability)) * 4,
    index = Math.min(3, Math.floor(value)),
    weight = value - index;
  const rgb = palette[index].map((v, i) =>
    Math.round(v + (palette[index + 1][i] - v) * weight),
  );
  const luminance = (color: number[]) =>
    color
      .map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const bg = luminance(rgb),
    dark = luminance([0, 0, 0]);
  return {
    backgroundColor: `rgb(${rgb.join(", ")})`,
    color:
      1.05 / (bg + 0.05) > (bg + 0.05) / (dark + 0.05) ? "#ffffff" : "#000000",
  };
}
export function availabilityBacking(cell: AvailabilityCell) {
  const sources = Object.keys(cell.sources);
  return !sources.length
    ? "Sin datos"
    : sources.length > 1
      ? "Mixto"
      : sources[0] === "histórico"
        ? "Historia"
        : sources[0] === "pronóstico"
          ? "Pronóstico"
          : "Proyección";
}
// Rank only actual forecast days. Historical frequency cannot announce a date.
export function bestForecastDay(zones: PlanningZone[], dates: string[]) {
  zones = uniqueLocations(zones);
  return dates
    .map((date) => {
      const covered = zones.filter((z) =>
        z.outlook.some(
          (d) =>
            d.date === date &&
            d.source === "pronóstico" &&
            d.probability !== null,
        ),
      );
      return {
        date,
        locations: covered.length,
        total: zones.length,
        cell: availabilityCell(covered, [date]),
      };
    })
    .filter((d) => d.locations > 0)
    .sort(
      (a, b) =>
        b.locations - a.locations ||
        b.cell.probability! - a.cell.probability! ||
        a.date.localeCompare(b.date),
    )[0];
}
