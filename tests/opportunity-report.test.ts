import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpportunityReport,
  isFresh,
  reportDates,
  ReportState,
  scenarioDayCounts,
  summarizeReportPeriod,
} from "../src/domain/opportunity-report";
import {
  EnsembleAssessment,
  MemberPath,
  rulesSignature,
} from "../src/domain/evidence";
import { defaultRules } from "../src/domain/types";
const now = new Date("2026-10-20T15:30:00Z");
const dates = reportDates("2026-10-21", "2026-11-03");
function state(): ReportState {
  const rules = { ...defaultRules, deadline: "2026-11-03" };
  const paths = ["ECMWF", "GEFS"].flatMap((family) =>
    Array.from({ length: 20 }, (_, i) => ({
      family,
      member: String(i),
      days: Object.fromEntries(dates.map((d) => [d, i < 15 ? 2 : 0])),
    })),
  );
  const ensemble: EnsembleAssessment = {
    key: "-38.5,-58.75",
    lat: -38.5,
    lon: -58.75,
    fetchedAt: "2026-10-20T14:00:00Z",
    rulesSignature: rulesSignature(rules),
    paths,
    windows: [],
    sources: [
      { family: "ECMWF", members: 20, usableMembers: 20 },
      { family: "GEFS", members: 20, usableMembers: 20 },
    ],
    errors: [],
    nativeResolution: "test",
  };
  return {
    pivots: [
      {
        id: "a",
        name: "Equipo A",
        field: "El Molino",
        region: "Necochea",
        province: "Buenos Aires",
        lat: -38.5,
        lon: -58.75,
        status: "PENDIENTE",
        road: "DESCONOCIDO",
      },
    ],
    rules,
    forecasts: {},
    ensembles: { [ensemble.key]: ensemble },
  };
}

test("a shared zone counts calendar days once and separates expected days from slots", () => {
  const input = state();
  const first = buildOpportunityReport(input, now);
  input.pivots.push({ ...input.pivots[0], id: "b", name: "Equipo B" });
  const second = buildOpportunityReport(input, now);
  const zone = second.zones[0];
  assert.equal(zone.name, "Zona Q");
  assert.equal(zone.pending, 2);
  assert.equal(zone.next7.expectedDays, 5.25);
  assert.equal(zone.next14.expectedDays, 10.5);
  assert.equal(zone.daily[0].slots, 1.5);
  assert.equal(zone.next7.expectedDays, first.zones[0].next7.expectedDays);
  assert.deepEqual(zone.next7.scenarios?.range, [0, 7]);
  assert.ok(Math.abs(zone.next7.scenarios!.expected - 5.25) < 1e-10);
  assert.equal(zone.nextOpportunity?.date, "2026-10-21");
  assert.ok(Math.abs(zone.daily[0].following!.expected - 7) < 1e-10);
  assert.ok(zone.daily.slice(7).every((d) => d.status !== "review"));
});

test("the report rolls to the new Argentine date and honors a changed priority threshold", () => {
  const input = state();
  const later = new Date("2026-10-21T15:30:00Z");
  Object.values(input.ensembles!)[0].fetchedAt = later.toISOString();
  const report = buildOpportunityReport(input, later);
  assert.equal(report.today, "2026-10-21");
  assert.equal(report.start, "2026-10-22");
  assert.equal(report.zones[0].daily[0].date, "2026-10-22");
  assert.equal(report.zones[0].next7.total, 7);
  input.rules.minimumProbability = 80;
  const cautious = buildOpportunityReport(input, later).zones[0];
  assert.equal(cautious.nextOpportunity, null);
  assert.equal(cautious.daily[0].probability, 0.75);
});

test("missing days do not become bad weather or a full-period total", () => {
  const input = state();
  for (const p of Object.values(input.ensembles!)[0].paths)
    p.days[dates[3]] = null;
  const zone = buildOpportunityReport(input, now).zones[0];
  assert.equal(zone.next7.covered, 6);
  assert.equal(zone.next7.expectedDays, null);
  assert.equal(zone.next7.partialExpectedDays, 4.5);
  assert.equal(zone.next7.scenarios, null);
  assert.equal(zone.daily[3].status, "missing");
  assert.equal(zone.daily[0].following, null);
  const zero = summarizeReportPeriod(
    [{ date: dates[0], probability: 0, slots: 0, source: "pronóstico" }],
    dates[0],
    dates[0],
  );
  assert.equal(zero.expectedDays, 0);
});

test("stale sources, future timestamps, changed rules and a single family never become priority dates", () => {
  for (const fetchedAt of ["2026-10-19T00:00:00Z", "2026-10-21T00:00:00Z"]) {
    const input = state();
    Object.values(input.ensembles!)[0].fetchedAt = fetchedAt;
    const zone = buildOpportunityReport(input, now).zones[0];
    assert.equal(zone.nextOpportunity, null);
    assert.equal(zone.next7.expectedDays, null);
    assert.equal(zone.sources.ensembleFresh, false);
  }
  const changed = state();
  changed.rules.wind = 12;
  assert.equal(
    buildOpportunityReport(changed, now).zones[0].nextOpportunity,
    null,
  );
  const single = state();
  Object.values(single.ensembles!)[0].paths = Object.values(
    single.ensembles!,
  )[0].paths.filter((p) => p.family === "GEFS");
  const limited = buildOpportunityReport(single, now).zones[0];
  assert.equal(limited.nextOpportunity, null);
  assert.equal(limited.next7.scenarios, null);
  assert.equal(limited.daily[0].status, "limited");
  assert.equal(limited.daily[0].probability, 0.75);
});

test("short-term families keep equal weight despite different ensemble sizes", () => {
  const input = state();
  const ens = Object.values(input.ensembles!)[0];
  ens.paths = [
    ...Array.from({ length: 10 }, (_, i) => ({
      family: "a",
      member: String(i),
      days: Object.fromEntries(dates.map((d) => [d, 1])),
    })),
    ...Array.from({ length: 40 }, (_, i) => ({
      family: "b",
      member: String(i),
      days: Object.fromEntries(dates.map((d) => [d, 0])),
    })),
  ];
  const zone = buildOpportunityReport(input, now).zones[0];
  assert.equal(zone.daily[0].probability, 0.5);
  assert.equal(zone.next7.expectedDays, 3.5);
  assert.ok(Math.abs(zone.next7.scenarios!.expected - 3.5) < 1e-10);
});

test("conditional recurrence preserves correlation and posterior family weights", () => {
  const reference = "2026-10-21",
    future = reportDates("2026-10-22", "2026-10-28");
  const paths: MemberPath[] = [
    ...Array.from({ length: 10 }, (_, i) => ({
      family: "a",
      member: String(i),
      days: {
        [reference]: i < 9 ? 1 : 0,
        ...Object.fromEntries(future.map((d) => [d, 0])),
      },
    })),
    ...Array.from({ length: 100 }, (_, i) => ({
      family: "b",
      member: String(i),
      days: {
        [reference]: i < 10 ? 1 : 0,
        ...Object.fromEntries(future.map((d) => [d, 1])),
      },
    })),
  ];
  const conditional = scenarioDayCounts(paths, future, reference)!;
  assert.equal(conditional.samples, 19);
  assert.equal(conditional.supportingFamilies, 2);
  assert.ok(Math.abs(conditional.expected - 0.7) < 1e-10);
  assert.ok(Math.abs(conditional.noMoreDays - 0.9) < 1e-10);
  assert.ok(Math.abs(scenarioDayCounts(paths, future)!.expected - 3.5) < 1e-10);
});

test("scenario ranges require sufficient complete members in every family", () => {
  const paths = Object.values(state().ensembles!)[0].paths;
  paths
    .filter((p) => p.family === "ECMWF")
    .slice(0, 5)
    .forEach((p) => {
      p.days[dates[0]] = null;
    });
  assert.equal(scenarioDayCounts(paths, dates), null);
  assert.equal(scenarioDayCounts([], dates), null);
  assert.equal(scenarioDayCounts(paths, []), null);
});

test("seasonal estimates remain tentative even with high probability nearby", () => {
  const input = state();
  input.ensembles = {};
  const key = "-38.5,-58.75";
  input.seasonal = {
    [key]: {
      key,
      lat: -38.5,
      lon: -58.75,
      fetchedAt: now.toISOString(),
      rulesSignature: rulesSignature(input.rules),
      years: [],
      method: "test",
      errors: [],
      days: Object.fromEntries(
        dates.map((d) => [
          d,
          {
            probability: 0.99,
            slots: 1.5,
            wind: 10,
            rain: 0,
            source: "EC46" as const,
            members: 51,
          },
        ]),
      ),
    },
  };
  const zone = buildOpportunityReport(input, now).zones[0];
  assert.equal(zone.nextOpportunity, null);
  assert.equal(zone.next7.scenarios, null);
  assert.equal(zone.daily[0].source, "subestacional");
  assert.equal(zone.daily[0].status, "limited");
});

test("today only proposes unelapsed hours and is never counted as another full day", () => {
  const input = state();
  input.forecasts.a = {
    fetchedAt: now.toISOString(),
    intervalAligned: true,
    source: "test",
    errors: [],
    models: [
      {
        model: "a",
        hours: ["2026-10-19", "2026-10-20"].flatMap((date) =>
          Array.from({ length: 24 }, (_, hour) => ({
            time: `${date}T${String(hour).padStart(2, "0")}:00`,
            wind: 5,
            rain: 0,
            gust: 5,
            soil: null,
          })),
        ),
      },
    ],
  };
  const zone = buildOpportunityReport(input, now).zones[0];
  assert.equal(zone.daily[0].date, "2026-10-21");
  assert.equal(zone.todayWindows.length, 1);
  assert.ok(zone.todayWindows[0].window!.start >= "2026-10-20T13:00");
  input.forecasts.a.fetchedAt = "2026-10-18T00:00:00Z";
  assert.equal(
    buildOpportunityReport(input, now).zones[0].todayWindows.length,
    0,
  );
});

test("deadlines cap the report and finished equipment does not inflate availability", () => {
  const input = state();
  input.rules.deadline = "2026-10-22";
  input.pivots.push({ ...input.pivots[0], id: "done", status: "TERMINADO" });
  const report = buildOpportunityReport(input, now);
  assert.equal(report.zones[0].pending, 1);
  assert.equal(report.zones[0].next7.total, 2);
  assert.equal(report.zones[0].remaining.total, 2);
  assert.equal(report.zones[0].daily[0].followingTotal, 1);
  const closed = buildOpportunityReport(input, new Date("2026-10-23T15:00Z"));
  assert.equal(closed.active, false);
  assert.equal(closed.zones[0].remaining.total, 0);
  assert.equal(closed.zones[0].remaining.expectedDays, null);
  assert.equal(isFresh("bad date", now.getTime(), 12), false);
});

test("conditional counts are withheld when only one family supports the reference day", () => {
  const paths = Object.values(state().ensembles!)[0].paths;
  for (const p of paths) p.days[dates[0]] = p.family === "ECMWF" ? 1 : 0;
  assert.equal(scenarioDayCounts(paths, dates.slice(1, 8), dates[0]), null);
});
