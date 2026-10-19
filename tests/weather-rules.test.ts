import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultRules, Hour } from "../src/domain/types";
import {
  dailyCapacity,
  memberPaths,
  rulesSignature,
} from "../src/domain/evidence";
import { calculateOperationalWindows } from "../src/domain/windows";
import { nextMonday, weatherMapPeriod } from "../src/domain/map-period";

const day = (date: string, rain = 0, wind = 16): Hour[] =>
  Array.from({ length: 24 }, (_, i) => ({
    time: `${date}T${String(i).padStart(2, "0")}:00`,
    wind,
    rain: i === 23 ? rain : 0,
    gust: null,
    soil: null,
  }));
test("wind up to 16 is allowed; rain at any hour or 15 mm the day before vetoes work", () => {
  const current = day("2026-10-17"),
    previous = day("2026-10-16", 14.9);
  assert.equal(dailyCapacity(current, defaultRules, previous), 3);
  assert.equal(
    dailyCapacity(day("2026-10-17", 0, 16.1), defaultRules, previous),
    0,
  );
  assert.equal(
    dailyCapacity(day("2026-10-17", 0.1), defaultRules, previous),
    0,
  );
  assert.equal(dailyCapacity(current, defaultRules, day("2026-10-16", 15)), 0);
  assert.equal(dailyCapacity(current, defaultRules, day("2026-10-16", 25)), 0);
});
test("missing full-day or prior-day rainfall is unknown, never dry", () => {
  assert.equal(dailyCapacity(day("2026-10-17"), defaultRules), null);
  assert.equal(
    dailyCapacity(
      day("2026-10-17").slice(0, 23),
      defaultRules,
      day("2026-10-16"),
    ),
    null,
  );
  const path = memberPaths(
    [
      {
        model: "test",
        hours: [...day("2026-10-16", 15), ...day("2026-10-17")],
      },
    ],
    defaultRules,
  )[0];
  assert.equal(path.days["2026-10-17"], 0);
  const forecast = {
    source: "test",
    fetchedAt: "2026-10-15",
    errors: [],
    models: [
      {
        model: "test",
        hours: [...day("2026-10-16", 15), ...day("2026-10-17")],
      },
    ],
  };
  assert.equal(
    calculateOperationalWindows(
      forecast,
      defaultRules,
      new Date("2026-10-16T00:00Z"),
    ).length,
    0,
  );
  assert.notEqual(
    rulesSignature(defaultRules),
    rulesSignature({ ...defaultRules, rain24Limit: 10 }),
  );
});
test("current-week selections keep today's map; next week switches on Monday", () => {
  assert.equal(nextMonday("2026-10-16"), "2026-10-19");
  assert.deepEqual(weatherMapPeriod("2026-10-16", "2026-10-18"), {
    start: "2026-10-16",
    end: "2026-10-16",
  });
  assert.deepEqual(weatherMapPeriod("2026-10-16", "2026-10-21"), {
    start: "2026-10-19",
    end: "2026-10-25",
  });
  assert.deepEqual(weatherMapPeriod("2026-10-16", "2026-12-01", true), {
    start: "2026-10-16",
    end: "2026-10-16",
  });
  assert.equal(nextMonday("2026-10-19"), "2026-10-26");
});
