import { test } from "node:test";
import assert from "node:assert/strict";
import {
  globalDailyEstimates,
  locationDayEstimate,
  missingForecastLabel,
} from "../src/domain/planning-summary";
import type { PlanningZone } from "../src/domain/planning-report";
const zone = (values: (number | null)[]) =>
  ({
    daily: values.map((probability, i) => ({
      date: `2026-10-${21 + i}`,
      probability,
      supported: probability !== null,
    })),
  }) as Pick<PlanningZone, "daily">;
test("global estimate combines available locations without turning missing data into bad weather", () => {
  const dates = ["2026-10-21", "2026-10-22"];
  const result = globalDailyEstimates(
    [zone([0.8, null]), zone([0.4, 0.6]), zone([null, null])],
    dates,
  );
  assert.ok(Math.abs(result[0].probability! - 0.6) < 1e-10);
  assert.equal(result[0].covered, 2);
  assert.equal(result[0].total, 3);
  assert.equal(result[1].probability, 0.6);
  assert.equal(result[1].covered, 1);
  assert.equal(
    globalDailyEstimates([zone([null])], dates)[0].probability,
    null,
  );
});
test("partial period shows the sum over available dates rather than erasing it or projecting missing dates", () => {
  assert.deepEqual(
    locationDayEstimate(zone([0.8, null, 0.5]), [
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]),
    { expected: 1.3, covered: 2, total: 3 },
  );
  assert.equal(
    missingForecastLabel({ dataStatus: "loading" }),
    "Cargando pronóstico",
  );
  assert.equal(
    missingForecastLabel({ dataStatus: "failed" }),
    "Descarga fallida",
  );
});
