import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHistoryYearBatch } from "../src/providers/history-batch";
import { defaultRules } from "../src/domain/types";
test("downloads historical seasons for exact coordinates independently of NOAA and reuses annual caches", async () => {
  const requests: URL[] = [],
    memory = new Map<string, any>();
  const cache = {
    read: async (name: string) => memory.get(name),
    write: async (name: string, value: any) => {
      memory.set(name, value);
    },
  };
  const time = ["2025-09-30", "2025-10-01"]
    .flatMap((date) =>
      Array.from(
        { length: 24 },
        (_, h) => `${date}T${String(h).padStart(2, "0")}:00`,
      ),
    )
    .concat("2025-10-02T00:00");
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    return new Response(
      JSON.stringify(
        [5, 30].map((wind) => ({
          hourly: {
            time,
            wind_speed_10m: time.map(() => wind),
            precipitation: time.map(() => 0),
          },
        })),
      ),
    );
  };
  const points = [
    { key: "a", lat: -34.25, lon: -61.32 },
    { key: "b", lat: -27.42, lon: -60.18 },
  ];
  const result = await loadHistoryYearBatch(
    points,
    2025,
    defaultRules,
    request,
    cache,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].hostname.includes("archive"), true);
  assert.equal(requests[0].searchParams.get("latitude"), "-34.25,-27.42");
  assert.equal(result[0].days["2025-10-01"], 3);
  assert.equal(result[1].days["2025-10-01"], 0);
  assert.equal(memory.size, 2);
  const again = await loadHistoryYearBatch(
    points,
    2025,
    defaultRules,
    request,
    cache,
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(
    again.map((h) => h.years),
    [[2025], [2025]],
  );
});
