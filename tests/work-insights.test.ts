import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workInsights,
  type WorkInsightLocation,
} from "../src/domain/work-insights";

const dates = Array.from(
  { length: 8 },
  (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`,
);
const zone = (
  key: string,
  name: string,
  values: (number | null)[],
  locationKey = key,
) =>
  ({
    key,
    locationKey,
    equipment: [{ name }],
    regions: [],
    provinces: [],
    fields: [],
    outlook: dates.map((date, index) => ({
      date,
      probability: values[index] ?? null,
      source: "histórico",
    })),
  }) satisfies WorkInsightLocation;

test("expected days and date alternatives count unique coordinates, not equipment", () => {
  const a = zone(
    "a",
    "BE1",
    dates.map(() => 0.8),
  );
  const b = zone(
    "b",
    "BN1",
    dates.map(() => 0.4),
  );
  const result = workInsights([a, { ...a, key: "duplicate" }, b], dates, 0.7);
  assert.ok(Math.abs(result.daily[0].probability! - 0.6) < 1e-10);
  assert.equal(result.daily[0].qualifying, 1);
  assert.ok(Math.abs(result.curve.at(-1)!.expected! - 4.8) < 1e-10);
  assert.equal(result.ranking[0].name, "Zona E");
  assert.ok(Math.abs(result.ranking[0].expected - 6.4) < 1e-10);
  assert.equal(result.favorable, 0);
  assert.equal(workInsights([a, b], dates, 0.5).favorable, 8);
});

test("best seven-day block uses the full window and deterministic ties", () => {
  const result = workInsights(
    [zone("a", "BE1", [0.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9])],
    dates,
    0.7,
  );
  assert.equal(result.bestWindow?.start, dates[1]);
  assert.ok(Math.abs(result.bestWindow!.expected - 6.3) < 1e-10);
});

test("missing values stop cumulative totals and exclude incomplete zone comparisons", () => {
  const result = workInsights(
    [zone("a", "BE1", [0.8, null, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8])],
    dates,
    0.7,
  );
  assert.equal(result.daily[1].probability, null);
  assert.equal(result.daily[1].qualifying, null);
  assert.equal(result.curve.at(-1)!.expected, null);
  assert.equal(result.bestWindow, undefined);
  assert.deepEqual(result.ranking, []);
  assert.equal(result.incomplete, true);
});

test("empty selections do not become zero-probability opportunities", () => {
  const result = workInsights([], dates, 0.7);
  assert.equal(result.favorable, null);
  assert.equal(result.bestDay, undefined);
  assert.deepEqual(result.ranking, []);
});
