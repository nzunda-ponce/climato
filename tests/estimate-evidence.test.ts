import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateEvidence,
  estimateTimeline,
  estimateMonths,
} from "../src/domain/estimate-evidence";
import type { PlanningZone } from "../src/domain/planning-report";

const zone = (
  key: string,
  values: [string, number | null, string][],
  locationKey = key,
) =>
  ({
    key,
    locationKey,
    outlook: values.map(([date, probability, source]) => ({
      date,
      probability,
      source,
    })),
  }) as PlanningZone;

test("source contributions reconcile with the location average without multiplying shared coordinates", () => {
  const first = zone(
    "E",
    [
      ["2026-10-31", 0.8, "pronóstico"],
      ["2026-11-01", 0.4, "histórico"],
    ],
    "shared",
  );
  const second = zone("N", [
    ["2026-10-31", 0.2, "pronóstico"],
    ["2026-11-01", 0.6, "estacional"],
  ]);
  const duplicate = { ...first, key: "E-duplicate" };
  const result = estimateEvidence(
    [first, duplicate, second],
    ["2026-10-31", "2026-11-01"],
  );
  assert.equal(result.locations, 2);
  assert.equal(result.expected, 1);
  assert.equal(
    result.sourceBreakdown.find((s) => s.source === "pronóstico")!.contribution,
    0.5,
  );
  assert.equal(
    result.sourceBreakdown.find((s) => s.source === "histórico")!.contribution,
    0.2,
  );
  assert.equal(
    result.sourceBreakdown.find((s) => s.source === "estacional")!.contribution,
    0.3,
  );
  assert.equal(
    result.sourceBreakdown.reduce((sum, s) => sum + s.contribution!, 0),
    result.expected,
  );
  assert.equal(result.missing, 0);
});

test("monthly charts distinguish no data from actual zero and retain partial month boundaries", () => {
  const items = [
    zone("a", [
      ["2026-10-31", 0, "histórico"],
      ["2026-11-01", null, "sin datos"],
      ["2026-11-02", null, "sin datos"],
    ]),
  ];
  const dates = ["2026-10-31", "2026-11-01", "2026-11-02"];
  const months = estimateMonths(items, dates);
  assert.deepEqual(
    months.map((m) => m.days.length),
    [1, 2],
  );
  assert.equal(months[0].expected, 0);
  assert.equal(months[0].complete, true);
  assert.equal(months[1].expected, null);
  assert.equal(months[1].missing, 2);
  assert.ok(months[1].sourceBreakdown.every((s) => s.contribution === null));
});

test("weekly summaries use covered observations and never fill missing dates", () => {
  const result = estimateTimeline(
    [
      zone("a", [
        ["2026-10-21", 0.8, "pronóstico"],
        ["2026-10-22", null, "sin datos"],
        ["2026-10-23", 0.4, "histórico"],
      ]),
    ],
    ["2026-10-21", "2026-10-22", "2026-10-23"],
    7,
  )[0];
  assert.ok(Math.abs(result.probability! - 0.6) < 1e-10);
  assert.ok(Math.abs(result.expected! - 1.2) < 1e-10);
  assert.equal(result.covered, 2);
  assert.equal(result.total, 3);
  assert.equal(result.complete, false);
  assert.equal(result.missing, 1);
});
