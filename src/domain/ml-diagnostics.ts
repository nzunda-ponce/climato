export interface ProbabilityCase {
  probability: number;
  target: number;
}

export function probabilityDiagnostics(
  rows: ProbabilityCase[],
  threshold: number,
) {
  const valid = rows.filter(
    (r) =>
      Number.isFinite(r.probability) &&
      r.probability >= 0 &&
      r.probability <= 1 &&
      (r.target === 0 || r.target === 1),
  );
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const row of valid) {
    if (row.probability >= threshold) {
      if (row.target) tp++;
      else fp++;
    } else {
      if (row.target) fn++;
      else tn++;
    }
  }
  const ratio = (a: number, b: number) => (b ? a / b : null);
  return {
    tp,
    fp,
    tn,
    fn,
    count: valid.length,
    accuracy: ratio(tp + tn, valid.length),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    specificity: ratio(tn, tn + fp),
    f1: ratio(2 * tp, 2 * tp + fp + fn),
    prevalence: ratio(tp + fn, valid.length),
    brier: valid.length
      ? valid.reduce((sum, r) => sum + (r.probability - r.target) ** 2, 0) /
        valid.length
      : null,
    bins: Array.from({ length: 5 }, (_, i) => {
      const cases = valid.filter(
        (r) => Math.min(4, Math.floor(r.probability * 5)) === i,
      );
      return {
        lower: i / 5,
        upper: (i + 1) / 5,
        count: cases.length,
        predicted: cases.length
          ? cases.reduce((sum, r) => sum + r.probability, 0) / cases.length
          : null,
        observed: cases.length
          ? cases.reduce((sum, r) => sum + r.target, 0) / cases.length
          : null,
      };
    }),
  };
}

export type ProbabilityDiagnostics = ReturnType<typeof probabilityDiagnostics>;

// Pool counts, not percentages: each unique location-day gets one vote.
export function combineDiagnostics(
  items: ProbabilityDiagnostics[],
): ProbabilityDiagnostics {
  const total = probabilityDiagnostics([], 0.7);
  for (const item of items) {
    for (const field of ["tp", "fp", "tn", "fn", "count"] as const)
      total[field] += item[field];
  }
  const ratio = (a: number, b: number) => (b ? a / b : null);
  total.accuracy = ratio(total.tp + total.tn, total.count);
  total.precision = ratio(total.tp, total.tp + total.fp);
  total.recall = ratio(total.tp, total.tp + total.fn);
  total.specificity = ratio(total.tn, total.tn + total.fp);
  total.f1 = ratio(2 * total.tp, 2 * total.tp + total.fp + total.fn);
  total.prevalence = ratio(total.tp + total.fn, total.count);
  total.brier = ratio(
    items.reduce((sum, item) => sum + (item.brier ?? 0) * item.count, 0),
    total.count,
  );
  total.bins = total.bins.map((bin, index) => {
    const bins = items.map((item) => item.bins[index]);
    const count = bins.reduce((sum, b) => sum + b.count, 0);
    return {
      ...bin,
      count,
      predicted: ratio(
        bins.reduce((sum, b) => sum + (b.predicted ?? 0) * b.count, 0),
        count,
      ),
      observed: ratio(
        bins.reduce((sum, b) => sum + (b.observed ?? 0) * b.count, 0),
        count,
      ),
    };
  });
  return total;
}

export interface DiagnosticBatch {
  total: number;
  next: number | null;
  processed: number;
  included: number;
  excluded: number;
  cohort: string;
  years: number[];
  weather: { model: ProbabilityDiagnostics; baseline: ProbabilityDiagnostics };
  calendar: { model: ProbabilityDiagnostics; baseline: ProbabilityDiagnostics };
}
