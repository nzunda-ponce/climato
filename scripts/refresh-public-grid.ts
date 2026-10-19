import { localDate } from "../src/domain/types";
import {
  ForecastGrid,
  PUBLIC_WEATHER_BOUNDS,
  publicGridPoints,
} from "../src/domain/seasonal";
import {
  loadGridBatch,
  readLongCache,
  writeLongCache,
} from "../src/providers/long-range";
// A fixed public geography, independent of all equipment locations.
// This script never reads the campaign, pivot coordinates or any private file.
async function main() {
  const end = "2026-12-31",
    bounds = PUBLIC_WEATHER_BOUNDS,
    nodes = publicGridPoints();
  const old = await readLongCache<ForecastGrid>("grid");
  const grid: ForecastGrid =
    old && old.end === end && old.start === localDate()
      ? { ...old, bounds, coarseStep: 2 }
      : {
          fetchedAt: new Date().toISOString(),
          start: localDate(),
          end,
          step: 1,
          coarseStep: 2,
          bounds,
          nodes: [],
          model: "Open-Meteo corto plazo / ECMWF EC46 / SEAS5 ensemble mean",
          errors: [],
        };
  const missing = nodes.filter(
    (p) => !grid.nodes.some((n) => n.lat === p.lat && n.lon === p.lon),
  );
  for (let i = 0; i < missing.length; i += 8) {
    try {
      const batch = await loadGridBatch(missing.slice(i, i + 8), end);
      grid.nodes.push(...batch);
      await writeLongCache("grid", grid);
      console.log(
        JSON.stringify({
          kind: "public-weather-grid",
          done: grid.nodes.length,
          total: nodes.length,
        }),
      );
    } catch (e) {
      console.log(
        JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      );
      process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
