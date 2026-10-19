import {
  addDays,
  defaultRules,
  localDate,
  DayDecision,
  Pivot,
  PivotPlan,
  Rules,
  WeatherForecast,
  locationWarning,
} from "./types";
import { calculateOperationalWindows, roadAccessRiskScore } from "./windows";
import {
  EnsembleAssessment,
  HistoricalClimate,
  cellKey,
  rulesSignature,
} from "./evidence";
export function distance(a: Pivot, b: Pivot) {
  const rad = Math.PI / 180;
  const dlat = (b.lat - a.lat) * rad,
    dlon = (b.lon - a.lon) * rad;
  const x =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function clusters(pivots: Pivot[], km: number) {
  const groups: Pivot[][] = [];
  const remaining = new Set(pivots);
  while (remaining.size) {
    const group = [remaining.values().next().value!];
    remaining.delete(group[0]);
    for (let i = 0; i < group.length; i++)
      for (const p of remaining)
        if (distance(group[i], p) <= km) {
          group.push(p);
          remaining.delete(p);
        }
    groups.push(group);
  }
  return groups;
}
export function buildPlans(
  pivots: Pivot[],
  forecasts: Record<string, WeatherForecast>,
  rules: Rules = defaultRules,
  ensembles: Record<string, EnsembleAssessment> = {},
  climate: Record<string, HistoricalClimate> = {},
): PivotPlan[] {
  const today = localDate();
  const groups = clusters(pivots, rules.clusterKm);
  return pivots.map((pivot) => {
    const warning = locationWarning(pivot);
    const f = forecasts[pivot.id];
    const assessment = ensembles[cellKey(pivot.lat, pivot.lon)];
    const historical = climate[cellKey(pivot.lat, pivot.lon)];
    const historicalUsable =
      historical?.rulesSignature === rulesSignature(rules)
        ? historical
        : undefined;
    const ensemble =
      assessment?.rulesSignature === rulesSignature(rules) &&
      Date.now() - Date.parse(assessment.fetchedAt) < 12 * 3600000
        ? assessment
        : undefined;
    const deterministicWindows =
      f && !warning ? calculateOperationalWindows(f, rules) : [];
    const windows =
      ensemble && !warning
        ? [
            ...ensemble.windows,
            ...deterministicWindows.filter(
              (w) =>
                !ensemble.paths.some(
                  (p) =>
                    p.days[w.start.slice(0, 10)] !== undefined &&
                    p.days[w.start.slice(0, 10)] !== null,
                ),
            ),
          ]
        : deterministicWindows;
    const group = groups.find((g) => g.includes(pivot))!;
    const nearby = group.filter((p) => p.status !== "TERMINADO").length;
    const days = Array.from({ length: rules.horizon }, (_, i) => {
      const date = addDays(today, i);
      const median = (values: number[]) =>
        values.length
          ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
          : null;
      const weather = {
        wind: median(
          f?.models.flatMap((m) => {
            const h = m.hours.filter(
              (h) => h.time.startsWith(date) && h.wind !== null,
            );
            return h.length ? [Math.max(...h.map((h) => h.wind!))] : [];
          }) ?? [],
        ),
        gust: median(
          f?.models.flatMap((m) => {
            const h = m.hours.filter(
              (h) => h.time.startsWith(date) && h.gust !== null,
            );
            return h.length ? [Math.max(...h.map((h) => h.gust!))] : [];
          }) ?? [],
        ),
        rain: median(
          f?.models.flatMap((m) => {
            const h = m.hours.filter(
              (h) => h.time.startsWith(date) && h.rain !== null,
            );
            return h.length === 24 ? [h.reduce((s, h) => s + h.rain!, 0)] : [];
          }) ?? [],
        ),
      };
      const window = windows.find((w) => w.start.startsWith(date)) ?? null;
      const road = roadAccessRiskScore(f, pivot, date, rules);
      const futureWindows = windows.filter(
        (w) => w.start.slice(0, 10) > date && w.probability >= 50,
      ).length;
      const ensembleCoverage =
        ensemble?.paths.filter(
          (p) => p.days[date] !== undefined && p.days[date] !== null,
        ).length ?? 0;
      const coverage =
        ensembleCoverage ||
        (f?.models.filter((m) =>
          m.hours.some(
            (h) =>
              h.time.startsWith(date) && h.wind !== null && h.rain !== null,
          ),
        ).length ??
          0);
      const condition: DayDecision["condition"] = warning
        ? "DESCONOCIDO"
        : road.condition === "NO APTO"
          ? "NO APTO"
          : !coverage
            ? "DESCONOCIDO"
            : !window || window.probability < rules.minimumProbability
              ? "NO APTO"
              : window.probability >= 75 &&
                  window.confidence >= 45 &&
                  road.condition === "APTO"
                ? "APTO"
                : "RIESGO";
      const urgency =
        1 +
        1 /
          Math.max(
            1,
            (new Date(rules.deadline).getTime() - new Date(date).getTime()) /
              86400000 /
              14,
          );
      const opportunity = window
        ? Math.min(
            100,
            Math.round(
              (window.probability / (1 + futureWindows / 3)) *
                urgency *
                Math.min(
                  1.8,
                  Math.max(
                    0.6,
                    0.4 /
                      (historicalUsable?.monthly[date.slice(5, 7)]?.fraction ??
                        0.4),
                  ),
                ),
            ),
          )
        : 0;
      const priority =
        pivot.status === "TERMINADO" ||
        condition === "NO APTO" ||
        condition === "DESCONOCIDO"
          ? 0
          : Math.round(
              Math.min(
                100,
                opportunity * 0.55 +
                  (window?.confidence ?? 0) * 0.2 +
                  Math.min(15, nearby * 3) +
                  (road.condition === "APTO" ? 10 : 0),
              ),
            );
      const explanation =
        warning ||
        (!coverage
          ? "Sin datos horarios disponibles para esta fecha."
          : !window
            ? "No hay un intervalo continuo que cumpla las reglas."
            : road.condition === "NO APTO"
              ? "Acceso no apto: no asignar una cuadrilla."
              : `${window.start.slice(11, 16)}–${window.end.slice(11, 16)} · ${window.members} ${window.basis === "ensemble" ? "miembros ensemble · " + window.families + " familias equiponderadas" : "modelos determinísticos"}; ${futureWindows} ventanas posteriores en el horizonte. ${nearby} pendientes en el grupo. ${road.condition === "DESCONOCIDO" ? "Confirmar acceso con el encargado." : road.manual ? "Acceso informado por Territory Leader." : "Acceso estimado con lluvia y suelo."}`);
      return {
        weather,
        date,
        window,
        road,
        condition,
        priority,
        opportunity,
        futureWindows,
        explanation,
        coverage,
      };
    });
    return {
      locationWarning: warning,
      pivot,
      cluster: `${group[0].province || group[0].region || "Zona"} · ${groups.indexOf(group) + 1}`,
      nearby,
      days,
      error: f?.errors.join(" · "),
    };
  });
}
export function projectCampaign(plans: PivotPlan[], r: Rules) {
  const today = localDate();
  const remaining = Math.max(
    0,
    Math.floor(
      (new Date(r.deadline + "T12:00:00Z").getTime() -
        new Date(today + "T12:00:00Z").getTime()) /
        86400000,
    ) + 1,
  );
  const pending = plans.filter((p) => p.pivot.status !== "TERMINADO").length;
  const capacity = r.crews * r.jobsPerCrew;
  const required = Math.ceil(pending / capacity);
  const known = Array.from(
    { length: Math.min(remaining, r.horizon) },
    (_, i) => {
      const date = addDays(today, i);
      const eligible = plans
        .filter((p) => p.pivot.status !== "TERMINADO")
        .map((p) => ({
          id: p.pivot.id,
          day: p.days.find((d) => d.date === date),
        }))
        .filter((p) => p.day?.window && p.day.road.condition !== "NO APTO")
        .sort((a, b) => (b.day?.priority ?? 0) - (a.day?.priority ?? 0));
      return {
        date,
        eligible,
        known: plans.some((p) =>
          p.days.some((d) => d.date === date && d.coverage > 0),
        ),
      };
    },
  );
  const hasWeather = known.some((d) => d.known);
  const availability = Math.max(
    0,
    Math.min(1, r.historicalAvailability * r.seasonalAdjustment),
  );
  const scenarios = [
    { name: "Optimista", factor: 1.3 },
    { name: "Base", factor: 1 },
    { name: "Pesimista", factor: 0.65 },
  ].map((s) => {
    let total = 0;
    let finish: string | null = pending === 0 ? today : null;
    let effective = 0;
    const residual = new Map(
      plans
        .filter((p) => p.pivot.status !== "TERMINADO")
        .map((p) => [p.pivot.id, 1]),
    );
    for (let i = 0; i < remaining; i++) {
      const k = known[i];
      let adjusted = 0;
      if (k?.known) {
        // Each daily slot is attempted once. A single pivot contributes at most one
        // completed job over the forecast horizon, even across repeated windows.
        for (const item of k.eligible
          .filter((p) => (residual.get(p.id) ?? 0) > 0.001)
          .slice(0, capacity)) {
          const d = item.day!;
          const roadFactor =
            d.road.condition === "DESCONOCIDO"
              ? 0.5
              : d.road.condition === "RIESGO"
                ? 0.7
                : 1;
          const credit = Math.min(
            residual.get(item.id) ?? 0,
            Math.min(1, (d.window!.probability / 100) * roadFactor * s.factor),
          );
          residual.set(item.id, (residual.get(item.id) ?? 0) - credit);
          adjusted += credit;
        }
      } else adjusted = Math.min(capacity, capacity * availability * s.factor);
      effective += adjusted / capacity;
      total += adjusted;
      if (total >= pending && !finish) finish = addDays(today, i);
    }
    return {
      name: s.name,
      effective: Math.round(effective * 10) / 10,
      capacity: Math.floor(total),
      finish,
    };
  });
  const base = scenarios[1];
  const status =
    pending === 0
      ? "EN TIEMPO"
      : !hasWeather
        ? "SIN DATOS"
        : base.capacity < pending
          ? scenarios[0].capacity < pending
            ? "CRÍTICO"
            : "EN RIESGO"
          : "EN TIEMPO";
  // Weighted scenario indicator, deliberately not a calibrated meteorological probability.
  const probability = hasWeather
    ? scenarios.reduce(
        (s, v, i) => s + (v.capacity >= pending ? [20, 60, 20][i] : 0),
        0,
      )
    : null;
  const weeks = Array.from({ length: Math.ceil(remaining / 7) }, (_, i) => ({
    date: addDays(today, i * 7),
    days: Math.min(7, remaining - i * 7),
    jobs: Math.round(Math.min(7, remaining - i * 7) * capacity * availability),
  }));
  return {
    total: plans.length,
    pending,
    completed: plans.length - pending,
    remaining,
    capacity,
    required,
    scenarios,
    status,
    probability,
    weeks,
    hasWeather,
    requiredCapacity: base.effective
      ? +(pending / base.effective).toFixed(1)
      : null,
  };
}

export function recommendCrewAssignments(
  plans: PivotPlan[],
  date: string,
  r: Rules,
) {
  const used = new Set<string>();
  return Array.from({ length: r.crews }, (_, index) => {
    const crew = index + 1;
    const booked = plans.filter(
      (p) =>
        p.pivot.status === "PROGRAMADO" &&
        p.pivot.scheduledDate === date &&
        p.pivot.crew === crew,
    );
    booked.forEach((p) => used.add(p.pivot.id));
    const eligible = plans.filter(
      (p) =>
        !used.has(p.pivot.id) &&
        p.pivot.status === "PENDIENTE" &&
        (p.days.find((d) => d.date === date)?.priority ?? 0) > 0,
    );
    const zones = [...new Set(eligible.map((p) => p.cluster))]
      .map((cluster) => ({
        cluster,
        plans: eligible
          .filter((p) => p.cluster === cluster)
          .sort(
            (a, b) =>
              (b.days.find((d) => d.date === date)?.priority ?? 0) -
              (a.days.find((d) => d.date === date)?.priority ?? 0),
          ),
      }))
      .sort(
        (a, b) =>
          b.plans
            .slice(0, r.jobsPerCrew)
            .reduce(
              (s, p) =>
                s + (p.days.find((d) => d.date === date)?.priority ?? 0),
              0,
            ) -
          a.plans
            .slice(0, r.jobsPerCrew)
            .reduce(
              (s, p) =>
                s + (p.days.find((d) => d.date === date)?.priority ?? 0),
              0,
            ),
      );
    const cluster = booked[0]?.cluster ?? zones[0]?.cluster;
    const jobs = [
      ...booked,
      ...eligible
        .filter((p) => p.cluster === cluster)
        .sort(
          (a, b) =>
            (b.days.find((d) => d.date === date)?.priority ?? 0) -
            (a.days.find((d) => d.date === date)?.priority ?? 0),
        )
        .slice(0, Math.max(0, r.jobsPerCrew - booked.length)),
    ];
    jobs.forEach((p) => used.add(p.pivot.id));
    return {
      crew,
      cluster,
      jobs,
      needsAccessCheck: jobs.some(
        (p) => p.days.find((d) => d.date === date)?.road.condition !== "APTO",
      ),
      hasBlockedBooking: booked.some((p) =>
        ["NO APTO", "DESCONOCIDO"].includes(
          p.days.find((d) => d.date === date)?.condition ?? "DESCONOCIDO",
        ),
      ),
    };
  });
}
