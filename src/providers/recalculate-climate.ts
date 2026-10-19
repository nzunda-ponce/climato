import { readState, mutateState, readResearchRaw } from "@/persistence/store";
import {
  cellKey,
  rulesSignature,
  memberPaths,
  HistoricalClimate,
  EnsembleAssessment,
} from "@/domain/evidence";
import { WeatherForecast, locationWarning } from "@/domain/types";
import { calculateOperationalWindows } from "@/domain/windows";
import { loadLongHistory, loadSeasonal, readLongCache } from "./long-range";
import type { EnsoIndex, SeasonalAssessment } from "@/domain/seasonal";

let pending: Promise<void> | undefined;
// Rebuild derived values from the original observations when criteria change.
// Never relabel an assessment computed under different rules as compatible.
export function recalculateClimate() {
  return (pending ??= rebuild().finally(() => {
    pending = undefined;
  }));
}
async function rebuild() {
  const state = await readState();
  const signature = rulesSignature(state.rules);
  const points = [
    ...new Map(
      state.pivots
        .filter((p) => !locationWarning(p))
        .map((p) => [cellKey(p.lat, p.lon), p]),
    ).entries(),
  ];
  const outdated = points.filter(
    ([key]) =>
      state.seasonal?.[key] &&
      (state.seasonal[key].rulesSignature !== signature ||
        state.climate?.[key]?.rulesSignature !== signature),
  );
  if (!outdated.length) return;
  const enso = await readLongCache<EnsoIndex>("enso-roni");
  if (!enso) throw new Error("Falta el índice ENSO para recalcular los datos.");
  const results: {
    key: string;
    history: HistoricalClimate;
    seasonal: SeasonalAssessment;
  }[] = [];
  for (const [key, p] of outdated) {
    const history = await loadLongHistory(
      key,
      p.lat,
      p.lon,
      state.rules,
      enso,
      true,
    );
    const seasonal = await loadSeasonal(
      key,
      p.lat,
      p.lon,
      state.rules,
      history,
      true,
    );
    results.push({ key, history, seasonal });
  }
  const ensembles: EnsembleAssessment[] = [];
  for (const assessment of Object.values(state.ensembles ?? {})) {
    if (assessment.rulesSignature === signature) continue;
    // Expired ensembles are already excluded by the forecast calculation.
    // Rebuilding their windows delays new rules without adding usable data.
    const age = Date.now() - Date.parse(assessment.fetchedAt);
    if (age < 0 || age >= 12 * 3600000) continue;
    const raw = await readResearchRaw<WeatherForecast>(
      assessment.key,
      "ensemble",
    );
    if (raw)
      ensembles.push({
        ...assessment,
        paths: memberPaths(raw.models, state.rules),
        windows: calculateOperationalWindows(raw, state.rules),
        rulesSignature: signature,
      });
  }
  await mutateState((s) => {
    if (rulesSignature(s.rules) !== signature) return;
    for (const { key, history, seasonal } of results) {
      (s.climate ??= {})[key] = history;
      (s.seasonal ??= {})[key] = seasonal;
    }
    for (const assessment of ensembles)
      (s.ensembles ??= {})[assessment.key] = assessment;
  });
}
