import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGridBatch } from "../src/providers/long-range";

test("an incomplete last forecast day preserves the seasonal rainfall while updating wind", async (t) => {
  const date = "2026-10-29";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const seasonal = String(input).includes("seasonal-api");
    const time = seasonal
      ? ["00", "06", "12", "18"]
          .map((h) => `${date}T${h}:00`)
          .concat("2026-10-30T00:00")
      : Array.from(
          { length: 24 },
          (_, h) => `${date}T${String(h).padStart(2, "0")}:00`,
        );
    return new Response(
      JSON.stringify({
        hourly: {
          time,
          precipitation: seasonal ? [0, 1, 2, 3, 4] : time.map(() => 0),
          wind_speed_10m: time.map(() => (seasonal ? 10 : 12)),
          wind_direction_10m: time.map(() => 0),
        },
      }),
      { status: 200 },
    );
  });
  const [node] = await loadGridBatch([{ lat: -34, lon: -63 }], date);
  assert.equal(node.days[date].rain, 10);
  assert.equal(node.days[date].wind, 12);
});
