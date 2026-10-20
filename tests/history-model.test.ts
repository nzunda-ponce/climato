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
    for (let d = 1; d <= 30; d++)
      days[`${year}-11-${String(d).padStart(2, "0")}`] =
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
