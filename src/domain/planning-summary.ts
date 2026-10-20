import type { PlanningZone } from "./planning-report";

export function locationDayEstimate(
  zone: Pick<PlanningZone, "daily">,
  dates: string[],
) {
  const days = dates.flatMap((date) =>
    zone.daily.filter(
      (d) => d.date === date && d.supported && d.probability !== null,
    ),
  );
  return {
    expected: days.length ? days.reduce((s, d) => s + d.probability!, 0) : null,
    covered: days.length,
    total: dates.length,
  };
}
// Expected fraction of selected locations with an apt day. This is NOT the
// probability of at least one location being apt, nor the forecast for a
// missing location. The denominator is exposed for every day.
export function globalDailyEstimates(
  zones: Pick<PlanningZone, "daily">[],
  dates: string[],
) {
  return dates.map((date) => {
    const values = zones.flatMap((z) => {
      const d = z.daily.find((d) => d.date === date);
      return d?.supported && d.probability !== null ? [d.probability] : [];
    });
    return {
      date,
      probability: values.length
        ? values.reduce((s, p) => s + p, 0) / values.length
        : null,
      covered: values.length,
      historical: zones.filter((z) =>
        z.daily.some(
          (d) =>
            d.date === date &&
            d.source === "histórico" &&
            d.probability !== null,
        ),
      ).length,
      total: zones.length,
    };
  });
}
export function missingForecastLabel(zone: Pick<PlanningZone, "dataStatus">) {
  return zone.dataStatus === "loading"
    ? "Cargando pronóstico"
    : zone.dataStatus === "failed"
      ? "Descarga fallida"
      : zone.dataStatus === "outdated"
        ? "Actualizando pronóstico"
        : "Pronóstico incompleto";
}

export function globalWeeklyEstimates(zones: Pick<PlanningZone, "weekly">[]) {
  return (zones[0]?.weekly ?? []).map((week, index) => {
    const rows = zones.map((z) => z.weekly[index]).filter(Boolean);
    const available = rows.filter((w) => w.partialExpectedDays !== null);
    return {
      start: week.start,
      end: week.end,
      total: zones.length,
      covered: available.length,
      expected: available.length
        ? available.reduce((s, w) => s + w.partialExpectedDays!, 0) /
          available.length
        : null,
      complete:
        available.length > 0 && available.every((w) => w.covered === w.total),
      historical: available.reduce((s, w) => s + w.historicalDays, 0),
      forecast: available.reduce(
        (s, w) => s + w.shortTermDays + w.subseasonalDays + w.seasonalDays,
        0,
      ),
    };
  });
}
