import { test } from "node:test";
import assert from "node:assert/strict";
import {
  historicalModel,
  historicalDiagnostics,
  historicalProbability,
} from "../src/domain/history-model";
import { HistoricalClimate } from "../src/domain/evidence";
const fixture = (end = 2025): HistoricalClimate => {
  const years = Array.from({ length: end - 1980 }, (_, i) => 1981 + i),
    days: HistoricalClimate["days"] = {};
  for (const year of years)
    for (const month of [10, 11, 12])
      for (let d = 1; d <= new Date(Date.UTC(year, month, 0)).getUTCDate(); d++)
        days[`${year}-${month}-${String(d).padStart(2, "0")}`] =
          (year + d) % 4 === 0 ? 0 : 1;
  return {
    key: "point",
    lat: -38,
    lon: -59,
    years,
    days,
    monthly: {},
    source: "ERA5",
    rulesSignature: "rules",
    fetchedAt: "2026-10-20T00:00:00Z",
  };
};
test("hyperparameter selection cannot inspect the latest five holdout seasons", () => {
  const h = fixture(),
    changed = structuredClone(h);
  for (const date of Object.keys(changed.days))
    if (Number(date.slice(0, 4)) >= 2021) changed.days[date] = 0;
  const a = historicalModel(h, 2026),
    b = historicalModel(changed, 2026);
  assert.deepEqual(a.model, b.model);
  assert.deepEqual(a.selection, b.selection);
  assert.notEqual(a.validation.brier, b.validation.brier);
  assert.equal(a.holdout.length, 5);
  assert.equal(a.validation.years, 5);
});
test("a reference fit rejects current or future outcomes and retains whole season runs", () => {
  const h = fixture();
  const copy = structuredClone(h);
  copy.years.push(2026);
  copy.days["2026-11-01"] = 100;
  assert.deepEqual(
    historicalProbability(h, "2026-11-01"),
    historicalProbability(copy, "2026-11-01"),
  );
  const dates = Array.from(
    { length: 30 },
    (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`,
  );
  const result = historicalDiagnostics(h, dates)!;
  assert.ok(
    result.annual.every(
      (y) => y.longestRun === 3 && y.windows >= 7 && y.windows <= 8,
    ),
  );
  assert.equal(result.periodValidation.seasons, 5);
  const short = fixture(1990);
  assert.equal(historicalModel(short, 2026).selected, false);
  assert.equal(historicalModel(short, 2026).validation.count, 0);
});
test("missing dates are excluded from complete annual scenarios", () => {
  const h = fixture();
  h.days["2025-11-01"] = null;
  const result = historicalDiagnostics(h, ["2026-11-01", "2026-11-02"])!;
  assert.ok(!result.annual.some((y) => y.year === 2025));
});

test("weekly reference can distinguish two weeks within the same month", () => {
  const h = fixture(1990);
  for (const date of Object.keys(h.days))
    h.days[date] =
      date.slice(4) >= "-11-02" && date.slice(4) <= "-11-08" ? 1 : 0;
  const first = historicalProbability(h, "2026-11-02")!;
  const second = historicalProbability(h, "2026-11-09")!;
  assert.equal(first.probability, 1);
  assert.equal(second.probability, 0);
  assert.equal(
    historicalProbability(h, "2026-11-08")!.probability,
    first.probability,
  );
  assert.equal(historicalModel(h, 2026).model.method, "weekly");
  assert.ok(
    historicalModel(h, 2026).selection.every(
      (candidate) => candidate.method === "weekly",
    ),
  );
});

test("weekly estimates require ten eligible years and preserve missing days", () => {
  const h = fixture(1990);
  for (const date of Object.keys(h.days)) h.days[date] = 0;
  h.days["1990-11-02"] = null;
  assert.equal(historicalProbability(h, "2026-11-02")!.probability, 0);
  const nextSnapshot = structuredClone(h);
  nextSnapshot.days["1990-11-03"] = null;
  assert.equal(historicalProbability(nextSnapshot, "2026-11-02"), null);
});

test("year curves contain original labels and exactly the chosen training cohort", () => {
  const h = fixture(1990);
  h.days["1990-11-02"] = null;
  h.years.push(2026);
  h.days["2026-11-02"] = 1;
  const science = historicalDiagnostics(h, ["2026-11-02", "2026-11-03"])!;
  assert.deepEqual(
    science.historicalDaily.years.map((sample) => sample.year),
    science.trainingYears,
  );
  assert.ok(!science.trainingYears.includes(2026));
  const day = science.historicalDaily.dates.indexOf("2026-11-02");
  assert.equal(
    science.historicalDaily.years.find((sample) => sample.year === 1990)!
      .values[day],
    "?",
  );
  for (const sample of science.historicalDaily.years) {
    assert.equal(sample.values.length, science.historicalDaily.dates.length);
    const source = h.days[`${sample.year}-11-03`];
    assert.equal(
      sample.values[day + 1],
      source === null ? "?" : source > 0 ? "1" : "0",
    );
  }
});
