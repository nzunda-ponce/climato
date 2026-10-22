import { test } from "node:test";
import assert from "node:assert/strict";
import {
  equipmentZone,
  equipmentZoneNames,
  splitWorkZones,
} from "../src/domain/work-zones";
import {
  availabilityCell,
  availabilityGroups,
} from "../src/domain/availability-matrix";
import type { PlanningZone } from "../src/domain/planning-report";
test("work zones use the second letter, including equipment with a shared display name", () => {
  assert.equal(equipmentZone("BE1187 / BE4577"), "E");
  assert.equal(equipmentZone(" bt146c2a/b "), "T");
  assert.equal(equipmentZone("123"), null);
  assert.equal(equipmentZone("tbd"), null);
  assert.equal(equipmentZone(" TBD-01 "), null);
  assert.deepEqual(equipmentZoneNames([{ name: "TBD" }]), [
    "Sin zona asignada",
  ]);
  assert.deepEqual(
    equipmentZoneNames([{ name: "BE1187" }, { name: "BE4577" }]),
    ["Zona E"],
  );
});

test("an old published TBD membership is relabelled without discarding equipment or weather", () => {
  const original = {
    key: "location",
    name: "Zona B",
    regions: ["Zona B"],
    fields: [],
    pending: 1,
    equipment: [{ name: "tbd" }],
    outlook: [{ date: "2026-10-23", probability: 0.8 }],
  } as unknown as PlanningZone;
  const [fixed] = splitWorkZones(original);
  assert.equal(fixed.name, "Sin zona asignada");
  assert.deepEqual(fixed.regions, ["Sin zona asignada"]);
  assert.equal(fixed.key, original.key);
  assert.deepEqual(fixed.equipment, original.equipment);
  assert.deepEqual(fixed.outlook, original.outlook);
});
test("shared coordinates are split by work membership without doubling weather statistics", () => {
  const original = {
    key: "-38,-59",
    regions: ["Centro"],
    fields: ["Campo"],
    pending: 2,
    equipment: [
      { name: "BE1187", field: "Campo E" },
      { name: "BL1200", field: "Campo L" },
    ],
    outlook: [{ date: "2026-10-21", source: "pronóstico", probability: 0.8 }],
  } as unknown as PlanningZone;
  const split = splitWorkZones(original);
  assert.equal(split.length, 2);
  assert.equal(split[0].locationKey, original.key);
  assert.equal(availabilityGroups(split).length, 2);
  assert.equal(split[0].pending, 1);
  assert.deepEqual(split[0].fields, ["Campo E"]);
  const combined = availabilityCell(split, ["2026-10-21"]);
  assert.equal(combined.locations, 1);
  assert.equal(combined.expected, 0.8);
  assert.deepEqual(splitWorkZones(split[0]), [split[0]]);
});
