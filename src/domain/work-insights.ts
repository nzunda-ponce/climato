import type { PlanningZone } from "./planning-report";
import { availabilityRegion } from "./availability-matrix";

export type WorkInsightLocation = Pick<
  PlanningZone,
  "key" | "locationKey" | "regions" | "provinces" | "fields"
> & {
  equipment: { name: string }[];
  outlook: Pick<
    PlanningZone["outlook"][number],
    "date" | "probability" | "source"
  >[];
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
export function workInsights(
  items: WorkInsightLocation[],
  dates: string[],
  threshold: number,
) {
  const unique = [
    ...new Map(
      items.map((item) => [item.locationKey ?? item.key, item]),
    ).values(),
  ];
  const indexed = unique.map((item) => ({
    item,
    days: new Map(item.outlook.map((day) => [day.date, day])),
  }));
  const daily = dates.map((date) => {
    const points = indexed.flatMap(({ item, days }) => {
      const day = days.get(date);
      const probability = day?.probability;
      return probability != null &&
        Number.isFinite(probability) &&
        probability >= 0 &&
        probability <= 1
        ? [{ key: item.key, probability, source: day!.source }]
        : [];
    });
    const complete = points.length > 0 && points.length === unique.length;
    return {
      date,
      probability: complete ? mean(points.map((p) => p.probability)) : null,
      qualifying: complete
        ? points.filter((p) => p.probability >= threshold).length
        : null,
      bestKey: [...points].sort((a, b) => b.probability - a.probability)[0]
        ?.key,
      historical: points.some((point) => point.source === "histórico"),
    };
  });
  let cumulative: number | null = 0;
  const curve = daily.map((day) => {
    cumulative =
      cumulative !== null && day.probability !== null
        ? cumulative + day.probability
        : null;
    return { date: day.date, expected: cumulative };
  });
  const windows = daily
    .flatMap((_, index) => {
      const slice = daily.slice(index, index + 7);
      return slice.length === 7 &&
        slice.every((day) => day.probability !== null)
        ? [
            {
              start: slice[0].date,
              end: slice[6].date,
              expected: slice.reduce((sum, day) => sum + day.probability!, 0),
              historical: slice.some((day) => day.historical),
            },
          ]
        : [];
    })
    .sort((a, b) => b.expected - a.expected || a.start.localeCompare(b.start));
  const groups = new Map<string, WorkInsightLocation[]>();
  for (const item of items) {
    const name = availabilityRegion(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  const ranking = [...groups]
    .flatMap(([name, group]) => {
      const locations = [
        ...new Map(
          group.map((item) => [item.locationKey ?? item.key, item]),
        ).values(),
      ];
      const totals = locations.flatMap((location) => {
        const outlook = new Map(
          location.outlook.map((day) => [day.date, day.probability]),
        );
        const values = dates.map((date) => outlook.get(date));
        return dates.length &&
          values.every(
            (p) => p != null && Number.isFinite(p) && p >= 0 && p <= 1,
          )
          ? [values.reduce<number>((sum, p) => sum + p!, 0)]
          : [];
      });
      return totals.length === locations.length && totals.length
        ? [{ name, expected: mean(totals), key: group[0].key }]
        : [];
    })
    .sort((a, b) => b.expected - a.expected || a.name.localeCompare(b.name));
  return {
    daily,
    curve,
    ranking,
    bestWindow: windows[0],
    bestDay: [...daily]
      .filter((day) => day.qualifying !== null)
      .sort(
        (a, b) =>
          b.qualifying! - a.qualifying! ||
          (b.probability ?? 0) - (a.probability ?? 0),
      )[0],
    favorable: daily.some((day) => day.probability !== null)
      ? daily.filter(
          (day) => day.probability !== null && day.probability >= threshold,
        ).length
      : null,
    incomplete: daily.some((day) => day.probability === null),
  };
}
