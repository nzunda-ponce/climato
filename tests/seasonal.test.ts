import { test } from "node:test";
import assert from "node:assert/strict";
import { analogueModel, parseRoni, ForecastGrid } from "../src/domain/seasonal";
import {
  createGridSampler,
  weatherColor,
  RAIN_COLORS,
  weatherPeriodDays,
} from "../src/domain/weather-grid";
import { syncPivots } from "../src/domain/sync-pivots";
import { Pivot } from "../src/domain/types";
test("rain legend matches the rendered scale, starts neutral and clamps extreme rainfall", () => {
  const dry = weatherColor(0, "rain");
  assert.ok(Math.max(...dry) - Math.min(...dry) < 10);
  for (const [amount, r, g, b] of RAIN_COLORS) {
    assert.deepEqual(weatherColor(amount, "rain"), [r, g, b]);
  }
  assert.deepEqual(weatherColor(-1, "rain"), dry);
  assert.deepEqual(weatherColor(200, "rain"), weatherColor(50, "rain"));
  assert.notDeepEqual(weatherColor(0.2, "rain"), dry);
});

test("weekly accumulations use a matching weekly color scale rather than daily saturation", () => {
  const days = weatherPeriodDays("2026-11-02", "2026-11-08");
  assert.equal(days, 7);
  assert.deepEqual(weatherColor(35, "rain", days), weatherColor(5, "rain"));
  assert.notDeepEqual(weatherColor(35, "rain", days), weatherColor(35, "rain"));
  assert.deepEqual(weatherColor(350, "rain", days), weatherColor(50, "rain"));
  assert.equal(weatherPeriodDays("2026-12-28", "2026-12-31"), 4);
  assert.deepEqual(weatherColor(0, "rain", days), weatherColor(0, "rain"));
});
test("RONI only labels historical episodes after five consecutive seasonal thresholds", () => {
  const html = Array.from({ length: 60 }, (_, i) => {
    const year = 1950 + i;
    const values = Array.from({ length: 12 }, (_, m) =>
      year === 1982 && m < 6 ? 1 : year === 1983 && m < 4 ? -1 : 0,
    );
    return `<tr><td>${year}</td>${values.map((v) => `<td><b>${v}</b></td>`).join("")}</tr>`;
  }).join("");
  const data = parseRoni(html);
  assert.equal(data.phases["1982-03"], "Niño");
  assert.equal(data.phases["1983-03"], "Neutral");
  assert.equal(data.phases["1982-08"], "Neutral");
});
test("analogue predictions respond to forecast conditions rather than repeating a monthly average", () => {
  const rows = Array.from({ length: 180 }, (_, i) => ({
    date: `${1981 + Math.floor(i / 30)}-10-${String((i % 30) + 1).padStart(2, "0")}`,
    wind: i % 30 < 15 ? 5 : 30,
    rain: 0,
    slots: i % 30 < 15 ? 2 : 0,
  }));
  const model = analogueModel(rows),
    calm = model("10", 5, 0),
    windy = model("10", 30, 0);
  assert.ok(
    calm && windy && calm.probability > 0.99 && windy.probability < 0.01,
  );
  assert.equal(model("11", 5, 0), null);
});
test("regular-grid heat interpolation requires all real corners and never extrapolates", () => {
  const grid: ForecastGrid = {
    fetchedAt: "2026-10-15",
    start: "2026-10-16",
    end: "2026-10-16",
    step: 1,
    bounds: { south: -35, north: -34, west: -64, east: -63 },
    nodes: [
      [-35, -64, 0],
      [-35, -63, 10],
      [-34, -64, 20],
      [-34, -63, 30],
    ].map(([lat, lon, wind]) => ({
      lat,
      lon,
      days: { "2026-10-16": { wind, rain: 0, u: 0, v: 0 } },
    })),
    model: "test",
    errors: [],
  };
  const sample = createGridSampler(grid, "2026-10-16", "2026-10-16", "wind");
  assert.equal(sample(-34.5, -63.5), 15);
  assert.equal(sample(-33, -63.5), null);
  assert.equal(sample(-34, -63), 30);
  assert.equal(
    createGridSampler(
      { ...grid, nodes: grid.nodes.slice(1) },
      "2026-10-16",
      "2026-10-16",
      "wind",
    )(-34.5, -63.5),
    null,
  );
});

test("rain maps accumulate a period without averaging one rainy day into every day", () => {
  const grid: ForecastGrid = {
    fetchedAt: "2026-10-16",
    start: "2026-10-17",
    end: "2026-10-18",
    bounds: { south: -35, north: -34, west: -64, east: -63 },
    step: 1,
    model: "test",
    errors: [],
    nodes: [
      [-35, -64],
      [-35, -63],
      [-34, -64],
      [-34, -63],
    ].map(([lat, lon]) => ({
      lat,
      lon,
      days: {
        "2026-10-17": { rain: 0, wind: 10, u: 1, v: 0 },
        "2026-10-18": { rain: 14, wind: 20, u: 3, v: 0 },
      },
    })),
  };
  assert.equal(
    createGridSampler(grid, "2026-10-17", "2026-10-18", "rain")(-34.5, -63.5),
    14,
  );
  assert.equal(
    createGridSampler(grid, "2026-10-17", "2026-10-17", "rain")(-34.5, -63.5),
    0,
  );
  assert.equal(
    createGridSampler(grid, "2026-10-17", "2026-10-18", "wind")(-34.5, -63.5),
    15,
  );
  grid.nodes[0].days["2026-10-18"].rain = null;
  assert.equal(
    createGridSampler(grid, "2026-10-17", "2026-10-18", "rain")(-34.5, -63.5),
    null,
  );
});
test("coordinate synchronization preserves stable IDs, status and comments without duplicates", () => {
  const p: Pivot = {
    id: "old",
    name: "BNXXX1",
    field: "San Mariano",
    lat: 38,
    lon: -58,
    status: "PROGRAMADO",
    road: "APTO",
    roadComment: "Validado",
  };
  const result = syncPivots(
    [p],
    [
      {
        ...p,
        id: "new-coordinate-hash",
        lat: -38,
        status: "PENDIENTE",
        roadComment: "",
      },
    ],
  );
  assert.equal(result.pivots.length, 1);
  assert.equal(result.pivots[0].id, "old");
  assert.equal(result.pivots[0].lat, -38);
  assert.equal(result.pivots[0].status, "PROGRAMADO");
  assert.equal(result.pivots[0].roadComment, "Validado");
  assert.deepEqual(result.changedIds, ["old"]);
});
test("regional grid fallback interpolates real coarse corners when fine cells are absent", () => {
  const grid: ForecastGrid = {
    fetchedAt: "2026-10-15",
    start: "2026-10-16",
    end: "2026-10-16",
    step: 1,
    coarseStep: 2,
    bounds: { south: 0, north: 2, west: 0, east: 2 },
    nodes: [
      [0, 0, 0],
      [0, 2, 10],
      [2, 0, 20],
      [2, 2, 30],
    ].map(([lat, lon, wind]) => ({
      lat,
      lon,
      days: { "2026-10-16": { wind, rain: 0, u: 0, v: 0 } },
    })),
    model: "test",
    errors: [],
  };
  const sample = createGridSampler(grid, "2026-10-16", "2026-10-16", "wind");
  assert.equal(sample(1, 1), 15);
  assert.equal(sample(3, 1), null);
});
