import { test } from "node:test";
import assert from "node:assert/strict";
import { hourlyWindowDetail } from "../src/domain/window-detail";
import { defaultRules, Hour, WeatherForecast } from "../src/domain/types";
const day = (date: string, rain = 0): Hour[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    time: `${date}T${String(hour).padStart(2, "0")}:00`,
    wind: 15,
    gust: null,
    soil: null,
    rain: hour === 23 ? rain : 0,
  }));
const now = new Date("2026-10-16T12:00Z");
const forecast = (hours: Hour[]): WeatherForecast => ({
  fetchedAt: "2026-10-16T10:00Z",
  source: "test",
  errors: [],
  models: [{ model: "test", hours }],
});
test("returns an actual continuous hourly window, not a fabricated seasonal time", () => {
  const f = forecast([...day("2026-10-16"), ...day("2026-10-17")]);
  const result = hourlyWindowDetail(f, defaultRules, "2026-10-17", now);
  assert.equal(result.status, "available");
  assert.equal(result.window?.start, "2026-10-17T07:00");
  assert.equal(result.window?.end, "2026-10-17T19:00");
  assert.deepEqual(result.window?.blocks, [
    { start: "2026-10-17T07:00", end: "2026-10-17T11:00" },
    { start: "2026-10-17T11:00", end: "2026-10-17T15:00" },
    { start: "2026-10-17T15:00", end: "2026-10-17T19:00" },
  ]);
  assert.equal(
    hourlyWindowDetail(f, defaultRules, "2026-11-30", now).status,
    "tentative",
  );
  assert.equal(
    hourlyWindowDetail(f, defaultRules, "2026-11-30", now).window,
    null,
  );
  assert.equal(
    hourlyWindowDetail(
      f,
      defaultRules,
      "2026-10-17",
      new Date("2026-10-18T12:00Z"),
    ).status,
    "stale",
  );
});
test("daily and prior-day rainfall determine the window independently of weekly accumulation", () => {
  const f = forecast([
    ...day("2026-10-16"),
    ...day("2026-10-17"),
    ...day("2026-10-18", 80),
  ]);
  assert.equal(
    hourlyWindowDetail(f, defaultRules, "2026-10-17", now).status,
    "available",
  );
  const wetPrior = forecast([...day("2026-10-16", 15), ...day("2026-10-17")]);
  assert.equal(
    hourlyWindowDetail(wetPrior, defaultRules, "2026-10-17", now).status,
    "unconfirmed",
  );
  const wetDay = forecast([...day("2026-10-16"), ...day("2026-10-17", 1)]);
  assert.equal(
    hourlyWindowDetail(wetDay, defaultRules, "2026-10-17", now).status,
    "unconfirmed",
  );
});

test("hourly proposals expire after twelve hours and reject future timestamps", () => {
  const f = forecast([...day("2026-10-16"), ...day("2026-10-17")]);
  assert.equal(
    hourlyWindowDetail(
      f,
      defaultRules,
      "2026-10-17",
      new Date("2026-10-16T21:59:00Z"),
    ).status,
    "available",
  );
  assert.equal(
    hourlyWindowDetail(
      f,
      defaultRules,
      "2026-10-17",
      new Date("2026-10-16T22:00:00Z"),
    ).status,
    "stale",
  );
  assert.equal(
    hourlyWindowDetail(
      { ...f, fetchedAt: "2026-10-17T10:00Z" },
      defaultRules,
      "2026-10-17",
      now,
    ).status,
    "stale",
  );
});
