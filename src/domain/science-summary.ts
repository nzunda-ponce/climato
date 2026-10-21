import type { PlanningZone } from "./planning-report";
import { availabilityCell } from "./availability-matrix";
export function scienceSummary(input: PlanningZone[], dates: string[]) {
  const zones = [
    ...new Map(input.map((z) => [z.locationKey ?? z.key, z])).values(),
  ];
  const expected = availabilityCell(zones, dates);
  const supported = zones.filter((z) => (z.science?.annual.length ?? 0) >= 10);
  const commonYears = supported.length
    ? supported[0]
        .science!.annual.map((a) => a.year)
        .filter((y) =>
          supported.every((z) => z.science!.annual.some((a) => a.year === y)),
        )
    : [];
  const annual = commonYears
    .sort((a, b) => a - b)
    .map((year) => {
      const samples = supported.map((z) =>
        z.science!.annual.find((a) => a.year === year)!,
      );
      return {
        year,
        days: samples.reduce((s, a) => s + a.days, 0) / samples.length,
        windows: samples.reduce((s, a) => s + a.windows, 0) / samples.length,
        longestRun:
          samples.reduce((s, a) => s + a.longestRun, 0) / samples.length,
      };
    });
  const interval = (field: "days" | "windows" | "longestRun") => {
    if (annual.length < 10) return null;
    const values = annual.map((a) => a[field]).sort((a, b) => a - b);
    return {
      mean: values.reduce((s, v) => s + v, 0) / values.length,
      low: values[Math.max(0, Math.ceil(0.1 * values.length) - 1)],
      high: values[Math.max(0, Math.ceil(0.9 * values.length) - 1)],
    };
  };
  const verified = zones.filter(
    (z) =>
      z.science?.validation.brier !== null &&
      z.science?.validation.brier !== undefined,
  );
  const count = verified.reduce((s, z) => s + z.science!.validation.count, 0);
  const brier = count
    ? verified.reduce(
        (s, z) =>
          s + z.science!.validation.brier! * z.science!.validation.count,
        0,
      ) / count
    : null;
  const baseline = count
    ? verified.reduce(
        (s, z) =>
          s +
          z.science!.validation.baselineBrier! * z.science!.validation.count,
        0,
      ) / count
    : null;
  const mae = zones.flatMap((z) =>
    z.science?.periodValidation.maeDays !== null &&
    z.science?.periodValidation.maeDays !== undefined
      ? [z.science.periodValidation.maeDays]
      : [],
  );
  const models = new Map<string, number>();
  for (const z of zones)
    if (z.science) {
      const m = z.science.model;
      const label =
        m.method === "weekly"
          ? `Referencia semanal · ${m.window} años`
          : m.method === "monthly"
            ? "Referencia mensual"
            : `${m.window} años · ${m.prior ? "suavizado" : "frecuencia directa"}`;
      models.set(label, (models.get(label) ?? 0) + 1);
    }
  return {
    locations: zones.length,
    expected,
    referenceLocations: supported.length,
    annual,
    days: interval("days"),
    windows: interval("windows"),
    longestRun: interval("longestRun"),
    count,
    brier,
    baseline,
    skill:
      brier !== null && baseline !== null && baseline > 0
        ? 1 - brier / baseline
        : null,
    verifiedLocations: verified.length,
    maeDays: mae.length ? mae.reduce((s, v) => s + v, 0) / mae.length : null,
    dailyLabels: zones.reduce((s, z) => s + (z.science?.dailyLabels ?? 0), 0),
    models: [...models].map(([name, locations]) => ({ name, locations })),
  };
}
