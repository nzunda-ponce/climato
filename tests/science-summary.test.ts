import { test } from "node:test";
import assert from "node:assert/strict";
import { scienceSummary } from "../src/domain/science-summary";
import type { PlanningZone } from "../src/domain/planning-report";
const location = (key: string, base: number) =>
  ({
    key,
    locationKey: key,
    outlook: [{ date: "2026-11-01", probability: 0.5, source: "histórico" }],
    science: {
      annual: Array.from({ length: 10 }, (_, i) => ({
        year: 2016 + i,
        days: base + i,
        windows: 2,
        longestRun: 3,
      })),
      validation: { count: 0, brier: null, baselineBrier: null },
      periodValidation: { maeDays: null },
      dailyLabels: 920,
      model: { window: 10, prior: 0 },
    },
  }) as unknown as PlanningZone;
test("regional historical ranges use the same year across locations and do not duplicate shared coordinates", () => {
  const a = location("a", 10),
    b = location("b", 20);
  const s = scienceSummary([a, b, { ...a, key: "a::E" }], ["2026-11-01"]);
  assert.equal(s.locations, 2);
  assert.equal(s.annual.length, 10);
  assert.equal(s.annual[0].days, 15);
  assert.equal(s.annual[9].days, 24);
  assert.equal(s.expected.expected, 0.5);
  assert.equal(s.windows?.mean, 2);
  assert.equal(s.brier, null);
});
test("incomplete locations remain visible in coverage instead of silently becoming full regional evidence", () => {
  const a = location("a", 10),
    missing = { ...location("b", 20), science: null };
  const s = scienceSummary([a, missing], ["2026-11-01"]);
  assert.equal(s.referenceLocations, 1);
  assert.equal(s.locations, 2);
  assert.equal(s.annual.length, 10);
});
