import { test } from "node:test";
import assert from "node:assert/strict";
import { historyDay, historyPeriod } from "../src/domain/history-outlook";
import { buildPlanningReport } from "../src/domain/planning-report";
import { reportDates, ReportState } from "../src/domain/opportunity-report";
import { defaultRules } from "../src/domain/types";
import {
  HistoricalClimate,
  rulesSignature,
  cellKey,
} from "../src/domain/evidence";
const rules = { ...defaultRules };
const now = new Date("2026-10-20T15:00Z"),
  dates = reportDates("2026-10-21", "2026-12-31");
const key = cellKey(-34.24, -61.32);
function history(): HistoricalClimate {
  const years = Array.from({ length: 10 }, (_, i) => 2016 + i);
  return {
    key,
    lat: -34.24,
    lon: -61.32,
    rulesSignature: rulesSignature(rules),
    fetchedAt: now.toISOString(),
    years,
    days: Object.fromEntries(
      years.flatMap((year, i) =>
        dates.map((date) => [`${year}${date.slice(4)}`, i < 6 ? 1 : 0]),
      ),
    ),
    monthly: {},
    source: "test ERA5",
  };
}
function state(): ReportState {
  return {
    rules,
    pivots: [
      {
        id: "a",
        name: "Equipo A",
        field: "Centro",
        region: "Centro",
        lat: -34.24,
        lon: -61.32,
        status: "PENDIENTE",
        road: "DESCONOCIDO",
      },
    ],
    forecasts: {},
    climate: { [key]: history() },
    ensembles: {
      [key]: {
        key,
        lat: -34.24,
        lon: -61.32,
        rulesSignature: rulesSignature(rules),
        fetchedAt: now.toISOString(),
        windows: [],
        sources: [],
        errors: [],
        nativeResolution: "test",
        paths: ["A", "B"].flatMap((family) =>
          Array.from({ length: 20 }, (_, i) => ({
            family,
            member: String(i),
            days: Object.fromEntries(
              dates.slice(0, 6).map((date) => [date, i < 16 ? 1 : 0]),
            ),
          })),
        ),
      },
    },
  };
}
test("historical frequencies require actual matching rule labels and at least ten years", () => {
  const h = history();
  assert.equal(historyDay(h, rules, "2026-10-27")!.probability, 0.6);
  h.years.pop();
  assert.equal(historyDay(h, rules, "2026-10-27"), null);
  assert.equal(
    historyDay(history(), { ...rules, wind: 12 }, "2026-10-27"),
    null,
  );
  assert.equal(historyDay(undefined, rules, "2026-10-27"), null);
});
test("weekly history samples entire years instead of pretending dry days are independent", () => {
  const result = historyPeriod(history(), rules, dates.slice(0, 7))!;
  assert.ok(Math.abs(result.expected - 4.2) < 1e-10);
  assert.deepEqual(result.range, [0, 7]);
  assert.equal(result.years, 10);
  const h = history();
  h.days["2020-10-21"] = null;
  assert.equal(historyPeriod(h, rules, dates.slice(0, 7)), null);
});
test("fills the October 27 gap and campaign total with explicitly marked history while retaining the near-term forecast", () => {
  const z = buildPlanningReport(state(), now).zones[0];
  assert.equal(z.daily[0].source, "pronóstico");
  assert.equal(z.daily[0].probability, 0.8);
  const day = z.daily.find((d) => d.date === "2026-10-27")!;
  assert.equal(day.source, "histórico");
  assert.equal(day.probability, 0.6);
  assert.equal(day.historyYears, 10);
  assert.equal(day.forecastSupported, false);
  assert.deepEqual(day.windows, []);
  assert.equal(z.weekly[0].historicalDays, 1);
  assert.ok(Math.abs(z.weekly[0].expectedDays! - 5.4) < 1e-10);
  assert.ok(Math.abs(z.remaining.expectedDays! - (6 * 0.8 + 66 * 0.6)) < 1e-8);
  assert.equal(z.remaining.covered, 72);
  assert.equal(z.remaining.historicalDays, 66);
  assert.equal(z.weekly[1].historicalReference!.years, 10);
});
test("uses a valid seasonal forecast before history and never invents a campaign total without data", () => {
  const s = state();
  s.seasonal = {
    [key]: {
      key,
      lat: -34.24,
      lon: -61.32,
      rulesSignature: rulesSignature(rules),
      fetchedAt: now.toISOString(),
      years: [],
      method: "test",
      errors: [],
      days: {
        "2026-10-27": {
          source: "EC46",
          probability: 0.7,
          slots: 1,
          wind: 10,
          rain: 0,
          members: 51,
        },
      },
    },
  };
  assert.equal(
    buildPlanningReport(s, now).zones[0].daily.find(
      (d) => d.date === "2026-10-27",
    )!.source,
    "subestacional",
  );
  delete s.climate;
  delete s.seasonal;
  const z = buildPlanningReport(s, now).zones[0];
  assert.equal(z.remaining.expectedDays, null);
  assert.ok(Math.abs(z.remaining.partialExpectedDays! - 4.8) < 1e-10);
  assert.equal(z.remaining.covered, 6);
});
