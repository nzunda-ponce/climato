import { readState, mutateState } from "../src/persistence/store";
import { cellKey } from "../src/domain/evidence";
import { locationWarning } from "../src/domain/types";
import {
  loadEnso,
  loadLongHistory,
  loadSeasonal,
} from "../src/providers/long-range";
async function main() {
  const s = await readState(),
    points = [
      ...new Map(
        s.pivots
          .filter((p) => !locationWarning(p))
          .map((p) => [cellKey(p.lat, p.lon), p]),
      ).entries(),
    ];
  const enso = await loadEnso();
  console.log(JSON.stringify({ enso: enso.latest }));
  for (let i = 0; i < points.length; i++) {
    const [key, p] = points[i];
    try {
      const history = await loadLongHistory(key, p.lat, p.lon, s.rules, enso);
      const seasonal = await loadSeasonal(key, p.lat, p.lon, s.rules, history);
      await mutateState((s) => {
        (s.climate ??= {})[key] = history;
        (s.seasonal ??= {})[key] = seasonal;
      });
      console.log(
        JSON.stringify({
          kind: "long-range",
          done: i + 1,
          total: points.length,
          key,
          years: history.years.length,
          features: history.features?.length,
          forecastDays: Object.keys(seasonal.days).length,
          validation: history.validation,
          errors: seasonal.errors,
        }),
      );
    } catch (e) {
      console.log(
        JSON.stringify({
          key,
          error: e instanceof Error ? e.message : "error",
        }),
      );
      process.exitCode = 1;
    }
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
