import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateOperationalWindows } from "../src/domain/windows";
import {
  defaultRules,
  Hour,
  localDate,
  addDays,
  Pivot,
  WeatherForecast,
} from "../src/domain/types";
import {
  dailyCapacity,
  trainCalibration,
  EnsembleAssessment,
  rulesSignature,
  alignHourlyIntervals,
} from "../src/domain/evidence";
import { parseEnsemble } from "../src/providers/research";
import { weightedSurface } from "../src/domain/map-layer";
import { simulateCampaign } from "../src/domain/simulation";
import { buildPlans } from "../src/domain/planning";
const date = addDays(localDate(), 1);
const h = (wind = 5): Hour[] =>
  Array.from({ length: 24 }, (_, i) => ({
    time: date + "T" + String(i).padStart(2, "0") + ":00",
    wind,
    gust: 10,
    rain: 0,
    soil: 0.2,
  }));
const previous = () =>
  h().map((hour) => ({
    ...hour,
    time: addDays(date, -1) + hour.time.slice(10),
    wind: null,
  }));
const withPrevious = (hours: Hour[]) => [...previous(), ...hours];

test("ensemble probabilities weight families equally regardless of member count", () => {
  const f: WeatherForecast = {
    fetchedAt: new Date().toISOString(),
    source: "test",
    errors: [],
    models: [
      ...Array.from({ length: 51 }, (_, i) => ({
        model: "A" + i,
        family: "A",
        kind: "ensemble" as const,
        hours: withPrevious(h(5)),
      })),
      ...Array.from({ length: 31 }, (_, i) => ({
        model: "B" + i,
        family: "B",
        kind: "ensemble" as const,
        hours: withPrevious(h(25)),
      })),
    ],
  };
  const w = calculateOperationalWindows(f, defaultRules)[0];
  assert.equal(w.probability, 50);
  assert.equal(w.families, 2);
  assert.equal(w.members, 82);
});

test("provider accumulations are aligned to interval starts, without crossing gaps", () => {
  const original = h().map((hour, i) => ({ ...hour, rain: i, gust: i + 5 }));
  const aligned = alignHourlyIntervals(original);
  assert.equal(aligned[0].rain, 1);
  assert.equal(aligned[0].gust, 6);
  assert.equal(aligned.at(-1)!.rain, null);
  const gap = alignHourlyIntervals([original[0], original[2]]);
  assert.equal(gap[0].rain, null);
});
test("missing gusts do not prevent evaluating wind and rain", () => {
  const input = [
    ...withPrevious(h()),
    { ...h()[0], time: addDays(date, 1) + "T00:00" },
  ];
  const raw = {
    time: input.map((h) => h.time),
    wind_speed_10m: input.map((h) => h.wind),
    precipitation: input.map((h) => h.rain),
  };
  const models = parseEnsemble(raw, "ICON");
  assert.equal(models[0].hours[0].gust, null);
  assert.equal(
    calculateOperationalWindows(
      {
        source: "test",
        fetchedAt: new Date().toISOString(),
        models,
        errors: [],
      },
      defaultRules,
    ).length,
    1,
  );
  assert.equal(
    dailyCapacity(
      models[0].hours.filter((h) => h.time.startsWith(date)),
      defaultRules,
      previous(),
    ),
    3,
  );
});
test("strong gusts do not veto continuous wind and rain windows", () => {
  const hours = h().map((hour) => ({ ...hour, gust: 150 }));
  assert.equal(dailyCapacity(hours, defaultRules, previous()), 3);
  assert.equal(
    calculateOperationalWindows(
      {
        fetchedAt: new Date().toISOString(),
        source: "test",
        errors: [],
        models: [{ model: "test", hours: withPrevious(hours) }],
      },
      defaultRules,
    ).length,
    1,
  );
  const oldRules = { ...defaultRules, gust: 22 };
  const otherOldRules = { ...oldRules, gust: 40 };
  assert.equal(rulesSignature(oldRules), rulesSignature(otherOldRules));
});

test("heat interpolation is bounded and duplicate coordinates do not inflate probability", () => {
  const p = { x: 0, y: 0, radius: 20, value: 40 };
  assert.equal(weightedSurface([p], 30, 0), null);
  assert.equal(weightedSurface([p, p], 0, 0)?.value, 40);
});
test("calibration refuses insufficient observations and single-class training sets", () => {
  assert.equal(trainCalibration([]).ready, false);
  const rows = Array.from({ length: 250 }, (_, i) => ({
    id: String(i),
    pivotId: "p",
    issuedAt: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
    validAt: new Date(Date.UTC(2025, 0, i + 2)).toISOString(),
    probability: 0.7,
    operable: true,
    source: "ensayo",
  }));
  assert.equal(trainCalibration(rows).ready, false);
});
test("Monte Carlo completes each unique pivot at most once and is reproducible", () => {
  const p: Pivot = {
    id: "a",
    name: "A",
    field: "F",
    lat: -34,
    lon: -63,
    status: "PENDIENTE",
    road: "APTO",
  };
  const r = { ...defaultRules, crews: 1, jobsPerCrew: 2, deadline: date };
  const e: EnsembleAssessment = {
    key: "-34,-63",
    lat: -34,
    lon: -63,
    fetchedAt: new Date().toISOString(),
    rulesSignature: rulesSignature(r),
    windows: [],
    paths: [
      { family: "A", member: "1", days: { [localDate()]: 2, [date]: 2 } },
    ],
    sources: [{ family: "A", members: 1, usableMembers: 1 }],
    errors: [],
    nativeResolution: "test",
  };
  const plans = buildPlans([p], {}, r);
  const a = simulateCampaign(plans, r, { "-34,-63": e }, {}, 100, 11),
    b = simulateCampaign(plans, r, { "-34,-63": e }, {}, 100, 11);
  assert.equal(a.completedP90, 1);
  assert.equal(a.probability, 100);
  assert.deepEqual(a, b);
});
test("rare favorable members do not become a recommendation due to cluster density", () => {
  const p: Pivot = {
    id: "p",
    name: "P",
    field: "F",
    lat: -34,
    lon: -63,
    status: "PENDIENTE",
    road: "APTO",
  };
  const models = Array.from({ length: 100 }, (_, i) => ({
    model: String(i),
    family: "A",
    kind: "ensemble" as const,
    hours: withPrevious(h(i === 0 ? 5 : 30)),
  }));
  const windows = calculateOperationalWindows(
    { models, source: "test", errors: [], fetchedAt: new Date().toISOString() },
    defaultRules,
  );
  const e: EnsembleAssessment = {
    key: "-34,-63",
    lat: -34,
    lon: -63,
    fetchedAt: new Date().toISOString(),
    rulesSignature: rulesSignature(defaultRules),
    windows,
    paths: [{ family: "A", member: "1", days: { [date]: 1 } }],
    sources: [{ family: "A", members: 100, usableMembers: 100 }],
    errors: [],
    nativeResolution: "test",
  };
  const plan = buildPlans([p], {}, defaultRules, { "-34,-63": e })[0];
  assert.equal(plan.days.find((d) => d.date === date)?.priority, 0);
  assert.equal(plan.days.find((d) => d.date === date)?.condition, "NO APTO");
});
