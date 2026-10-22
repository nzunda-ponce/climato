import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitBoosting,
  calibrateModel,
  evaluateModel,
  type TrainingRow,
} from "../src/ml/gradient-boosting";
import { boostedProbability, modelVector } from "../src/domain/boosted-model";
import { weatherFeatures } from "../src/domain/ml-features";
import { trainClimateModels, temporalSplits } from "../src/ml/train-climate";
import {
  compatibleMachineLearning,
  mlCalendarProbability,
} from "../src/domain/machine-learning";
import { defaultRules, addDays } from "../src/domain/types";
import { rulesSignature, type HistoricalClimate } from "../src/domain/evidence";
import { modelDiagnostics } from "../src/ml/model-diagnostics";

function sampleRows(count: number, seed: number): TrainingRow[] {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const x = random() * 2 - 1,
      y = random() * 2 - 1;
    return {
      date: `2020-11-${i}`,
      values: [x, y],
      target: (x > 0 && y < 0) || (x < 0 && y > 0) ? 1 : 0,
      baseline: 0.5,
    };
  });
}

test("boosted trees learn nonlinear interactions on unseen samples and survive serialization", () => {
  const train = sampleRows(800, 3),
    tune = sampleRows(200, 9),
    calibration = sampleRows(200, 18),
    testRows = sampleRows(400, 27);
  const fitted = fitBoosting(train, tune, ["wind", "rain"], {
    depth: 3,
    trees: 60,
    minLeaf: 10,
  });
  const model = calibrateModel(fitted.model, calibration);
  const score = evaluateModel(model, testRows);
  assert.ok(score.brier! < 0.1, JSON.stringify(score));
  assert.ok(score.skill! > 0.5);
  const roundTrip = JSON.parse(JSON.stringify(model));
  assert.equal(
    boostedProbability(model, [0.5, -0.5]),
    boostedProbability(roundTrip, [0.5, -0.5]),
  );
  for (const row of testRows) {
    const p = boostedProbability(model, row.values);
    assert.ok(p >= 0 && p <= 1);
  }
  assert.ok(
    Math.abs(
      fitted.importance.reduce((sum, feature) => sum + feature.gain, 0) - 1,
    ) < 1e-10,
  );
});

test("missing inputs have indicators and imputation uses training data only", () => {
  assert.deepEqual(modelVector([0, null], [99, 4]), [0, 4, 0, 1]);
  const rows = sampleRows(100, 7);
  rows.forEach((row) => (row.values[1] = null));
  const fitted = fitBoosting(rows, sampleRows(50, 8), ["wind", "rain"], {
    depth: 2,
    trees: 5,
    minLeaf: 5,
  });
  assert.equal(fitted.model.medians[1], 0);
  assert.ok(Number.isFinite(boostedProbability(fitted.model, [null, null])));
});

test("lagged predictors read only earlier days and never accept target labels as features", () => {
  const reads: string[] = [];
  const values = weatherFeatures(
    "2026-11-10",
    { wind: 12, rain: 0, previousRain: 0 },
    (date) => {
      reads.push(date);
      return undefined;
    },
  );
  assert.ok(reads.every((date) => date < "2026-11-10"));
  assert.equal(values.length, 12);
  assert.equal(values[5], 12);
  assert.equal(values[6], 0);
  assert.equal(values[7], 0);
  assert.equal(values[8], null);
  assert.equal(values[9], null);
  assert.equal(values[10], null);
  assert.equal(values[11], null);
});

function historyFixture(): HistoricalClimate {
  const years = Array.from({ length: 21 }, (_, i) => 2005 + i),
    days: HistoricalClimate["days"] = {},
    features: NonNullable<HistoricalClimate["features"]> = [];
  for (const year of years) {
    let previousRain = 0;
    const rainHistory: number[] = [];
    for (
      let date = `${year}-10-01`;
      date <= `${year}-12-31`;
      date = addDays(date, 1)
    ) {
      const day = Math.floor(
        (Date.parse(date + "T12:00Z") - Date.parse(`${year}-10-01T12:00Z`)) /
          86400000,
      );
      const wind = 8 + ((day * 7 + year * 13) % 24),
        rain = (day * 11 + year) % 9 < 4 ? 0 : ((day + year) % 7) + 1;
      const slots =
        wind < 19 &&
        rainHistory.slice(-3).reduce((sum, v) => sum + v, 0) < 13 &&
        rain < 5
          ? 1
          : 0;
      days[date] = slots;
      features.push({ date, wind, rain, previousRain, slots });
      previousRain = rain;
      rainHistory.push(rain);
    }
  }
  return {
    key: "test",
    lat: -37,
    lon: -60,
    fetchedAt: "2026-10-21T12:00Z",
    rulesSignature: rulesSignature(defaultRules),
    years,
    days,
    features,
    monthly: {},
    source: "Synthetic test fixture",
  };
}

test("future test labels cannot change fitted trees, calibration, or temporal splits", () => {
  const history = historyFixture();
  const artifact = trainClimateModels(history, 2026);
  const diagnostics = modelDiagnostics({...history, machineLearning: artifact}, 0.7)!;
  for (const name of ["weather", "calendar"] as const) {
    assert.equal(diagnostics[name].matchesSavedCount, true);
    assert.equal(diagnostics[name].model.count, artifact[name].test.count);
    assert.ok(Math.abs(diagnostics[name].model.brier! - artifact[name].test.brier!) < 1e-12);
    assert.ok(Math.abs(diagnostics[name].baseline.brier! - artifact[name].test.baselineBrier!) < 1e-12);
  }
  const altered = structuredClone(history);
  altered.features![0].wind += 1;
  assert.equal(modelDiagnostics({...altered, machineLearning: artifact}, 0.7), null);
  const changed = structuredClone(history);
  for (const date of Object.keys(changed.days))
    if (Number(date.slice(0, 4)) >= 2021)
      changed.days[date] = 1 - changed.days[date]!;
  for (const row of changed.features!)
    if (Number(row.date.slice(0, 4)) >= 2021) row.slots = 1 - row.slots;
  const second = trainClimateModels(changed, 2026);
  assert.deepEqual(artifact.splits, second.splits);
  assert.deepEqual(artifact.weather.model, second.weather.model);
  assert.deepEqual(artifact.calendar.model, second.calendar.model);
  assert.notEqual(artifact.weather.test.brier, second.weather.test.brier);
  assert.notEqual(artifact.fingerprint, second.fingerprint);
  assert.ok(
    Math.max(...artifact.splits.train) < Math.min(...artifact.splits.tune),
  );
  assert.ok(
    Math.max(...artifact.splits.tune) <
      Math.min(...artifact.splits.calibration),
  );
  assert.ok(
    Math.max(...artifact.splits.calibration) <
      Math.min(...artifact.splits.test),
  );
  const compatible = { ...history, machineLearning: artifact };
  assert.equal(compatibleMachineLearning(compatible), artifact);
  assert.equal(
    compatibleMachineLearning({ ...compatible, fetchedAt: "changed" }),
    null,
  );
  assert.equal(
    compatibleMachineLearning({ ...compatible, rulesSignature: "changed" }),
    null,
  );
  const accepted = {
    ...compatible,
    machineLearning: {
      ...artifact,
      calendar: { ...artifact.calendar, accepted: true },
    },
  };
  assert.equal(mlCalendarProbability(accepted, "2016-11-01"), null);
  assert.ok(mlCalendarProbability(accepted, "2026-11-01")!.probability >= 0);
  assert.throws(() => temporalSplits([2000, 2001]), /21 años/);
});
