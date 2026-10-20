import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanningReport } from "../src/domain/planning-report";
import {
  cellKey,
  rulesSignature,
  EnsembleAssessment,
} from "../src/domain/evidence";
import { defaultRules, Pivot } from "../src/domain/types";
import type { ReportState } from "../src/domain/opportunity-report";
const now = new Date("2026-10-20T15:00Z");
const rules = { ...defaultRules, deadline: "2026-11-03" };
const p: Pivot = {
  id: "a",
  name: "Equipo A",
  field: "Campo A",
  region: "Necochea",
  lat: -38.511,
  lon: -58.733,
  status: "PENDIENTE",
  road: "DESCONOCIDO",
};
function state(): ReportState {
  const key = cellKey(p.lat, p.lon);
  const e: EnsembleAssessment = {
    key,
    lat: p.lat,
    lon: p.lon,
    rulesSignature: rulesSignature(rules),
    fetchedAt: now.toISOString(),
    sources: [],
    errors: [],
    nativeResolution: "test",
    paths: ["A", "B"].flatMap((family) =>
      Array.from({ length: 20 }, (_, i) => ({
        family,
        member: String(i),
        days: Object.fromEntries(
          Array.from({ length: 14 }, (_, j) => [
            new Date(Date.parse("2026-10-21T12:00Z") + j * 86400000)
              .toISOString()
              .slice(0, 10),
            i < 16 ? 1 : 0,
          ]),
        ),
      })),
    ),
    windows: [
      {
        start: "2026-10-21T08:00",
        end: "2026-10-21T12:00",
        hours: 4,
        probability: 80,
        confidence: 1,
        wind: 10,
        gust: 12,
        rain: 0,
        members: 40,
        families: 2,
        basis: "ensemble",
        coverage: 100,
        familyEvidence: ["A", "B"].map((family) => ({
          family,
          total: 20,
          usable: 20,
          favorable: 16,
        })),
      },
    ],
  };
  return {
    pivots: [
      p,
      { ...p, id: "b", name: "Equipo B", lat: -38.512, lon: -58.734 },
    ],
    rules,
    forecasts: {},
    ensembles: { [key]: e },
  };
}
test("planning separates nearby coordinates and publishes complete trajectories and supported trial windows", () => {
  const r = buildPlanningReport(state(), now);
  assert.equal(r.zones.length, 2);
  const a = r.zones.find((z) => z.equipment[0].id === "a")!,
    b = r.zones.find((z) => z.equipment[0].id === "b")!;
  assert.equal(a.daily[0].probability, 0.8);
  assert.equal(b.daily[0].probability, null);
  assert.equal(a.daily[0].windows[0].coverage, 1);
  assert.equal(a.daily[0].windows[0].supported, true);
  assert.ok(Math.abs(a.consecutive7!.expected - 5.6) < 1e-10);
  assert.deepEqual(a.consecutive7!.range, [0, 7]);
  assert.equal(b.consecutive7, null);
});
test("withholds unsupported daily estimates and hourly windows with a poorly covered family", () => {
  const s = state(),
    e = Object.values(s.ensembles!)[0];
  e.paths
    .filter((p) => p.family === "B")
    .slice(0, 6)
    .forEach((p) => (p.days["2026-10-21"] = null));
  e.windows[0].familyEvidence![1].usable = 8;
  const day = buildPlanningReport(s, now).zones.find(
    (z) => z.equipment[0].id === "a",
  )!.daily[0];
  assert.equal(day.probability, null);
  assert.equal(day.supported, false);
  assert.equal(day.windows[0].supported, false);
});
test("stale forecasts cannot supply probabilities, windows or run distributions", () => {
  const s = state();
  Object.values(s.ensembles!)[0].fetchedAt = "2026-10-19T15:00Z";
  const a = buildPlanningReport(s, now).zones.find(
    (z) => z.equipment[0].id === "a",
  )!;
  assert.equal(a.daily[0].probability, null);
  assert.deepEqual(a.daily[0].windows, []);
  assert.equal(a.consecutive7, null);
});
