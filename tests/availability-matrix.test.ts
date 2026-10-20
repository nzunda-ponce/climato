import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availabilityCell,
  availabilityGroups,
  availabilityColor,
  availabilityBacking,
  bestForecastDay,
} from "../src/domain/availability-matrix";
import type { PlanningZone } from "../src/domain/planning-report";
const zone = (region: string, values: (number | null)[], equipment = 1) =>
  ({
    regions: [region],
    provinces: [],
    fields: [],
    pending: equipment,
    outlook: values.map((p, i) => ({
      date: `2026-10-${21 + i}`,
      probability: p,
      source: i === 0 ? "pronóstico" : "histórico",
    })),
  }) as unknown as PlanningZone;
test("daily regional means weight coordinates equally and never multiply by equipment count", () => {
  const cell = availabilityCell(
    [zone("Centro", [0.8], 100), zone("Centro", [0.4], 1)],
    ["2026-10-21"],
  );
  assert.ok(Math.abs(cell.probability! - 0.6) < 1e-10);
  assert.ok(Math.abs(cell.expected! - 0.6) < 1e-10);
  assert.equal(cell.complete, true);
  const groups = availabilityGroups([
    zone("Centro", [0.8]),
    zone("Centro", [0.4]),
    zone("Norte", [0.1]),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0][1].length, 2);
});
test("forecast comparisons never announce a historical day as a weather forecast", () => {
  const historical = zone("Centro", [0.1, 1]);
  const candidate = bestForecastDay([historical], ["2026-10-21", "2026-10-22"]);
  assert.equal(candidate?.date, "2026-10-21");
  assert.equal(
    availabilityBacking(
      availabilityCell([historical], ["2026-10-21", "2026-10-22"]),
    ),
    "Mixto",
  );
  assert.equal(bestForecastDay([historical], ["2026-10-22"]), undefined);
});
test("every heatmap color maintains AA contrast for normal text", () => {
  const luminance = (rgb: number[]) =>
    rgb
      .map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (let i = 0; i <= 1000; i++) {
    const color = availabilityColor(i / 1000);
    const bg = luminance(color.backgroundColor.match(/\d+/g)!.map(Number));
    const fg = color.color === "#ffffff" ? 1 : 0;
    assert.ok((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5);
  }
});
test("weekly cells sum daily probabilities per location and normalize color by covered days", () => {
  const cell = availabilityCell(
    [zone("Centro", [0.8, 0.4]), zone("Centro", [0.4, 0.8])],
    ["2026-10-21", "2026-10-22"],
  );
  assert.ok(Math.abs(cell.expected! - 1.2) < 1e-10);
  assert.ok(Math.abs(cell.probability! - 0.6) < 1e-10);
  assert.deepEqual(cell.sources, { pronóstico: 2, histórico: 2 });
});
test("missing forecasts remain explicit and zero probability remains an actual observation", () => {
  const partial = availabilityCell(
    [zone("Centro", [0, null]), zone("Centro", [null, null])],
    ["2026-10-21", "2026-10-22"],
  );
  assert.equal(partial.expected, 0);
  assert.equal(partial.covered, 1);
  assert.equal(partial.total, 4);
  assert.equal(partial.complete, false);
  assert.equal(partial.availableLocations, 1);
  const empty = availabilityCell(
    [zone("Norte", [null, null])],
    ["2026-10-21", "2026-10-22"],
  );
  assert.equal(empty.expected, null);
  assert.equal(empty.probability, null);
  assert.notDeepEqual(availabilityColor(0), availabilityColor(null));
  assert.deepEqual(availabilityColor(2), availabilityColor(1));
});
test("aggregate totals do not extrapolate missing dates and ignore dates outside the period", () => {
  const cell = availabilityCell(
    [zone("Centro", [0.8, null, 0.6])],
    ["2026-10-21", "2026-10-22"],
  );
  assert.equal(cell.expected, 0.8);
  assert.equal(cell.covered, 1);
  assert.equal(cell.complete, false);
});
