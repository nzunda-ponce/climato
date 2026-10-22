import type { PlanningZone } from "./planning-report";
import { availabilityCell } from "./availability-matrix";

export function strictCumulative(values: (number | null)[]) {
  let sum = 0,
    missing = false;
  return values.map((value) => {
    if (value === null) missing = true;
    if (missing) return null;
    sum += value!;
    return sum;
  });
}

export function historyComparison(items: PlanningZone[], dates: string[]) {
  const unique = [
    ...new Map(
      items.map((item) => [item.locationKey ?? item.key, item]),
    ).values(),
  ];
  const locations = unique.flatMap((zone) =>
    zone.science?.historicalDaily
      ? [
          {
            data: zone.science.historicalDaily,
            indices: new Map(
              zone.science.historicalDaily.dates.map((date, i) => [date, i]),
            ),
          },
        ]
      : [],
  );
  const years = [
    ...new Set(
      locations.flatMap((location) =>
        location.data.years.map((sample) => sample.year),
      ),
    ),
  ].sort((a, b) => a - b);
  const curves = years.map((year) => {
    // A fixed per-year cohort prevents changing location coverage from creating
    // artificial cumulative trends. No partial year is extrapolated.
    const complete = locations.flatMap(({ data, indices }) => {
      const sample = data.years.find((sample) => sample.year === year);
      if (!sample) return [];
      const values = dates.map((date) => {
        const i = indices.get(date);
        return i === undefined ? "?" : sample.values[i];
      });
      return values.every((value) => value === "0" || value === "1")
        ? [values.map(Number)]
        : [];
    });
    const daily = dates.map((_, i) =>
      complete.length
        ? complete.reduce((sum, row) => sum + row[i], 0) / complete.length
        : null,
    );
    return {
      year,
      locations: complete.length,
      daily,
      cumulative: strictCumulative(daily),
    };
  });
  const estimate = dates.map((date) => {
    const cell = availabilityCell(unique, [date]);
    return cell.complete ? cell.probability : null;
  });
  const reference = dates.map((_, i) => {
    const values = curves.flatMap((curve) =>
      curve.daily[i] === null ? [] : [curve.daily[i]!],
    );
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  });
  return {
    curves,
    estimate,
    reference,
    cumulative: strictCumulative(estimate),
    referenceCumulative: strictCumulative(reference),
    locations: unique.length,
    dates,
  };
}
