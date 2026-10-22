import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingHistoryCoverage } from "../src/ml/history-coverage";
import {
  cellKey,
  rulesSignature,
  type HistoricalClimate,
} from "../src/domain/evidence";
import { defaultRules, type Pivot } from "../src/domain/types";

const pivot: Pivot = {
  id: "a",
  name: "BE1",
  field: "Campo",
  lat: -34,
  lon: -61,
  status: "PENDIENTE",
  road: "DESCONOCIDO",
};
const key = cellKey(pivot.lat, pivot.lon);
const history: HistoricalClimate = {
  key,
  lat: pivot.lat,
  lon: pivot.lon,
  fetchedAt: "2026-10-22T00:00:00Z",
  rulesSignature: rulesSignature(defaultRules),
  years: Array.from({ length: 45 }, (_, i) => 1981 + i),
  days: {},
  monthly: {},
  source: "ERA5",
};

test("full-history gate counts exact seasons and unique active coordinates", () => {
  const result = trainingHistoryCoverage(
    {
      pivots: [
        pivot,
        { ...pivot, id: "b" },
        { ...pivot, id: "done", lat: -35, status: "TERMINADO" },
      ],
      rules: defaultRules,
      climate: { [key]: history },
    },
    45,
    2025,
  );
  assert.equal(result.locations, 1);
  assert.equal(result.complete, 1);
  assert.equal(result.missingSeasons, 0);
  assert.equal(result.years[0], 1981);
  assert.equal(result.years.at(-1), 2025);
});

test("45 arbitrary years cannot pass when a target season is missing", () => {
  const result = trainingHistoryCoverage(
    {
      pivots: [pivot],
      rules: defaultRules,
      climate: {
        [key]: { ...history, years: [1980, ...history.years.slice(1)] },
      },
    },
    45,
    2025,
  );
  assert.equal(result.complete, 0);
  assert.equal(result.missingSeasons, 1);
});

test("missing or incompatible histories block training even if another location is complete", () => {
  const result = trainingHistoryCoverage(
    {
      pivots: [pivot, { ...pivot, id: "b", lat: -35 }],
      rules: defaultRules,
      climate: { [key]: { ...history, rulesSignature: "old-rules" } },
    },
    45,
    2025,
  );
  assert.equal(result.locations, 2);
  assert.equal(result.complete, 0);
  assert.equal(result.missingSeasons, 90);
});
