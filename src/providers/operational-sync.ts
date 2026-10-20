import { readState, mutateState, saveSnapshot } from "@/persistence/store";
import { cellKey, rulesSignature } from "@/domain/evidence";
import { locationWarning } from "@/domain/types";
import { isFresh } from "@/domain/opportunity-report";
import { loadEnsemble } from "./research";
import { OpenMeteoProvider } from "./weather";
import { loadSeasonal } from "./long-range";
import { createSyncRunner, SyncTask } from "./sync-runner";
const fresh = (date: string | undefined, hours: number) =>
  isFresh(date, Date.now(), hours);
async function plan() {
  const state = await readState();
  const signature = rulesSignature(state.rules);
  const points = [
    ...new Map(
      state.pivots
        .filter((p) => !locationWarning(p))
        .map((p) => [cellKey(p.lat, p.lon), p]),
    ).entries(),
  ];
  const tasks: SyncTask[] = [];
  const weather = state.pivots.filter(
    (p) => !locationWarning(p) && !fresh(state.forecasts[p.id]?.fetchedAt, 1),
  );
  for (let i = 0; i < weather.length; i += 15) {
    const batch = weather.slice(i, i + 15);
    tasks.push({
      label: `Meteorología de equipos · ${Math.min(i + 15, weather.length)}/${weather.length}`,
      run: async () => {
        const results = await new OpenMeteoProvider().forecastMany(batch);
        for (let j = 0; j < batch.length; j++) {
          if (results[j]?.models.length)
            await saveSnapshot(batch[j].id, results[j]);
        }
        await mutateState((s) => {
          batch.forEach((p, j) => {
            if (
              results[j]?.models.length &&
              s.pivots.some(
                (current) =>
                  current.id === p.id &&
                  current.lat === p.lat &&
                  current.lon === p.lon,
              )
            )
              s.forecasts[p.id] = results[j];
          });
        });
        if (
          results.length !== batch.length ||
          results.some((r) => !r.models.length)
        )
          throw new Error(
            "Algunos equipos siguen sin meteorología. Se reintentarán las descargas pendientes.",
          );
      },
    });
  }
  // Bring useful short-term windows in first, before the much larger historical download.
  for (const [key, p] of points) {
    const cached = state.ensembles?.[key];
    if (
      fresh(cached?.fetchedAt, 3) &&
      cached?.rulesSignature === signature &&
      cached.sources.some((s) => s.usableMembers > 0) &&
      !cached.errors.length
    )
      continue;
    tasks.push({
      label: `Pronóstico de corto plazo · zona ${key}`,
      run: async () => {
        const result = await loadEnsemble(key, p.lat, p.lon, state.rules);
        await mutateState((s) => {
          if (rulesSignature(s.rules) === signature)
            (s.ensembles ??= {})[key] = result;
        });
        if (result.errors.length) throw new Error(result.errors.join(" · "));
      },
    });
  }
  // Refresh already trained zones without waiting for the initial ERA5 import
  // or the public map grid to finish in the background lane.
  for (const [key, p] of points) {
    const history = state.climate?.[key];
    const forecast = state.seasonal?.[key];
    if (
      !history ||
      history.years.length < 30 ||
      history.rulesSignature !== signature
    )
      continue;
    if (
      fresh(forecast?.fetchedAt, 12) &&
      forecast?.rulesSignature === signature &&
      !forecast.errors.length &&
      forecast.days[state.rules.deadline]
    )
      continue;
    tasks.push({
      label: `Pronóstico hasta fin de año · zona ${key}`,
      run: async () => {
        const result = await loadSeasonal(
          key,
          p.lat,
          p.lon,
          state.rules,
          history,
        );
        await mutateState((s) => {
          if (rulesSignature(s.rules) === signature)
            (s.seasonal ??= {})[key] = result;
        });
        if (result.errors.length) throw new Error(result.errors.join(" · "));
      },
    });
  }
  return tasks;
}
const shared = globalThis as unknown as {
  climatoOperationalSync?: ReturnType<typeof createSyncRunner>;
};
export const operationalSync = (shared.climatoOperationalSync ??=
  createSyncRunner(plan));
