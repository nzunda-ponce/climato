import type { HistoricalClimate } from "./evidence";
import { createHash } from "node:crypto";

export type HistoryCandidate = {
  window: number;
  prior: number;
  method?: "monthly";
};
type Scores = {
  count: number;
  years: number;
  brier: number | null;
  baselineBrier: number | null;
  skill: number | null;
};
const valid = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const mean = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
const quantile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * p) - 1)
  ];
const cache = new WeakMap<
  HistoricalClimate,
  { stamp: string; byYear: Map<number, ReturnType<typeof fit>> }
>();
const fittedCache = new Map<string, ReturnType<typeof fit>>();
function dataset(history: HistoricalClimate, before: number) {
  const years = [...new Set(history.years)]
    .filter((y) => y < before)
    .sort((a, b) => a - b);
  const rows = new Map(years.map((y) => [y, {} as Record<string, number>]));
  for (const [date, value] of Object.entries(history.days)) {
    if (valid(value)) {
      const row = rows.get(Number(date.slice(0, 4)));
      if (row) row[date.slice(4)] = value;
    }
  }
  return {
    years: years.filter((y) => Object.keys(rows.get(y)!).length > 0),
    rows,
  };
}
function prediction(
  rows: Map<number, Record<string, number>>,
  years: number[],
  monthDay: string,
  model: HistoryCandidate,
) {
  if (model.method === "monthly") {
    const available = years
      .slice(-model.window)
      .filter((y) =>
        Object.keys(rows.get(y) ?? {}).some(
          (md) => md.slice(0, 3) === monthDay.slice(0, 3),
        ),
      );
    if (available.length < 10) return null;
    const values = available.flatMap((y) =>
      Object.entries(rows.get(y) ?? {})
        .filter(([md]) => md.slice(0, 3) === monthDay.slice(0, 3))
        .map(([, value]) => (value > 0 ? 1 : 0)),
    );
    return mean(values);
  }
  const values = years
    .slice(-model.window)
    .map((y) => rows.get(y)?.[monthDay])
    .filter(valid);
  return values.length >= 10
    ? (values.filter((v) => v > 0).length + model.prior) /
        (values.length + 2 * model.prior)
    : null;
}
function score(
  data: ReturnType<typeof dataset>,
  targets: number[],
  model: HistoryCandidate,
): Scores {
  let loss = 0,
    baselineLoss = 0,
    count = 0;
  const used = new Set<number>();
  for (const year of targets) {
    const train = data.years.filter((y) => y < year);
    const months = new Map<string, number[]>();
    for (const y of train.slice(-45))
      for (const [md, value] of Object.entries(data.rows.get(y)!)) {
        const month = md.slice(0, 3);
        const values = months.get(month) ?? [];
        values.push(value > 0 ? 1 : 0);
        months.set(month, values);
      }
    for (const [md, value] of Object.entries(data.rows.get(year) ?? {})) {
      // Compare every candidate on the same observed dates, including dates
      // where the smallest (ten-year) training window is complete.
      if (
        train.slice(-10).length < 10 ||
        !train.slice(-10).every((y) => valid(data.rows.get(y)?.[md]))
      )
        continue;
      const base = mean(months.get(md.slice(0, 3)) ?? []),
        p =
          model.method === "monthly"
            ? base
            : prediction(data.rows, train, md, model);
      if (p === null || base === null) continue;
      const actual = value > 0 ? 1 : 0;
      loss += (p - actual) ** 2;
      baselineLoss += (base - actual) ** 2;
      count++;
      used.add(year);
    }
  }
  const brier = count ? loss / count : null,
    baselineBrier = count ? baselineLoss / count : null;
  return {
    count,
    years: used.size,
    brier,
    baselineBrier,
    skill:
      brier !== null && baselineBrier !== null && baselineBrier > 0
        ? 1 - brier / baselineBrier
        : null,
  };
}
function fit(history: HistoricalClimate, before: number) {
  const data = dataset(history, before);
  // Reserve the latest five seasons BEFORE selecting hyperparameters. The
  // subsequent rolling evaluation can use previous seasons, never future data.
  const holdout = data.years.length >= 15 ? data.years.slice(-5) : [];
  const selectionYears = holdout.length ? data.years.slice(10, -5) : [];
  const candidates: HistoryCandidate[] = [10, 20, 30, 45].flatMap((window) =>
    [0, 1].map((prior) => ({ window, prior })),
  );
  candidates.push({ window: 45, prior: 0, method: "monthly" });
  const selection =
    selectionYears.length >= 5
      ? candidates
          .map((model) => ({
            model,
            scores: score(data, selectionYears, model),
          }))
          .filter((r) => r.scores.years >= 5)
          .sort(
            (a, b) =>
              a.scores.brier! - b.scores.brier! ||
              b.model.window - a.model.window ||
              a.model.prior - b.model.prior,
          )
      : [];
  // Retain the existing full-history baseline when selection is not supported.
  const model: HistoryCandidate = selection[0]?.model ?? {
    window: 45,
    prior: 0,
  };
  const validation = score(data, holdout, model);
  const trainingYears = data.years.slice(-model.window);
  const monthlyForecast = Object.fromEntries(
    ["-10", "-11", "-12"].map((month) => {
      const years = trainingYears.filter((y) =>
        Object.keys(data.rows.get(y) ?? {}).some(
          (md) => md.slice(0, 3) === month,
        ),
      );
      const values = years.flatMap((y) =>
        Object.entries(data.rows.get(y) ?? {})
          .filter(([md]) => md.slice(0, 3) === month)
          .map(([, value]) => value),
      );
      return [
        month,
        years.length >= 10
          ? {
              probability: mean(values.map((v) => (v > 0 ? 1 : 0)))!,
              slots: mean(values)!,
              years: years.length,
            }
          : null,
      ];
    }),
  );
  return {
    version: "historical-rolling-v1",
    model,
    selected: selection.length > 0,
    selectionYears: selectionYears.length,
    selection: selection.map((r) => ({
      window: r.model.window,
      prior: r.model.prior,
      method: r.model.method ?? "calendar-day",
      brier: r.scores.brier,
      years: r.scores.years,
    })),
    holdout,
    validation,
    years: data.years,
    trainingYears,
    monthlyForecast,
    dailyLabels: [...data.rows.values()].reduce(
      (s, row) => s + Object.keys(row).length,
      0,
    ),
  };
}
export function historicalModel(history: HistoricalClimate, before: number) {
  // Database snapshots are immutable. Reuse fits across publications only when
  // all labels, years and criteria match, never just by coordinate or date.
  const stamp = [
    history.rulesSignature,
    history.fetchedAt,
    history.years.join(","),
  ].join("/");
  let cached = cache.get(history);
  if (!cached || cached.stamp !== stamp) {
    cached = { stamp, byYear: new Map() };
    cache.set(history, cached);
  }
  let result = cached.byYear.get(before);
  if (!result) {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          before,
          history.rulesSignature,
          history.years,
          history.days,
        ]),
      )
      .digest("hex");
    result = fittedCache.get(fingerprint) ?? fit(history, before);
    if (!fittedCache.has(fingerprint)) {
      if (fittedCache.size >= 256)
        fittedCache.delete(fittedCache.keys().next().value!);
      fittedCache.set(fingerprint, result);
    }
    cached.byYear.set(before, result);
  }
  return result;
}
export function historicalProbability(
  history: HistoricalClimate,
  date: string,
) {
  const model = historicalModel(history, Number(date.slice(0, 4)));
  if (model.model.method === "monthly")
    return model.monthlyForecast[date.slice(4, 7)] ?? null;
  const values = model.trainingYears
    .map((y) => history.days[`${y}${date.slice(4)}`])
    .filter(valid);
  if (values.length < 10) return null;
  return {
    probability:
      (values.filter((v) => v > 0).length + model.model.prior) /
      (values.length + 2 * model.model.prior),
    slots: values.reduce((s, v) => s + v, 0) / values.length,
    years: values.length,
  };
}
function season(values: number[]) {
  let windows = 0,
    longestRun = 0,
    run = 0;
  for (const value of values) {
    if (value > 0) {
      if (!run) windows++;
      run++;
      longestRun = Math.max(longestRun, run);
    } else run = 0;
  }
  return { days: values.filter((v) => v > 0).length, windows, longestRun };
}
export function historicalDiagnostics(
  history: HistoricalClimate,
  dates: string[],
) {
  if (!dates.length) return null;
  const before = Number(dates[0].slice(0, 4)),
    fitted = historicalModel(history, before),
    data = dataset(history, before);
  const md = dates.map((d) => d.slice(4));
  const sample = (year: number) => {
    const values = md.map((d) => data.rows.get(year)?.[d]);
    return values.every(valid) ? { year, ...season(values) } : null;
  };
  const annual = fitted.trainingYears
    .map(sample)
    .filter((v): v is NonNullable<typeof v> => v !== null);
  const tests = fitted.holdout.flatMap((year) => {
    const actual = sample(year),
      train = data.years.filter((y) => y < year),
      past = train
        .slice(-fitted.model.window)
        .map(sample)
        .filter((v): v is NonNullable<typeof v> => v !== null);
    const probabilities = md.map((d) =>
      prediction(data.rows, train, d, fitted.model),
    );
    if (!actual || past.length < 10 || probabilities.some((p) => p === null))
      return [];
    const expected = probabilities.reduce<number>((s, p) => s + p!, 0),
      counts = past.map((y) => y.days),
      low = quantile(counts, 0.1),
      high = quantile(counts, 0.9);
    return [
      {
        year,
        actualDays: actual.days,
        expectedDays: expected,
        absoluteError: Math.abs(expected - actual.days),
        insideRange: actual.days >= low && actual.days <= high,
        windowError: Math.abs(
          mean(past.map((y) => y.windows))! - actual.windows,
        ),
      },
    ];
  });
  return {
    ...fitted,
    annual,
    periodValidation: {
      seasons: tests.length,
      maeDays: mean(tests.map((t) => t.absoluteError)),
      maeWindows: mean(tests.map((t) => t.windowError)),
      rangeCoverage: mean(tests.map((t) => (t.insideRange ? 1 : 0))),
      tests,
    },
  };
}
