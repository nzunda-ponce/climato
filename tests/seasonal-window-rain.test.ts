import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import { loadSeasonal } from "../src/providers/long-range";
import {
  dailyCapacity,
  HistoricalClimate,
  rulesSignature,
} from "../src/domain/evidence";
import { addDays, defaultRules, localDate } from "../src/domain/types";

test("seasonal predictions use dry trial labels instead of rejecting any rain in the day", async (t) => {
  const today = localDate(),
    target = addDays(today, 1);
  const rules = { ...defaultRules, deadline: addDays(today, 2) };
  const hourlyDay = (date: string, nightRain = 0) =>
    Array.from({ length: 24 }, (_, h) => ({
      time: `${date}T${String(h).padStart(2, "0")}:00`,
      wind: 10,
      gust: null,
      rain: h === 1 ? nightRain : 0,
      soil: null,
    }));
  const slots = dailyCapacity(hourlyDay(target, 6), rules, hourlyDay(today));
  assert.equal(slots, 3);
  const history: HistoricalClimate = {
    key: "test",
    lat: -38,
    lon: -58,
    fetchedAt: new Date().toISOString(),
    rulesSignature: rulesSignature(rules),
    years: Array.from({ length: 45 }, (_, i) => 1981 + i),
    days: {},
    monthly: {},
    source: "test",
    features: Array.from({ length: 60 }, (_, i) => ({
      date: `${1981 + Math.floor(i / 20)}-${target.slice(5, 7)}-${String((i % 20) + 1).padStart(2, "0")}`,
      wind: 10,
      rain: 6,
      previousRain: 0,
      slots: slots!,
    })),
  };
  const times = [today, target]
    .flatMap((date) =>
      ["00", "06", "12", "18"].map((hour) => `${date}T${hour}:00`),
    )
    .concat(`${addDays(target, 1)}T00:00`);
  let previousRain = 0;
  t.mock.method(fs, "readFile", async () =>
    gzipSync(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        end: addDays(rules.deadline, 1),
        hourly: {
          time: times,
          wind_speed_10m: times.map(() => 10),
          precipitation: [0, previousRain, 0, 0, 0, 6, 0, 0, 0],
        },
      }),
    ),
  );
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Cached data must not be downloaded again");
  });
  const result = await loadSeasonal("test", -38, -58, rules, history);
  assert.ok(result.days[target].probability! > 0.99);
  assert.ok(result.days[target].slots! > 2.99);
  previousRain = 15;
  assert.equal(
    (await loadSeasonal("test", -38, -58, rules, history)).days[target]
      .probability,
    0,
  );
  assert.equal(network.mock.callCount(), 0);
});
