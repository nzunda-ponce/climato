import { addDays, localDate, PivotPlan, Rules } from "./types";
import {
  EnsembleAssessment,
  HistoricalClimate,
  cellKey,
  rulesSignature,
} from "./evidence";
export function simulateCampaign(
  plans: PivotPlan[],
  r: Rules,
  ensembles: Record<string, EnsembleAssessment>,
  climates: Record<string, HistoricalClimate>,
  runs = 1000,
  seed = 2026,
) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const today = localDate();
  const days = Math.max(
    0,
    Math.floor(
      (Date.parse(r.deadline + "T12:00Z") - Date.parse(today + "T12:00Z")) /
        86400000,
    ) + 1,
  );
  const pending = plans.filter((p) => p.pivot.status !== "TERMINADO");
  const groups = [
    ...new Set(
      pending
        .filter((p) => !p.locationWarning)
        .map((p) => cellKey(p.pivot.lat, p.pivot.lon)),
    ),
  ].map((key) => ({
    key,
    pivots: pending.filter(
      (p) => cellKey(p.pivot.lat, p.pivot.lon) === key && !p.locationWarning,
    ),
    ensemble:
      ensembles[key]?.rulesSignature === rulesSignature(r) &&
      Date.now() - Date.parse(ensembles[key].fetchedAt) < 12 * 3600000
        ? ensembles[key]
        : undefined,
    climate:
      climates[key]?.rulesSignature === rulesSignature(r)
        ? climates[key]
        : undefined,
  }));
  const validEnsembles = groups.filter((g) =>
    g.ensemble?.paths.some((p) =>
      Object.values(p.days).some((d) => d !== null),
    ),
  ).length;
  const validHistory = groups.filter((g) => g.climate).length;
  const families = [
    ...new Set(
      groups.flatMap(
        (g) =>
          g.ensemble?.sources
            .filter((s) => s.usableMembers > 0)
            .map((s) => s.family) ?? [],
      ),
    ),
  ];
  const prepared = new Map(
    groups.map((g) => [
      g.key,
      new Map(
        Array.from({ length: days }, (_, i) => {
          const date = addDays(today, i);
          const paths = g.ensemble?.paths ?? [];
          const access = g.pivots[0]?.days.find((d) => d.date === date)?.road;
          const roadProbability =
            access?.score === null || access?.score === undefined
              ? 0.5
              : access.score >= 75
                ? 0.15
                : access.score >= 40
                  ? 0.6
                  : 0.9;
          return [
            date,
            {
              paths: new Map(
                families.map((f) => [
                  f,
                  paths.filter(
                    (p) =>
                      p.family === f &&
                      p.days[date] !== undefined &&
                      p.days[date] !== null,
                  ),
                ]),
              ),
              roadProbability,
              priority:
                g.pivots.reduce(
                  (s, p) =>
                    s + (p.days.find((d) => d.date === date)?.priority ?? 30),
                  0,
                ) / Math.max(1, g.pivots.length),
            },
          ] as const;
        }),
      ),
    ]),
  );
  const outcomes: {
    completed: number;
    finish: string | null;
    effective: number;
  }[] = [];
  const weeklySamples: number[][] = Array.from(
    { length: Math.ceil(days / 7) },
    () => [],
  );
  const regionSuccess = new Map(groups.map((g) => [g.key, 0]));
  for (let run = 0; run < runs; run++) {
    const completed = new Set<string>();
    const familyQuantile = random();
    const family = families[Math.floor(familyQuantile * families.length)];
    const memberQuantile = random();
    const sampledYear = Math.floor(random() * 5);
    let effective = 0;
    const weeklyJobs = weeklySamples.map(() => 0);
    let finish: string | null = pending.length === 0 ? today : null;
    for (let dayIndex = 0; dayIndex < days; dayIndex++) {
      const date = addDays(today, dayIndex);
      const available = groups
        .map((g) => {
          let remaining = g.pivots.filter(
            (p) => !completed.has(p.pivot.id) && p.pivot.road !== "NO APTO",
          );
          const meta = prepared.get(g.key)!.get(date)!;
          let paths = meta.paths.get(family) ?? [];
          if (!paths.length) {
            const availableFamilies = [...meta.paths.values()].filter(
              (paths) => paths.length,
            );
            paths =
              availableFamilies[
                Math.floor(familyQuantile * availableFamilies.length)
              ] ?? [];
          }
          let slots: number;
          if (paths.length)
            slots =
              paths[
                Math.min(
                  paths.length - 1,
                  Math.floor(memberQuantile * paths.length),
                )
              ].days[date] ?? 0;
          else if (g.climate) {
            const year = g.climate.years[sampledYear % g.climate.years.length];
            const historical = g.climate.days[year + date.slice(4)];
            slots =
              historical ??
              (random() <
              (g.climate.monthly[date.slice(5, 7)]?.fraction ??
                r.historicalAvailability)
                ? r.jobsPerCrew
                : 0);
          } else {
            const d = g.pivots[0]?.days.find((d) => d.date === date);
            slots = d?.window
              ? random() < d.window.probability / 100
                ? Math.floor(d.window.hours / r.minHours)
                : 0
              : d?.coverage
                ? 0
                : random() < r.historicalAvailability
                  ? r.jobsPerCrew
                  : 0;
          }
          if (random() > meta.roadProbability) {
            remaining = remaining.filter((p) => p.pivot.road === "APTO");
            if (!remaining.length) slots = 0;
          }
          if (r.seasonalAdjustment < 1 && random() > r.seasonalAdjustment)
            slots = 0;
          const priority = meta.priority;
          return { key: g.key, pivots: remaining, slots, priority };
        })
        .filter((g) => g.slots > 0 && g.pivots.length)
        .sort((a, b) => b.priority - a.priority);
      let attempts = 0;
      for (let crew = 0; crew < r.crews; crew++) {
        const zone = available.find(
          (g) =>
            g.slots > 0 && g.pivots.some((p) => !completed.has(p.pivot.id)),
        );
        if (!zone) break;
        const count = Math.min(
          r.jobsPerCrew,
          zone.slots,
          zone.pivots.filter((p) => !completed.has(p.pivot.id)).length,
        );
        for (const p of zone.pivots
          .filter((p) => !completed.has(p.pivot.id))
          .slice(0, count))
          completed.add(p.pivot.id);
        // Slots are sequential jobs per crew; simultaneous crews can share the same weather window.
        attempts += count;
      }
      effective += attempts / (r.crews * r.jobsPerCrew);
      weeklyJobs[Math.floor(dayIndex / 7)] += attempts;
      if (completed.size >= pending.length && !finish) finish = date;
    }
    outcomes.push({ completed: completed.size, finish, effective });
    weeklyJobs.forEach((jobs, i) => weeklySamples[i].push(jobs));
    groups.forEach((g) => {
      if (g.pivots.every((p) => completed.has(p.pivot.id)))
        regionSuccess.set(g.key, regionSuccess.get(g.key)! + 1);
    });
  }
  const sorted = outcomes.map((o) => o.completed).sort((a, b) => a - b);
  const finishes = outcomes
    .filter((o) => o.finish)
    .map((o) => o.finish!)
    .sort();
  const success = outcomes.filter((o) => o.completed >= pending.length).length;
  const quantile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const enoughData =
    validEnsembles === groups.length &&
    validHistory === groups.length &&
    groups.length > 0;
  return {
    weeks: weeklySamples.map((values, i) => {
      const ordered = [...values].sort((a, b) => a - b);
      return {
        date: addDays(today, i * 7),
        jobs: +(values.reduce((s, v) => s + v, 0) / runs).toFixed(1),
        p10: ordered[Math.floor(runs * 0.1)] ?? 0,
        p90: ordered[Math.floor(runs * 0.9)] ?? 0,
      };
    }),
    regions: groups.map((g) => ({
      key: g.key,
      pending: g.pivots.length,
      completionProbability: Math.round(
        (regionSuccess.get(g.key)! / runs) * 100,
      ),
    })),
    runs,
    seed,
    probability:
      pending.length === 0 ? 100 : Math.round((success / runs) * 100),
    completedP10: quantile(0.1),
    completedP50: quantile(0.5),
    completedP90: quantile(0.9),
    finishP50:
      finishes.length >= runs * 0.5
        ? finishes[Math.max(0, Math.ceil(runs * 0.5) - 1)]
        : null,
    conditionalFinishMedian:
      finishes[Math.floor(finishes.length * 0.5)] ?? null,
    expectedEffectiveDays: +(
      outcomes.reduce((s, o) => s + o.effective, 0) / runs
    ).toFixed(1),
    coverage: {
      regions: groups.length,
      ensembles: validEnsembles,
      history: validHistory,
    },
    calibrated: false,
    enoughData,
    unresolvedLocations: pending.filter((p) => p.locationWarning).length,
    label: enoughData
      ? "Simulación condicionada a ensembles e históricos"
      : "Simulación con cobertura parcial y supuestos",
    assumptions: [
      "Miembro y familia compartidos entre regiones durante el horizonte ensemble.",
      "Año histórico compartido entre regiones para conservar secuencias y correlación espacial aproximada.",
      "Histórico IFS es referencia modelada; no reemplaza mediciones.",
      "Riesgo de acceso, capacidad, logística y disponibilidad fuera de cobertura siguen siendo supuestos.",
      "No interpreta lluvia histórica o pronóstico como observación de campo.",
    ],
  };
}
