import { test } from "node:test";
import assert from "node:assert/strict";
import { historicalWeek, historicalWeeks } from "../src/domain/history-weeks";
import { historicalCurves } from "../src/domain/historical-curves";
import type { PlanningZone } from "../src/domain/planning-report";

const zone = (key: string, values: string, locationKey = key) =>
  ({
    key,
    locationKey,
    outlook: [{ date: "2026-11-04", probability: 0.8, source: "pronóstico" }],
    science: {
      historicalDaily: {
        dates: historicalWeek("2026-11-04").dates,
        years: [
          { year: 2020, values },
          { year: 2021, values: "1111111" },
        ],
      },
      weeklyForecast: { "2026-11-02": { probability: 0.6 } },
    },
  }) as unknown as PlanningZone;

test("calendar weeks cross months and clip only at the historical season boundaries", () => {
  assert.deepEqual(historicalWeek("2026-10-01").dates, [
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
  assert.equal(historicalWeek("2026-12-31").end, "2026-12-31");
  assert.equal(historicalWeek("2026-11-01").start, "2026-10-26");
  assert.equal(historicalWeeks(["2026-10-31", "2026-11-01"]).length, 1);
});

test("year curves use full equivalent weeks while the current estimate respects the date filter", () => {
  const result = historicalCurves([zone("a", "1110000")], ["2026-11-04"]);
  assert.equal(result.weeks[0].dates.length, 7);
  assert.equal(result.curves[0].points[0].probability, 3 / 7);
  assert.equal(result.curves[0].points[0].coveredApt, 3);
  assert.equal(result.reference[0].probability, 0.6);
  assert.equal(result.estimate[0].probability, 0.8);
  assert.equal(result.estimate[0].total, 1);
});

test("shared coordinates are not doubled and sparse years remain gaps", () => {
  const result = historicalCurves(
    [zone("a", "11???00", "shared"), zone("duplicate", "11???00", "shared")],
    ["2026-11-04"],
  );
  assert.equal(result.totalLocations, 1);
  assert.equal(result.curves.length, 2);
  assert.equal(result.curves[0].points[0].probability, null);
  assert.equal(result.curves[0].points[0].locations, 0);
  assert.equal(result.curves[1].points[0].probability, 1);
  assert.equal(result.curves[1].points[0].locations, 1);
});

test("old publications do not manufacture annual curves from monthly means", () => {
  const result = historicalCurves(
    [{ key: "old", outlook: [] } as unknown as PlanningZone],
    ["2026-11-04"],
  );
  assert.equal(result.curves.length, 0);
  assert.equal(result.locations, 0);
  assert.equal(result.reference[0].probability, null);
});
