import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellKey,
  rulesSignature,
  EnsembleAssessment,
} from "../src/domain/evidence";
import { defaultRules } from "../src/domain/types";
import {
  freezePredictions,
  confusionReport,
  dayEvidence,
  FrozenPrediction,
  ValidationArchive,
} from "../src/domain/forecast-validation";
const rules = { ...defaultRules };
const now = new Date("2026-10-20T15:00:00Z");
function ensemble(): EnsembleAssessment {
  return {
    key: cellKey(-38.511, -58.733),
    lat: -38.511,
    lon: -58.733,
    rulesSignature: rulesSignature(rules),
    fetchedAt: now.toISOString(),
    paths: ["A", "B"].flatMap((family) =>
      Array.from({ length: 20 }, (_, i) => ({
        family,
        member: String(i),
        days: { "2026-10-21": i < 15 ? 1 : 0, "2026-10-20": 1 },
      })),
    ),
    windows: [],
    sources: [],
    errors: [],
    nativeResolution: "test",
  };
}
test("neighboring equipment are evaluated at distinct coordinates", () => {
  assert.notEqual(cellKey(-38.511, -58.733), cellKey(-38.512, -58.734));
});
test("freezes only future supported predictions once per lead and rule set", () => {
  const a: ValidationArchive = { predictions: [], outcomes: [] },
    e = ensemble();
  freezePredictions(a, { [e.key]: e }, rules, now);
  assert.equal(a.predictions.length, 1);
  assert.equal(a.predictions[0].probability, 0.75);
  assert.equal(a.predictions[0].lead, 1);
  e.paths.forEach((p) => (p.days["2026-10-21"] = 0));
  freezePredictions(a, { [e.key]: e }, rules, new Date("2026-10-20T17:00Z"));
  assert.equal(a.predictions.length, 1);
  assert.equal(a.predictions[0].probability, 0.75);
  freezePredictions(a, { [e.key]: e }, { ...rules, wind: 12 }, now);
  assert.equal(a.predictions.length, 1);
});
test("rejects incomplete families and stale or future-dated sources", () => {
  const e = ensemble();
  e.paths
    .filter((p) => p.family === "A")
    .slice(0, 6)
    .forEach((p) => (p.days["2026-10-21"] = null));
  assert.equal(dayEvidence(e, "2026-10-21").supported, false);
  const a: ValidationArchive = { predictions: [], outcomes: [] };
  freezePredictions(a, { [e.key]: e }, rules, now);
  assert.equal(a.predictions.length, 0);
  const fresh = ensemble();
  freezePredictions(
    a,
    { [fresh.key]: fresh },
    rules,
    new Date("2026-10-21T15:00Z"),
  );
  assert.equal(a.predictions.length, 0);
});
function prediction(
  date: string,
  p: number,
  key = "point",
  lead = 1,
): FrozenPrediction {
  return {
    key,
    lat: -38,
    lon: -58,
    date,
    lead,
    probability: p,
    capturedAt: new Date(
      Date.parse(date + "T15:00Z") - lead * 86400000,
    ).toISOString(),
    fetchedAt: "2026-10-01T15:00Z",
    signature: rulesSignature(rules),
    rules,
    families: 2,
    members: 40,
  };
}
test("confusion matrix uses out-of-time fixed-lead records and excludes missing outcomes, other locations and rules", () => {
  const predictions = [
    prediction("2026-10-10", 0.9),
    prediction("2026-10-11", 0.8),
    prediction("2026-10-12", 0.2),
    prediction("2026-10-13", 0.1),
    prediction("2026-10-14", 0.9),
    prediction("2026-10-10", 1, "other"),
    prediction("2026-10-11", 1, "point", 3),
    prediction("2026-08-10", 1),
  ];
  const a: ValidationArchive = {
    predictions,
    outcomes: predictions.slice(0, 4).map((p, i) => ({
      key: p.key,
      date: p.date,
      signature: p.signature,
      apt: [true, false, true, false][i],
      verifiedAt: now.toISOString(),
      source: "ERA5",
    })),
  };
  const c = confusionReport(a, ["point"], rulesSignature(rules), 1, 0.7, now);
  assert.deepEqual([c.tp, c.fp, c.tn, c.fn], [1, 1, 1, 1]);
  assert.equal(c.count, 4);
  assert.equal(c.pending, 1);
  assert.equal(c.precision, 0.5);
  assert.equal(c.accuracy, 0.5);
  assert.ok(Math.abs(c.brier! - 0.325) < 1e-10);
  assert.equal(c.expected, 30);
  assert.equal(
    confusionReport(a, [], rulesSignature(rules), 1, 0.7, now).count,
    0,
  );
  assert.equal(
    confusionReport(a, ["point"], "other rules", 1, 0.7, now).count,
    0,
  );
  const invalid = prediction("2026-10-10", 0.99);
  invalid.capturedAt = "2026-10-10T15:00Z";
  a.predictions = [invalid];
  assert.equal(
    confusionReport(a, ["point"], rulesSignature(rules), 1, 0.7, now).count,
    0,
  );
});
test("empty validation never presents missing data as zero accuracy", () => {
  const c = confusionReport(
    { predictions: [], outcomes: [] },
    ["point"],
    rulesSignature(rules),
    1,
    0.7,
    now,
  );
  assert.equal(c.accuracy, null);
  assert.equal(c.precision, null);
  assert.equal(c.brier, null);
});

test("verification applies frozen trial rules, keeps dry hours despite night rain, and leaves incomplete days unverified", async () => {
  const { verifyPredictionDays } =
    await import("../src/domain/forecast-validation");
  const p = prediction("2026-10-11", 0.8);
  const hours = ["2026-10-10", "2026-10-11"].flatMap((date) =>
    Array.from({ length: 24 }, (_, i) => ({
      time: `${date}T${String(i).padStart(2, "0")}:00`,
      wind: 5,
      gust: null,
      rain: date === "2026-10-11" && i === 1 ? 3 : 0,
      soil: null,
    })),
  );
  const outcomes = verifyPredictionDays(
    [p, { ...p, lead: 3 }],
    hours,
    now.toISOString(),
  );
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].apt, true);
  const wet = hours.map((h) => ({
    ...h,
    rain: h.time.startsWith("2026-10-10") ? 1 : h.rain,
  }));
  assert.equal(verifyPredictionDays([p], wet, now.toISOString())[0].apt, false);
  const incomplete = hours.filter((h) => h.time !== "2026-10-10T12:00");
  assert.equal(
    verifyPredictionDays([p], incomplete, now.toISOString()).length,
    0,
  );
});

test("consecutive-day statistics distinguish dispersed days from continuous work runs", async () => {
  const { scenarioConsecutiveDays, scenarioDayCounts } =
    await import("../src/domain/opportunity-report");
  const dates = ["2026-10-21", "2026-10-22", "2026-10-23"];
  const paths = (values: number[]) =>
    ["A", "B"].flatMap((family) =>
      Array.from({ length: 20 }, (_, i) => ({
        family,
        member: String(i),
        days: Object.fromEntries(dates.map((d, j) => [d, values[j]])),
      })),
    );
  assert.equal(scenarioDayCounts(paths([1, 0, 1]), dates)!.expected, 2);
  assert.equal(scenarioConsecutiveDays(paths([1, 0, 1]), dates)!.expected, 1);
  assert.equal(scenarioConsecutiveDays(paths([1, 1, 0]), dates)!.expected, 2);
  assert.equal(
    scenarioConsecutiveDays(paths([1, 0, 1]), dates.slice(1), dates[0])!
      .expected,
    0,
  );
});

test("a shorter third source does not erase two well-covered sources for a date or a period", async () => {
  const { scenarioDayCounts } =
    await import("../src/domain/opportunity-report");
  const e = ensemble();
  e.paths.push(
    ...Array.from({ length: 20 }, (_, i) => ({
      family: "short-horizon",
      member: String(i),
      days: { "2026-10-21": null },
    })),
  );
  assert.equal(dayEvidence(e, "2026-10-21").supported, true);
  assert.equal(dayEvidence(e, "2026-10-21").probability, 0.75);
  assert.equal(scenarioDayCounts(e.paths, ["2026-10-21"])!.expected, 0.75);
  e.paths = e.paths.filter((p) => p.family !== "B");
  assert.equal(dayEvidence(e, "2026-10-21").supported, false);
  assert.equal(scenarioDayCounts(e.paths, ["2026-10-21"]), null);
});
