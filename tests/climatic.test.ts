import { test } from "node:test";
import assert from "node:assert/strict";
import { climatePotential, periodPotential } from "../src/domain/climatic";
import { defaultRules, PivotPlan } from "../src/domain/types";
import {
  EnsembleAssessment,
  HistoricalClimate,
  rulesSignature,
} from "../src/domain/evidence";
import { SeasonalAssessment } from "../src/domain/seasonal";
const rules = { ...defaultRules, deadline: "2026-10-18" };
const today = "2026-10-15",
  now = Date.parse("2026-10-15T12:00:00Z");
const plan: PivotPlan = {
  pivot: {
    id: "a",
    name: "A",
    field: "Campo",
    lat: -34,
    lon: -63,
    province: "Córdoba",
    road: "NO APTO",
    status: "PENDIENTE",
  },
  days: [],
  cluster: "A",
  nearby: 0,
};
const history: HistoricalClimate = {
  key: "-34,-63",
  lat: -34,
  lon: -63,
  fetchedAt: "2026-10-15",
  rulesSignature: rulesSignature(rules),
  years: [2021, 2022, 2023],
  days: Object.fromEntries(
    [2021, 2022, 2023].flatMap((y) => [
      [`${y}-10-16`, 1],
      [`${y}-10-17`, 0],
      [`${y}-10-18`, 2],
    ]),
  ),
  monthly: {},
  source: "test",
};
const ensemble: EnsembleAssessment = {
  key: history.key,
  lat: -34,
  lon: -63,
  fetchedAt: "2026-10-15T11:00:00Z",
  rulesSignature: rulesSignature(rules),
  paths: [
    { family: "a", member: "1", days: { "2026-10-16": 0 } },
    { family: "b", member: "1", days: { "2026-10-16": 2 } },
    { family: "b", member: "2", days: { "2026-10-16": 2 } },
  ],
  windows: [],
  sources: [],
  errors: [],
  nativeResolution: "test",
};
const seasonal: SeasonalAssessment = {
  key: history.key,
  lat: -34,
  lon: -63,
  fetchedAt: "2026-10-15T11:00:00Z",
  rulesSignature: rulesSignature(rules),
  years: [1981, 2025],
  method: "test",
  errors: [],
  days: {
    "2026-10-16": {
      probability: 0.2,
      slots: 0.4,
      wind: 10,
      rain: 0,
      members: 51,
      source: "EC46",
    },
    "2026-10-17": {
      probability: 0.3,
      slots: 0.6,
      wind: 12,
      rain: 0,
      members: 51,
      source: "EC46",
    },
    "2026-10-18": {
      probability: 0.7,
      slots: 1.4,
      wind: 8,
      rain: 0,
      members: 51,
      source: "SEAS5",
    },
  },
};
test("climate potential weights families equally, counts each date once, ignores access and crews", () => {
  const result = climatePotential(
    [plan],
    rules,
    { [history.key]: ensemble },
    { [history.key]: history },
    today,
    now,
    { [history.key]: seasonal },
  );
  const p = periodPotential(result.zones[0], result.start, result.end);
  assert.equal(p.expectedDays, 1.5);
  assert.equal(p.slots, 3);
  assert.equal(p.forecast, 1);
  assert.equal(p.subseasonal, 1);
  assert.equal(p.seasonal, 1);
  assert.equal(p.total, 3);
  const other = climatePotential(
    [plan],
    { ...rules, crews: 90 },
    { [history.key]: ensemble },
    { [history.key]: history },
    today,
    now,
    { [history.key]: seasonal },
  );
  assert.deepEqual(other.zones, result.zones);
});
test("expired ensembles use dynamic seasonal forecasts; history never substitutes a forecast", () => {
  const stale = { ...ensemble, fetchedAt: "2026-10-14T00:00:00Z" };
  const result = climatePotential(
    [plan],
    rules,
    { [history.key]: stale },
    { [history.key]: history },
    today,
    now,
    { [history.key]: seasonal },
  );
  assert.equal(
    periodPotential(result.zones[0], result.start, result.end).expectedDays,
    1.2,
  );
  const missing = climatePotential(
    [plan],
    rules,
    {},
    { [history.key]: history },
    today,
    now,
  );
  assert.equal(
    periodPotential(missing.zones[0], missing.start, missing.end).expectedDays,
    null,
  );
  assert.equal(
    periodPotential(missing.zones[0], missing.start, missing.end).covered,
    0,
  );
});
test("shared weather cells do not duplicate days; finished or invalid locations do not contribute", () => {
  const second = { ...plan, pivot: { ...plan.pivot, id: "b" } };
  const invalid = {
    ...plan,
    locationWarning: "Revisar coordenadas",
    pivot: { ...plan.pivot, id: "bad" },
  };
  const result = climatePotential(
    [
      plan,
      second,
      invalid,
      { ...plan, pivot: { ...plan.pivot, id: "done", status: "TERMINADO" } },
    ],
    rules,
    {},
    { [history.key]: history },
    today,
    now,
    { [history.key]: seasonal },
  );
  assert.equal(result.zones.length, 1);
  assert.equal(result.zones[0].pending, 2);
  assert.equal(result.excluded, 1);
  assert.equal(
    periodPotential(result.zones[0], result.start, result.end).expectedDays,
    1.2,
  );
  assert.deepEqual(result.zones[0].historicalRange, [2, 2]);
});
