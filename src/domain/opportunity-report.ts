import { climatePotential, ClimateDay } from "./climatic";
import {
  cellKey,
  EnsembleAssessment,
  HistoricalClimate,
  MemberPath,
  rulesSignature,
} from "./evidence";
import { SeasonalAssessment } from "./seasonal";
import {
  addDays,
  localDate,
  locationWarning,
  Pivot,
  PivotPlan,
  Rules,
  WeatherForecast,
} from "./types";
import { hourlyWindowDetail } from "./window-detail";

export interface ReportState {
  pivots: Pivot[];
  rules: Rules;
  forecasts: Record<string, WeatherForecast>;
  ensembles?: Record<string, EnsembleAssessment>;
  climate?: Record<string, HistoricalClimate>;
  seasonal?: Record<string, SeasonalAssessment>;
}
export const isFresh = (
  date: string | undefined,
  now: number,
  hours: number,
) => {
  const age = date ? now - Date.parse(date) : NaN;
  return Number.isFinite(age) && age >= 0 && age < hours * 3600000;
};
const validCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
export function reportDates(start: string, end: string) {
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return dates;
}

// Count whole trajectories: daily weather is correlated. Never simulate dates as
// independent coin flips or count neighboring equipment as extra work days.
export function scenarioDayCounts(
  paths: MemberPath[],
  dates: string[],
  reference?: string,
) {
  if (!dates.length) return null;
  const families = [...new Set(paths.map((p) => p.family))];
  if (families.length < 2) return null;
  const required = reference ? [reference, ...dates] : dates;
  const weighted: { count: number; weight: number; family: string }[] = [];
  let completeSamples = 0;
  for (const family of families) {
    const group = paths.filter((p) => p.family === family);
    const complete = group.filter((p) =>
      required.every((date) => validCount(p.days[date])),
    );
    // A distribution from a few surviving members would look more certain than it is.
    if (complete.length < 10 || complete.length / group.length < 0.8)
      return null;
    completeSamples += complete.length;
    for (const p of complete) {
      if (reference && p.days[reference]! <= 0) continue;
      weighted.push({
        count: dates.filter((date) => p.days[date]! > 0).length,
        weight: 1 / families.length / complete.length,
        family,
      });
    }
  }
  if (weighted.length < 10) return null;
  if (reference && new Set(weighted.map((p) => p.family)).size < 2) return null;
  const mass = weighted.reduce((s, p) => s + p.weight, 0);
  const ordered = [...weighted].sort((a, b) => a.count - b.count);
  const quantile = (q: number) => {
    let sum = 0;
    for (const p of ordered) {
      sum += p.weight / mass;
      if (sum + 1e-12 >= q) return p.count;
    }
    return ordered.at(-1)!.count;
  };
  return {
    expected: weighted.reduce((s, p) => s + p.count * p.weight, 0) / mass,
    range: [quantile(0.1), quantile(0.9)] as [number, number],
    noMoreDays:
      weighted.filter((p) => p.count === 0).reduce((s, p) => s + p.weight, 0) /
      mass,
    samples: weighted.length,
    families: families.length,
    supportingFamilies: new Set(weighted.map((p) => p.family)).size,
    completeSamples,
    availableSamples: paths.length,
  };
}

export function summarizeReportPeriod(
  days: ClimateDay[],
  start: string,
  end: string,
) {
  const dates = reportDates(start, end);
  const selected = dates.map((date) => days.find((d) => d.date === date));
  const covered = selected.filter(
    (d): d is ClimateDay =>
      !!d &&
      d.probability !== null &&
      Number.isFinite(d.probability) &&
      d.probability >= 0 &&
      d.probability <= 1,
  );
  const partialExpectedDays = covered.length
    ? covered.reduce((s, d) => s + d.probability!, 0)
    : null;
  return {
    start,
    end,
    total: dates.length,
    covered: covered.length,
    expectedDays:
      dates.length > 0 && covered.length === dates.length
        ? partialExpectedDays
        : null,
    partialExpectedDays,
    shortTermDays: covered.filter((d) => d.source === "pronóstico").length,
    subseasonalDays: covered.filter((d) => d.source === "subestacional").length,
    seasonalDays: covered.filter((d) => d.source === "estacional").length,
  };
}

export function buildOpportunityReport(state: ReportState, now = new Date()) {
  const today = localDate(now),
    timestamp = now.getTime(),
    start = addDays(today, 1);
  const deadline = state.rules.deadline;
  const end7 = deadline < addDays(today, 7) ? deadline : addDays(today, 7);
  const end14 = deadline < addDays(today, 14) ? deadline : addDays(today, 14);
  const plans: PivotPlan[] = state.pivots.map((pivot) => ({
    pivot,
    days: [],
    cluster: cellKey(pivot.lat, pivot.lon),
    nearby: 0,
    locationWarning: locationWarning(pivot),
  }));
  const climate = climatePotential(
    plans,
    state.rules,
    state.ensembles,
    state.climate,
    today,
    timestamp,
    state.seasonal,
  );
  const signature = rulesSignature(state.rules);
  const zones = climate.zones.map((zone) => {
    const equipment = plans
      .filter(
        (p) =>
          !p.locationWarning &&
          p.pivot.status !== "TERMINADO" &&
          cellKey(p.pivot.lat, p.pivot.lon) === zone.key,
      )
      .map((p) => p.pivot);
    const fields = [...new Set(equipment.map((p) => p.field).filter(Boolean))];
    const regions = [
      ...new Set(
        equipment.map((p) => p.region).filter((v): v is string => !!v),
      ),
    ];
    const provinces = [
      ...new Set(
        equipment.map((p) => p.province).filter((v): v is string => !!v),
      ),
    ];
    const name =
      regions.join(" / ") ||
      fields.join(" / ") ||
      provinces.join(" / ") ||
      `Zona ${zone.key}`;
    const candidate = state.ensembles?.[zone.key];
    const ensemble =
      candidate?.rulesSignature === signature &&
      isFresh(candidate.fetchedAt, timestamp, 12)
        ? candidate
        : undefined;
    const seasonal = state.seasonal?.[zone.key];
    const daily = zone.days
      .filter((d) => d.date <= end14)
      .map((day) => {
        const groups = new Map<string, { usable: number; total: number }>();
        for (const p of ensemble?.paths ?? []) {
          const g = groups.get(p.family) ?? { usable: 0, total: 0 };
          g.total++;
          if (validCount(p.days[day.date])) g.usable++;
          groups.set(p.family, g);
        }
        const usable = [...groups.values()].filter((g) => g.usable > 0);
        const supported =
          day.source === "pronóstico" &&
          usable.length >= 2 &&
          [...groups.values()].every(
            (g) => g.usable >= 10 && g.usable / g.total >= 0.8,
          );
        const near = day.date <= end7;
        const nextEnd = [addDays(day.date, 7), end14].sort()[0];
        const followingDays = reportDates(addDays(day.date, 1), nextEnd);
        const followingCovered = followingDays.every(
          (date) =>
            zone.days.find((d) => d.date === date)?.source === "pronóstico",
        );
        return {
          ...day,
          families: day.source === "pronóstico" ? usable.length : 0,
          members:
            day.source === "pronóstico"
              ? usable.reduce((s, g) => s + g.usable, 0)
              : (seasonal?.days[day.date]?.members ?? 0),
          supported,
          status:
            day.probability === null
              ? "missing"
              : !supported
                ? "limited"
                : near &&
                    day.probability * 100 >= state.rules.minimumProbability
                  ? "review"
                  : "watch",
          following:
            supported && followingCovered
              ? scenarioDayCounts(ensemble!.paths, followingDays, day.date)
              : null,
          followingEnd: nextEnd,
          followingTotal: followingDays.length,
        };
      });
    const nextOpportunity =
      daily
        .filter((d) => d.status === "review")
        .sort(
          (a, b) =>
            b.probability! - a.probability! || a.date.localeCompare(b.date),
        )[0] ?? null;
    const weekly = [];
    for (let d = start; d <= deadline; d = addDays(d, 7)) {
      const end = addDays(d, 6) < deadline ? addDays(d, 6) : deadline;
      weekly.push(summarizeReportPeriod(zone.days, d, end));
    }
    const next7 = summarizeReportPeriod(zone.days, start, end7);
    const next14 = summarizeReportPeriod(zone.days, start, end14);
    const distribution = (end: string) => {
      const dates = reportDates(start, end);
      return dates.every(
        (date) =>
          zone.days.find((d) => d.date === date)?.source === "pronóstico",
      )
        ? scenarioDayCounts(ensemble?.paths ?? [], dates)
        : null;
    };
    const todayWindows =
      today <= deadline
        ? equipment
            .map((p) => {
              const f = state.forecasts[p.id];
              if (!isFresh(f?.fetchedAt, timestamp, 12)) return null;
              const detail = hourlyWindowDetail(f, state.rules, today, now);
              return detail.window
                ? {
                    id: p.id,
                    name: p.name,
                    field: p.field,
                    road: p.road,
                    ...detail,
                  }
                : null;
            })
            .filter((w) => w !== null)
        : [];
    const warnings = [
      ...(candidate?.errors ?? []),
      ...(seasonal?.errors ?? []),
    ];
    if (candidate && !ensemble)
      warnings.push(
        "El ensemble venció o fue calculado con otras reglas; no se utiliza.",
      );
    if (daily.some((d) => d.source === "pronóstico" && !d.supported))
      warnings.push(
        "En algunas fechas faltan modelos o miembros: el porcentaje tiene respaldo limitado.",
      );
    return {
      key: zone.key,
      name,
      fields,
      regions,
      provinces,
      lat: zone.lat,
      lon: zone.lon,
      equipment: equipment.map(({ id, name, field, road, status }) => ({
        id,
        name,
        field,
        road,
        status,
      })),
      pending: equipment.length,
      next7: { ...next7, scenarios: distribution(end7) },
      next14: { ...next14, scenarios: distribution(end14) },
      remaining: summarizeReportPeriod(zone.days, start, deadline),
      daily,
      weekly,
      nextOpportunity,
      todayWindows,
      sources: {
        ensembleAt: candidate?.fetchedAt ?? null,
        ensembleFresh: !!ensemble,
        seasonalAt: seasonal?.fetchedAt ?? null,
        seasonalFresh:
          seasonal?.rulesSignature === signature &&
          isFresh(seasonal.fetchedAt, timestamp, 36),
        families: ensemble?.sources ?? [],
        historyYears: state.climate?.[zone.key]?.years.length ?? 0,
      },
      warnings: [...new Set(warnings)],
    };
  });
  zones.sort(
    (a, b) =>
      (b.nextOpportunity?.probability ?? -1) -
        (a.nextOpportunity?.probability ?? -1) || a.name.localeCompare(b.name),
  );
  return {
    computedAt: now.toISOString(),
    today,
    start,
    deadline,
    active: today <= deadline,
    rules: state.rules,
    excluded: climate.excluded,
    zones,
    summary: {
      zones: zones.length,
      pending: zones.reduce((s, z) => s + z.pending, 0),
      toReview: zones.filter((z) => z.nextOpportunity).length,
      covered7: zones.filter(
        (z) => z.next7.total > 0 && z.next7.covered === z.next7.total,
      ).length,
    },
  };
}
export type OpportunityReport = ReturnType<typeof buildOpportunityReport>;
export type ReportZone = OpportunityReport["zones"][number];
