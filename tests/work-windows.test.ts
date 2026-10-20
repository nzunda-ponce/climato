import { test } from "node:test";
import assert from "node:assert/strict";
import { ClimateZone } from "../src/domain/climatic";
import {
  listPossibleWindows,
  workWindowSummary,
  zoneWorkWindows,
} from "../src/domain/work-windows";
import { PivotPlan } from "../src/domain/types";

const zone = (pending: number, days: ClimateZone["days"]): ClimateZone => ({
  key: String(pending),
  name: "Campo",
  lat: -34,
  lon: -63,
  pending,
  days,
  historicalRange: null,
  years: [],
});
const day = (
  date: string,
  probability: number | null,
  slots: number | null,
): ClimateZone["days"][number] => ({
  date,
  probability,
  slots,
  source: "pronóstico",
});
test("counts work windows separately from days and counts each equipment once", () => {
  const a = zone(3, [
    day("2026-10-17", 0.75, 1.5),
    day("2026-10-18", 0.8, 0.8),
  ]);
  const b = zone(2, [day("2026-10-17", 0.4, 0.8), day("2026-10-18", 0.3, 0.3)]);
  const result = workWindowSummary([a, b], "2026-10-17", "2026-10-18", 50);
  assert.equal(
    zoneWorkWindows(a, "2026-10-17", "2026-10-18", 50).expectedWindows,
    2.3,
  );
  assert.ok(Math.abs(result.expectedWindows - 6.9) < 1e-9);
  assert.equal(result.equipmentWithWindow, 3);
  assert.equal(result.totalEquipment, 5);
  assert.equal(result.percent, 60);
});
test("uses the configured probability threshold and selected date range", () => {
  const a = zone(1, [day("2026-10-17", 0.5, 1), day("2026-10-18", 0.8, 1.6)]);
  assert.equal(
    zoneWorkWindows(a, "2026-10-17", "2026-10-17", 50).expectedWindows,
    1,
  );
  assert.equal(
    zoneWorkWindows(a, "2026-10-17", "2026-10-17", 60).expectedWindows,
    0,
  );
  assert.equal(
    workWindowSummary([a], "2026-10-18", "2026-10-18", 60).percent,
    100,
  );
});
test("missing data remains partial and does not remove equipment from the denominator", () => {
  const a = zone(2, [day("2026-10-17", 0.7, 0.7)]);
  const b = zone(2, [day("2026-10-17", null, null)]);
  const result = workWindowSummary([a, b], "2026-10-17", "2026-10-17", 50);
  assert.equal(result.expectedWindows, 1.4);
  assert.equal(result.percent, 50);
  assert.equal(result.coveredEquipment, 2);
  assert.equal(
    workWindowSummary([], "2026-10-17", "2026-10-17", 50).percent,
    null,
  );
});

test("zero equipment above the threshold does not mean zero chance of a window", () => {
  const a = zone(5, [day("2026-10-23", 0.35, 0.7)]);
  const result = workWindowSummary([a], "2026-10-23", "2026-10-23", 50);
  assert.equal(result.equipmentWithWindow, 0);
  assert.equal(result.percent, 0);
  assert.equal(result.meanDailyProbability, 35);
});

test("the default view lists low-probability possibilities instead of hiding an entire week", () => {
  const a = zone(2, [day("2026-11-30", 0.3, 0.6), day("2026-12-01", 0.4, 0.8)]);
  a.key = "-34,-63";
  const plans: PivotPlan[] = ["one", "two"].map((id) => ({
    pivot: {
      id,
      name: id,
      field: "Campo",
      lat: -34,
      lon: -63,
      status: "PENDIENTE",
      road: "DESCONOCIDO",
    },
    days: [],
    cluster: a.key,
    nearby: 0,
  }));
  const hiddenByOldFilter = workWindowSummary(
    [a],
    "2026-11-30",
    "2026-12-06",
    50,
  );
  const visible = workWindowSummary([a], "2026-11-30", "2026-12-06");
  const rows = listPossibleWindows(plans, [a], "2026-11-30", "2026-12-06");
  assert.equal(hiddenByOldFilter.expectedWindows, 0);
  assert.ok(Math.abs(visible.expectedWindows - 2.8) < 1e-9);
  assert.equal(visible.equipmentWithWindow, 2);
  assert.equal(visible.percent, 100);
  assert.equal(rows.length, 4);
  assert.equal(
    rows.reduce((total, row) => total + row.expectedWindows, 0),
    visible.expectedWindows,
  );
  assert.deepEqual(
    rows.map((row) => row.probability),
    [30, 30, 40, 40],
  );
  assert.equal(
    listPossibleWindows(
      [{ ...plans[0], pivot: { ...plans[0].pivot, status: "TERMINADO" } }],
      [a],
      "2026-11-30",
      "2026-12-06",
    ).length,
    0,
  );
});

test("low probability is preserved and adding equipment cannot inflate the per-equipment estimate", () => {
  const one = zone(1, [day("2026-11-02", 0.1, 0.2)]);
  const many = { ...one, pending: 145 };
  const first = workWindowSummary([one], "2026-11-02", "2026-11-02");
  const fleet = workWindowSummary([many], "2026-11-02", "2026-11-02");
  assert.equal(first.expectedWindowsPerEquipment, 0.2);
  assert.equal(fleet.expectedWindowsPerEquipment, 0.2);
  assert.equal(fleet.expectedWindows, 29);
  const unknown = zone(2, [day("2026-11-02", null, null)]);
  assert.equal(
    workWindowSummary([many, unknown], "2026-11-02", "2026-11-02")
      .expectedWindowsPerEquipment,
    null,
  );
});

test("weekly display counts days per zone, distinguishes unknown from zero, and does not use equipment counts", async () => {
  const { workDaySummary, estimatedDaysText, workDayLabel } =
    await import("../src/domain/work-windows");
  const days = Array.from({ length: 7 }, (_, i) =>
    day(`2026-11-0${i + 1}`, 0.23, 0.46),
  );
  const one = zone(1, days),
    many = zone(145, days);
  assert.ok(
    Math.abs(
      workDaySummary([one, many], "2026-11-01", "2026-11-07").expectedDays! -
        1.61,
    ) < 1e-9,
  );
  assert.equal(estimatedDaysText(1.61), "2");
  assert.equal(
    workDaySummary(
      [{ ...one, days: days.slice(0, 6) }],
      "2026-11-01",
      "2026-11-07",
    ).expectedDays,
    null,
  );
  assert.equal(
    workDaySummary(
      [zone(1, [day("2026-11-01", 0, 0)])],
      "2026-11-01",
      "2026-11-01",
    ).expectedDays,
    0,
  );
  assert.equal(workDayLabel(0.9, true), "Volver a revisar más cerca");
});
