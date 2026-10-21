import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ClimateMachineLearning,
  TrainedEstimator,
} from "../src/domain/boosted-model";
import {
  mlWeatherProbability,
  mlCalendarProbability,
} from "../src/domain/machine-learning";
import { buildPlanningReport } from "../src/domain/planning-report";
import { defaultRules, addDays } from "../src/domain/types";
import {
  cellKey,
  rulesSignature,
  type HistoricalClimate,
} from "../src/domain/evidence";
const key = cellKey(-37, -60),
  now = new Date("2026-10-21T12:00Z");
function fixture() {
  // Constant fitted trees isolate routing/provenance from statistical quality.
  const estimator = (dimensions: number): TrainedEstimator => ({
    accepted: true,
    model: {
      baseScore: 0,
      learningRate: 0.07,
      trees: [{ value: 0 }],
      medians: Array(dimensions).fill(0),
      featureNames: Array.from({ length: dimensions }, (_, i) => String(i)),
      calibration: { slope: 1, intercept: 0 },
    },
    tune: {
      count: 200,
      brier: 0.1,
      logLoss: 0.2,
      baselineBrier: 0.2,
      skill: 0.5,
    },
    calibration: {
      count: 200,
      brier: 0.1,
      logLoss: 0.2,
      baselineBrier: 0.2,
      skill: 0.5,
    },
    test: {
      count: 400,
      brier: 0.1,
      logLoss: 0.2,
      baselineBrier: 0.2,
      skill: 0.5,
    },
    importance: [],
  });
  const artifact: ClimateMachineLearning = {
    version: "climato-gbdt-v1",
    rulesSignature: rulesSignature(defaultRules),
    sourceFetchedAt: now.toISOString(),
    fingerprint: "modelA",
    trainedAt: now.toISOString(),
    samples: 1932,
    positiveSlotsMean: 1,
    splits: {
      train: Array.from({ length: 10 }, (_, i) => 2005 + i),
      tune: [2015, 2016, 2017],
      calibration: [2018, 2019, 2020],
      test: [2021, 2022, 2023, 2024, 2025],
    },
    weather: estimator(12),
    calendar: estimator(5),
    label: "Inference fixture",
  };
  const h: HistoricalClimate = {
    key,
    lat: -37,
    lon: -60,
    years: Array.from({ length: 21 }, (_, i) => 2005 + i),
    fetchedAt: now.toISOString(),
    rulesSignature: rulesSignature(defaultRules),
    source: "Synthetic inference fixture",
    monthly: {},
    days: {},
    machineLearning: artifact,
  };
  for (const year of h.years)
    for (
      let date = `${year}-10-01`;
      date <= `${year}-12-31`;
      date = addDays(date, 1)
    )
      h.days[date] = 1;
  return h;
}
test("inference rejects pre-calibration dates, stale sources, and missing required weather", () => {
  const h = fixture();
  assert.equal(
    mlWeatherProbability(
      h,
      "2026-11-01",
      { wind: 12, rain: 0, previousRain: 0 },
      () => undefined,
    )!.probability,
    0.5,
  );
  assert.equal(
    mlWeatherProbability(
      h,
      "2016-11-01",
      { wind: 12, rain: 0 },
      () => undefined,
    ),
    null,
  );
  assert.equal(
    mlWeatherProbability(
      h,
      "2026-11-01",
      { wind: null, rain: 0 },
      () => undefined,
    ),
    null,
  );
  assert.equal(
    mlCalendarProbability({ ...h, fetchedAt: "changed" }, "2026-11-01"),
    null,
  );
});
test("report applies matching models but excludes seasonal results from incompatible model fingerprints", () => {
  const history = fixture();
  const state = {
    rules: { ...defaultRules },
    pivots: [
      {
        id: "e",
        name: "BE1",
        field: "Test",
        lat: -37,
        lon: -60,
        status: "PENDIENTE" as const,
        road: "DESCONOCIDO" as const,
      },
    ],
    forecasts: {},
    climate: { [key]: history },
    seasonal: {
      [key]: {
        key,
        lat: -37,
        lon: -60,
        fetchedAt: now.toISOString(),
        rulesSignature: history.rulesSignature,
        days: {
          "2026-10-23": {
            source: "SEAS5" as const,
            probability: 0.9,
            slots: 1,
            wind: 12,
            rain: 0,
            members: 51,
          },
        },
        years: history.years,
        method: "climato-gbdt-v1 [other]",
        mlFingerprint: "other",
        errors: [],
      },
    },
  };
  let zone = buildPlanningReport(state, now).zones[0];
  assert.equal(
    zone.outlook.find((d) => d.date === "2026-10-23")!.source,
    "histórico",
  );
  assert.equal(
    zone.outlook.find((d) => d.date === "2026-10-23")!.probability,
    0.5,
  );
  state.seasonal[key].mlFingerprint = "modelA";
  state.seasonal[key].method = "climato-gbdt-v1 [modelA]";
  zone = buildPlanningReport(state, now).zones[0];
  assert.equal(
    zone.outlook.find((d) => d.date === "2026-10-23")!.probability,
    0.9,
  );
  assert.equal(zone.machineLearning?.status, "trained");
  assert.equal(
    zone.machineLearning?.status === "trained" &&
      zone.machineLearning.weatherApplied,
    true,
  );
  assert.ok(!JSON.stringify(zone.machineLearning).includes("baseScore"));
  state.rules.wind++;
  zone = buildPlanningReport(state, now).zones[0];
  assert.equal(zone.machineLearning, null);
  assert.equal(
    zone.outlook.find((d) => d.date === "2026-10-23")!.probability,
    null,
  );
});
