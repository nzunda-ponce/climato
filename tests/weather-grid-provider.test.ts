import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase } from "../src/persistence/store";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGridBatch } from "../src/providers/long-range";

test("an incomplete last forecast day preserves the seasonal rainfall while updating wind", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "climato-provider-"));
  const cwd = process.cwd(),
    oldUrl = process.env.DATABASE_URL,
    oldPath = process.env.CLIMATO_SQLITE_PATH;
  process.chdir(dir);
  process.env.DATABASE_URL = "";
  process.env.CLIMATO_SQLITE_PATH = path.join(dir, "test.sqlite");
  t.after(async () => {
    await closeDatabase();
    process.chdir(cwd);
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
    if (oldPath === undefined) delete process.env.CLIMATO_SQLITE_PATH;
    else process.env.CLIMATO_SQLITE_PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  });
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
