import { test } from "node:test";
import assert from "node:assert/strict";
import {
  historyComparison,
  strictCumulative,
} from "../src/domain/history-comparison";
import { smoothPath, smoothSegments } from "../src/domain/chart-path";
import type { PlanningZone } from "../src/domain/planning-report";

const dates = ["2026-10-23", "2026-10-24", "2026-10-25"];
function location(
  key: string,
  values: string,
  probabilities: (number | null)[],
) {
  return {
    key,
    locationKey: key,
    outlook: dates.map((date, i) => ({
      date,
      probability: probabilities[i],
      source: "pronóstico",
    })),
    science: { historicalDaily: { dates, years: [{ year: 2020, values }] } },
  } as unknown as PlanningZone;
}
test("cumulative history compares exact requested dates and unique coordinates", () => {
  const a = location("a", "101", [0.6, 0.6, 0.6]),
    b = location("b", "111", [0.8, 0.8, 0.8]);
  const result = historyComparison([a, b, { ...a, key: "duplicate" }], dates);
  assert.equal(result.locations, 2);
  assert.deepEqual(result.curves[0].daily, [1, 0.5, 1]);
  assert.deepEqual(result.curves[0].cumulative, [1, 1.5, 2.5]);
  assert.equal(result.curves[0].locations, 2);
  assert.ok(Math.abs(result.cumulative.at(-1)! - 2.1) < 1e-12);
});
test("incomplete historical cohorts are not extrapolated, and unknown forecasts stop the cumulative estimate", () => {
  const a = location("a", "101", [0.6, 0.6, 0.6]),
    b = location("b", "1?1", [0.8, null, 0.8]);
  const result = historyComparison([a, b], dates);
  assert.equal(result.curves[0].locations, 1);
  assert.deepEqual(result.curves[0].cumulative, [1, 1, 2]);
  assert.deepEqual(result.cumulative, [0.7, null, null]);
  const missing = historyComparison(
    [location("unknown", "???", [null, null, null])],
    dates,
  );
  assert.deepEqual(missing.curves[0].cumulative, [null, null, null]);
  assert.deepEqual(missing.referenceCumulative, [null, null, null]);
  assert.deepEqual(strictCumulative([1, null, 1]), [1, null, null]);
});
test("smooth rendering preserves gaps and keeps Bezier controls between adjacent observations", () => {
  assert.equal(smoothPath([null, null]), "");
  const gaps = smoothSegments([
    { x: 0, y: 10 },
    null,
    { x: 2, y: 50 },
    { x: 3, y: 20 },
  ]);
  assert.equal(gaps[0], "");
  assert.equal(gaps[1], "");
  assert.ok(gaps[2].startsWith("M2,50"));
  const segments = smoothSegments([0, 100, 0, 100].map((y, x) => ({ x, y })));
  for (const segment of segments.filter(Boolean)) {
    const numbers = segment.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    assert.equal(numbers.length, 8);
    const low = Math.min(numbers[1], numbers[7]),
      high = Math.max(numbers[1], numbers[7]);
    assert.ok(numbers[3] >= low && numbers[3] <= high);
    assert.ok(numbers[5] >= low && numbers[5] <= high);
  }
});
