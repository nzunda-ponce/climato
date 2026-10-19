import { readState, mutateState } from "../src/persistence/store";
import { cellKey } from "../src/domain/evidence";
import { locationWarning } from "../src/domain/types";
import { loadEnsemble, loadHistoricalClimate } from "../src/providers/research";
async function main() {
  const s = await readState();
  const points = [
    ...new Map(
      s.pivots
        .filter((p) => !locationWarning(p))
        .map((p) => [cellKey(p.lat, p.lon), p]),
    ).entries(),
  ];
  const kind = process.argv[2] ?? "ensemble";
  for (let i = 0; i < points.length; i++) {
    const [key, p] = points[i];
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 8000));
    try {
      if (kind === "ensemble") {
        const result = await loadEnsemble(key, p.lat, p.lon, s.rules);
        await mutateState((s) => {
          (s.ensembles ??= {})[key] = result;
        });
        console.log(
          JSON.stringify({
            done: i + 1,
            total: points.length,
            key,
            sources: result.sources,
            errors: result.errors,
          }),
        );
      } else {
        const result = await loadHistoricalClimate(key, p.lat, p.lon, s.rules);
        await mutateState((s) => {
          (s.climate ??= {})[key] = result;
        });
        console.log(
          JSON.stringify({
            done: i + 1,
            total: points.length,
            key,
            years: result.years,
            monthly: result.monthly,
          }),
        );
      }
    } catch (e) {
      console.log(
        JSON.stringify({
          done: i + 1,
          total: points.length,
          key,
          error: e instanceof Error ? e.message : "Error",
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
