import type { PlanningZone } from "./planning-report";
import { availabilityCell } from "./availability-matrix";
import {
  historicalWeek,
  historicalWeeks,
  historicalWeekSample,
} from "./history-weeks";

export function historicalCurves(zones: PlanningZone[], dates: string[]) {
  const unique = [
    ...new Map(zones.map((z) => [z.locationKey ?? z.key, z])).values(),
  ];
  const weeks = historicalWeeks(dates).map((week) => ({
    ...week,
    ...historicalWeek(week.key),
  }));
  const locations = unique.flatMap((zone) => {
    const data = zone.science?.historicalDaily;
    if (!data) return [];
    return [
      { zone, data, indices: new Map(data.dates.map((date, i) => [date, i])) },
    ];
  });
  const years = [
    ...new Set(
      locations.flatMap((location) =>
        location.data.years.map((sample) => sample.year),
      ),
    ),
  ].sort((a, b) => a - b);
  const curves = years.map((year) => ({
    year,
    points: weeks.map((week) => {
      const samples = locations.flatMap(({ data, indices }) => {
        const sample = data.years.find((sample) => sample.year === year);
        if (!sample) return [];
        const values = week.dates.map((date) => {
          const index = indices.get(date);
          const value = index === undefined ? "?" : sample.values[index];
          return value === "1" ? 1 : value === "0" ? 0 : null;
        });
        const point = historicalWeekSample(values);
        return point ? [point] : [];
      });
      return {
        probability: samples.length
          ? samples.reduce((sum, s) => sum + s.probability, 0) / samples.length
          : null,
        locations: samples.length,
        covered: samples.reduce((sum, s) => sum + s.covered, 0),
        coveredApt: samples.reduce(
          (sum, s) => sum + Math.round(s.probability * s.covered),
          0,
        ),
        total: samples.length * week.dates.length,
      };
    }),
  }));
  const reference = weeks.map((week) => {
    const probabilities = locations.flatMap(({ zone }) => {
      const value = zone.science?.weeklyForecast?.[week.key]?.probability;
      return value == null ? [] : [value];
    });
    return {
      probability: probabilities.length
        ? probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length
        : null,
      locations: probabilities.length,
    };
  });
  // Keep the integrated estimate within the requested period, even when a
  // reference week includes earlier/later days to explain the historical model.
  const wanted = new Set(dates);
  const estimate = weeks.map((week) =>
    availabilityCell(
      unique,
      week.dates.filter((date) => wanted.has(date)),
    ),
  );
  return {
    weeks,
    curves,
    reference,
    estimate,
    locations: locations.length,
    totalLocations: unique.length,
  };
}
