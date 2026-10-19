import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateOperationalWindows,
  roadAccessRiskScore,
} from "../src/domain/windows";
import {
  clusters,
  projectCampaign,
  buildPlans,
  recommendCrewAssignments,
} from "../src/domain/planning";
import {
  defaultRules,
  Hour,
  Pivot,
  WeatherForecast,
  localDate,
  addDays,
} from "../src/domain/types";
import { parsePivots } from "../src/domain/import";
const pivot: Pivot = {
  id: "a",
  name: "A",
  field: "F",
  lat: -34,
  lon: -63,
  status: "PENDIENTE",
  road: "DESCONOCIDO",
};
const hours = (wind = 8): Hour[] =>
  Array.from({ length: 24 }, (_, i) => ({
    time: `2026-10-16T${String(i).padStart(2, "0")}:00`,
    wind,
    gust: 14,
    rain: 0,
    soil: 0.2,
  }));
const forecast = (values: Hour[][]): WeatherForecast => ({
  fetchedAt: "2026-10-15T12:00:00Z",
  models: values.map((h, i) => {
    const dates = [...new Set(h.map((v) => v.time.slice(0, 10)))];
    const previous = dates.flatMap((date) =>
      dates.includes(addDays(date, -1))
        ? []
        : hours().map((v) => ({
            ...v,
            time: addDays(date, -1) + v.time.slice(10),
            wind: null,
          })),
    );
    return { model: String(i), hours: [...previous, ...h] };
  }),
  errors: [],
  source: "test",
});
const now = new Date("2026-10-15T12:00:00Z");
test("rain later in the day vetoes the entire working day", () => {
  const h = hours().map((v) => ({
    ...v,
    rain: Number(v.time.slice(11, 13)) >= 13 ? 2 : 0,
  }));
  assert.equal(
    calculateOperationalWindows(forecast([h, h]), defaultRules, now).length,
    0,
  );
});

test("cannot concatenate favorable hours from different models into unanimous interval", () => {
  const a = hours().map((h) => ({
    ...h,
    wind: Number(h.time.slice(11, 13)) < 11 ? 8 : 30,
  }));
  const b = hours().map((h) => ({
    ...h,
    wind: Number(h.time.slice(11, 13)) >= 11 ? 8 : 30,
  }));
  assert.equal(
    calculateOperationalWindows(forecast([a, b]), defaultRules, now)[0]
      .probability,
    50,
  );
});
test("missing and non-contiguous hours never create valid window", () => {
  const h = hours().filter((_, i) => i % 3 !== 0);
  assert.equal(
    calculateOperationalWindows(forecast([h]), defaultRules, now).length,
    0,
  );
  assert.equal(
    calculateOperationalWindows(
      forecast([hours().map((h) => ({ ...h, gust: null }))]),
      defaultRules,
      now,
    ).length,
    1,
  );
});
test("forecast confidence decays with horizon", () => {
  const h = hours();
  const later = h.map((h) => ({
    ...h,
    time: h.time.replace("10-16", "10-26"),
  }));
  const w = calculateOperationalWindows(
    forecast([
      [...h, ...later],
      [...h, ...later],
      [...h, ...later],
      [...h, ...later],
    ]),
    defaultRules,
    now,
  );
  assert.ok(w[0].confidence > w[1].confidence);
});
test("manual road veto survives missing weather", () => {
  const road = roadAccessRiskScore(
    undefined,
    { ...pivot, road: "NO APTO" },
    "2026-10-16",
    defaultRules,
  );
  assert.equal(road.condition, "NO APTO");
  assert.equal(road.score, null);
  assert.equal(
    roadAccessRiskScore(undefined, pivot, "2026-10-16", defaultRules).condition,
    "DESCONOCIDO",
  );
});
test("clusters include connected nearby points", () => {
  assert.equal(
    clusters(
      [
        pivot,
        { ...pivot, id: "b", lat: -34.1 },
        { ...pivot, id: "c", lat: -40 },
      ],
      30,
    ).length,
    2,
  );
});
test("import CSV is validated and deterministic", () => {
  const data = new TextEncoder().encode("name,lat,lon\nA,-34,-63");
  assert.equal(
    parsePivots(data, "a.csv")[0].id,
    parsePivots(data, "a.csv")[0].id,
  );
  assert.throws(() =>
    parsePivots(new TextEncoder().encode("name,lat,lon\nA,999,-63"), "a.csv"),
  );
});
test("missing forecast yields no calibrated completion claim", () => {
  const p = buildPlans([pivot], {}, defaultRules);
  assert.equal(projectCampaign(p, defaultRules).probability, null);
  assert.equal(projectCampaign(p, defaultRules).status, "SIN DATOS");
});
test("deadline exceeded has zero remaining days", () => {
  const r = { ...defaultRules, deadline: addDays(localDate(), -1) };
  assert.equal(projectCampaign(buildPlans([pivot], {}, r), r).remaining, 0);
});
test("KML imports point placemarks and ignores polygons", () => {
  const xml =
    "<kml><Document><Folder><Placemark><name>A</name><Point><coordinates>-63,-34,0</coordinates></Point></Placemark><Placemark><name>Polygon</name><Polygon/></Placemark></Folder></Document></kml>";
  assert.equal(parsePivots(new TextEncoder().encode(xml), "a.kml").length, 1);
});

test("crew recommendations never duplicate jobs or exceed daily capacity", () => {
  const r = { ...defaultRules, crews: 2, jobsPerCrew: 2 };
  const date = addDays(localDate(), 1);
  const points = Array.from({ length: 5 }, (_, i) => ({
    ...pivot,
    id: String(i),
    name: `P${i}`,
  }));
  const plans = buildPlans(points, {}, r);
  for (const p of plans) {
    const d = p.days.find((d) => d.date === date)!;
    d.priority = 80;
    d.condition = "RIESGO";
  }
  const assignments = recommendCrewAssignments(plans, date, r);
  const ids = assignments.flatMap((a) => a.jobs.map((p) => p.pivot.id));
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.ok(assignments.every((a) => a.jobs.length <= 2));
});

test("a northern latitude associated with an Argentine province is excluded from recommendations", () => {
  const p = buildPlans(
    [{ ...pivot, lat: 38, province: "Buenos Aires" }],
    {},
    defaultRules,
  )[0];
  assert.ok(p.locationWarning);
  assert.ok(
    p.days.every((d) => d.priority === 0 && d.condition === "DESCONOCIDO"),
  );
});

test("a scarce pivot is never counted as completed twice in forecast projection", () => {
  const r = {
    ...defaultRules,
    crews: 1,
    jobsPerCrew: 1,
    deadline: addDays(localDate(), 2),
  };
  const plans = buildPlans([pivot, { ...pivot, id: "b" }], {}, r);
  for (const p of plans)
    for (const d of p.days) {
      d.coverage = 4;
      if (p.pivot.id === "a") {
        d.road.condition = "APTO";
        d.priority = 80;
        d.window = {
          start: d.date + "T08:00",
          end: d.date + "T12:00",
          hours: 4,
          probability: 100,
          confidence: 90,
          wind: 8,
          gust: 12,
          rain: 0,
          members: 4,
        };
      }
    }
  const projected = projectCampaign(plans, r);
  assert.equal(projected.scenarios[1].capacity, 1);
  assert.equal(projected.scenarios[1].finish, null);
});
