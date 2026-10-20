import { addDays, localDate, Rules, Hour } from "./types";
import {
  cellKey,
  EnsembleAssessment,
  rulesSignature,
  dailyCapacity,
} from "./evidence";

export interface FrozenPrediction {
  key: string;
  lat: number;
  lon: number;
  date: string;
  lead: number;
  capturedAt: string;
  fetchedAt: string;
  probability: number;
  families: number;
  members: number;
  signature: string;
  rules: Rules;
}
export interface VerifiedDay {
  key: string;
  date: string;
  signature: string;
  apt: boolean;
  verifiedAt: string;
  source: "ERA5";
}
export interface ValidationArchive {
  predictions: FrozenPrediction[];
  outcomes: VerifiedDay[];
  refreshed?: Record<string, string>;
}
export function dayEvidence(ensemble: EnsembleAssessment, date: string) {
  const families = [...new Set(ensemble.paths.map((p) => p.family))];
  const groups = families.map((f) => {
    const paths = ensemble.paths.filter((p) => p.family === f);
    const values = paths
      .map((p) => p.days[date])
      .filter(
        (v): v is number =>
          typeof v === "number" && Number.isFinite(v) && v >= 0,
      );
    return {
      family: f,
      total: paths.length,
      usable: values.length,
      probability: values.length
        ? values.filter((v) => v > 0).length / values.length
        : null,
    };
  });
  const supported =
    groups.length >= 2 &&
    groups.every((g) => g.usable >= 10 && g.usable / g.total >= 0.8);
  return {
    supported,
    groups,
    members: groups.reduce((s, g) => s + g.usable, 0),
    probability: supported
      ? groups.reduce((s, g) => s + g.probability!, 0) / groups.length
      : null,
  };
}
// First capture per location, target date and lead is immutable. Never backfill
// predictions for past dates with today's models or with the observed weather.
export function freezePredictions(
  archive: ValidationArchive,
  ensembles: Record<string, EnsembleAssessment>,
  rules: Rules,
  now = new Date(),
) {
  const today = localDate(now),
    cutoff = addDays(today, -60),
    signature = rulesSignature(rules);
  archive.predictions = archive.predictions.filter((p) => p.date >= cutoff);
  archive.outcomes = archive.outcomes.filter((p) => p.date >= cutoff);
  const id = (
    p: Pick<FrozenPrediction, "key" | "date" | "lead" | "signature">,
  ) => JSON.stringify([p.key, p.date, p.lead, p.signature]);
  const seen = new Set(archive.predictions.map(id));
  for (const e of Object.values(ensembles)) {
    const age = now.getTime() - Date.parse(e.fetchedAt);
    if (
      e.rulesSignature !== signature ||
      !Number.isFinite(age) ||
      age < 0 ||
      age >= 12 * 3600000 ||
      e.key !== cellKey(e.lat, e.lon)
    )
      continue;
    for (let lead = 1; lead <= 14; lead++) {
      const date = addDays(today, lead),
        evidence = dayEvidence(e, date);
      const p: FrozenPrediction = {
        key: e.key,
        lat: e.lat,
        lon: e.lon,
        date,
        lead,
        capturedAt: now.toISOString(),
        fetchedAt: e.fetchedAt,
        probability: evidence.probability ?? 0,
        families: evidence.groups.length,
        members: evidence.members,
        signature,
        rules: { ...rules },
      };
      if (evidence.supported && !seen.has(id(p))) {
        archive.predictions.push(p);
        seen.add(id(p));
      }
    }
  }
}
const ratio = (a: number, b: number) => (b ? a / b : null);
export function confusionReport(
  archive: ValidationArchive,
  keys: string[],
  signature: string,
  lead = 1,
  threshold = 0.7,
  now = new Date(),
) {
  const end = addDays(localDate(now), -1),
    start = addDays(end, -29),
    selected = new Set(keys);
  const predictions = archive.predictions.filter(
    (p) =>
      selected.has(p.key) &&
      p.signature === signature &&
      p.lead === lead &&
      p.date >= start &&
      p.date <= end &&
      localDate(new Date(p.capturedAt)) === addDays(p.date, -lead),
  );
  const outcomes = new Map(
    archive.outcomes
      .filter((o) => o.signature === signature)
      .map((o) => [JSON.stringify([o.key, o.date]), o]),
  );
  const seen = new Set<string>();
  const pairs = predictions.flatMap((p) => {
    const id = JSON.stringify([p.key, p.date]);
    const o = outcomes.get(id);
    if (
      !o ||
      seen.has(id) ||
      !Number.isFinite(p.probability) ||
      p.probability < 0 ||
      p.probability > 1
    )
      return [];
    seen.add(id);
    return [{ ...p, apt: o.apt }];
  });
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const p of pairs) {
    if (p.probability >= threshold) {
      if (p.apt) tp++;
      else fp++;
    } else {
      if (p.apt) fn++;
      else tn++;
    }
  }
  const bins = Array.from({ length: 5 }, (_, i) => {
    const rows = pairs.filter(
      (p) => Math.min(4, Math.floor(p.probability * 5)) === i,
    );
    return {
      lower: i * 0.2,
      upper: (i + 1) * 0.2,
      count: rows.length,
      predicted: rows.length
        ? rows.reduce((s, p) => s + p.probability, 0) / rows.length
        : null,
      observed: rows.length
        ? rows.filter((p) => p.apt).length / rows.length
        : null,
    };
  });
  return {
    start,
    end,
    lead,
    threshold,
    tp,
    fp,
    tn,
    fn,
    count: pairs.length,
    days: new Set(pairs.map((p) => p.date)).size,
    locations: new Set(pairs.map((p) => p.key)).size,
    expected: keys.length * 30,
    captured: predictions.length,
    pending: predictions.length - pairs.length,
    accuracy: ratio(tp + tn, pairs.length),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    specificity: ratio(tn, tn + fp),
    brier: pairs.length
      ? pairs.reduce((s, p) => s + (p.probability - Number(p.apt)) ** 2, 0) /
        pairs.length
      : null,
    bins,
  };
}

// Apply exactly the frozen rule set to complete retrospective hourly data.
export function verifyPredictionDays(
  predictions: FrozenPrediction[],
  hours: Hour[],
  verifiedAt: string,
): VerifiedDay[] {
  const byDate = new Map<string, Hour[]>();
  for (const h of hours) {
    const date = h.time.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), h]);
  }
  const unique = [
    ...new Map(
      predictions.map((p) => [JSON.stringify([p.key, p.date, p.signature]), p]),
    ).values(),
  ];
  return unique.flatMap((p) => {
    const slots = dailyCapacity(
      byDate.get(p.date) ?? [],
      p.rules,
      byDate.get(addDays(p.date, -1)) ?? [],
    );
    return slots === null
      ? []
      : [
          {
            key: p.key,
            date: p.date,
            signature: p.signature,
            apt: slots > 0,
            verifiedAt,
            source: "ERA5" as const,
          },
        ];
  });
}
