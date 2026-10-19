import { readState, mutateState } from "../src/persistence/store";
import {
  cellKey,
  alignHourlyIntervals,
  EnsembleAssessment,
  HistoricalClimate,
} from "../src/domain/evidence";
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
  const ensembles: Record<string, EnsembleAssessment> = {},
    climate: Record<string, HistoricalClimate> = {};
  for (const [key, p] of points) {
    ensembles[key] = await loadEnsemble(key, p.lat, p.lon, s.rules);
    climate[key] = await loadHistoricalClimate(key, p.lat, p.lon, s.rules);
    console.log(`Recalculada ${key}`);
  }
  await mutateState((s) => {
    s.ensembles = ensembles;
    s.climate = climate;
    for (const f of Object.values(s.forecasts))
      if (!f.intervalAligned) {
        f.models = f.models.map((m) => ({
          ...m,
          hours: alignHourlyIntervals(m.hours),
        }));
        f.intervalAligned = true;
      }
  });
  console.log(
    JSON.stringify({
      ensembles: Object.keys(ensembles).length,
      history: Object.keys(climate).length,
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
