import { test } from "node:test";
import assert from "node:assert/strict";
import { nearbyReference, matchesLocation } from "../src/domain/location-label";
import type { PlanningZone } from "../src/domain/planning-report";
test("nearby search references do not invent a field address or assign distant localities", () => {
  const z = {
    lat: -38.55,
    lon: -58.74,
    fields: ["Las Cabezas"],
    provinces: ["Buenos Aires"],
    equipment: [{ name: "BE123" }],
    key: "point",
  } as unknown as PlanningZone;
  assert.match(nearbyReference(z), /Necochea \(referencia\)/);
  assert.equal(matchesLocation(z, "necochea", "Sur"), true);
  assert.equal(matchesLocation(z, "buenos aires", "Sur"), true);
  assert.equal(nearbyReference({ lat: 0, lon: 0 }), "");
});
