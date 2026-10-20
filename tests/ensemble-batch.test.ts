import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchEnsembleBatch,
  ENSEMBLE_SOURCES,
} from "../src/providers/research";

test("downloads equipment coordinates in one request per source and preserves response identity", async () => {
  const urls: URL[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return new Response(
      JSON.stringify(
        [3, 11].map((wind) => ({
          hourly: {
            time: ["2026-10-21T00:00", "2026-10-21T01:00"],
            wind_speed_10m: [wind, wind],
            precipitation: [0, 1],
            wind_gusts_10m: [1, 2],
          },
        })),
      ),
    );
  };
  const result = await fetchEnsembleBatch(
    [
      { key: "a", lat: -38, lon: -58 },
      { key: "b", lat: -27, lon: -60 },
    ],
    request,
  );
  assert.equal(urls.length, ENSEMBLE_SOURCES.length);
  assert.ok(
    urls.every(
      (u) =>
        u.searchParams.get("latitude") === "-38,-27" &&
        u.searchParams.get("longitude") === "-58,-60",
    ),
  );
  assert.ok(urls.every((u) => u.searchParams.get("forecast_days") === "16"));
  assert.ok(result[0].models.every((m) => m.hours[0].wind === 3));
  assert.ok(result[1].models.every((m) => m.hours[0].wind === 11));
  assert.equal(result[0].models[0].hours[0].rain, 1);
});
test("a failed source or missing location stays missing without shifting other coordinates", async () => {
  const request: typeof fetch = async (input) => {
    const model = new URL(String(input)).searchParams.get("models");
    if (model === ENSEMBLE_SOURCES[0].model)
      return new Response("", { status: 429 });
    return new Response(
      JSON.stringify([
        {
          hourly: {
            time: ["2026-10-21T00:00"],
            wind_speed_10m: [8],
            precipitation: [0],
          },
        },
        {},
      ]),
    );
  };
  const result = await fetchEnsembleBatch(
    [
      { key: "a", lat: -38, lon: -58 },
      { key: "b", lat: -27, lon: -60 },
    ],
    request,
  );
  assert.equal(result[0].models.length, 3);
  assert.equal(result[1].models.length, 0);
  assert.equal(result[0].errors.length, 1);
  assert.equal(result[1].errors.length, 4);
});

test("region rotation brings northern equipment into the first batch and missing equipment before cached neighbors", async () => {
  const { fairEnsembleOrder } = await import("../src/providers/ensemble-order");
  const points = ["Centro", "Norte", "Sur"].flatMap((region) =>
    Array.from(
      { length: 12 },
      (_, i) =>
        [
          `${region}-${i}`,
          {
            id: `${region}-${i}`,
            name: "Equipo",
            field: "Campo",
            region,
            lat: -30,
            lon: -60,
            status: "PENDIENTE",
            road: "DESCONOCIDO",
          },
        ] as [string, import("../src/domain/types").Pivot],
    ),
  );
  const ordered = fairEnsembleOrder(points, (k) => k.endsWith("-0"));
  assert.deepEqual(
    ordered.slice(0, 3).map(([, p]) => p.region),
    ["Centro", "Norte", "Sur"],
  );
  assert.ok(ordered.slice(0, 3).every(([k]) => !k.endsWith("-0")));
  assert.equal(new Set(ordered.map(([k]) => k)).size, 36);
});
