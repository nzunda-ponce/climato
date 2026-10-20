import { readState, mutateState, saveSnapshot } from "@/persistence/store";
import { cellKey, rulesSignature } from "@/domain/evidence";
import { locationWarning } from "@/domain/types";
import { isFresh } from "@/domain/opportunity-report";
import { fairEnsembleOrder } from "./ensemble-order";
import { loadEnsembleBatch } from "./research";
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
        .filter((p) => !locationWarning(p) && p.status !== "TERMINADO")
        .map((p) => [cellKey(p.lat, p.lon), p]),
    ).entries(),
  ];
  const tasks: SyncTask[] = [
    {
      label: "Archivando estimaciones para validación",
      run: () => mutateState(() => {}),
    },
  ];
  const weatherTasks: SyncTask[] = [];
  const weather = state.pivots.filter(
    (p) =>
      !locationWarning(p) &&
      p.status !== "TERMINADO" &&
      !fresh(state.forecasts[p.id]?.fetchedAt, 1),
  );
  for (let i = 0; i < weather.length; i += 15) {
    const batch = weather.slice(i, i + 15);
    weatherTasks.push({
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
  // Missing locations first, interleaved by work region so no region waits
  // behind all the equipment in another region. Coordinate requests are batched.
  const pending = points.filter(([key]) => {
    const e = state.ensembles?.[key];
    return (
      !fresh(e?.fetchedAt, 3) ||
      e?.rulesSignature !== signature ||
      !!e.errors.length
    );
  });
  const ordered = fairEnsembleOrder(pending, (key) => !!state.ensembles?.[key]);
  for (let i = 0; i < ordered.length; i += 6) {
    const batch = ordered
      .slice(i, i + 6)
      .map(([key, p]) => ({ key, lat: p.lat, lon: p.lon }));
    tasks.push({
      label: `Estimación integrada · ${Math.min(i + 6, ordered.length)}/${ordered.length} ubicaciones`,
      run: async () => {
        const results = await loadEnsembleBatch(batch, state.rules);
        await mutateState((s) => {
          if (rulesSignature(s.rules) !== signature) return;
          for (const result of results) {
            if (
              !s.pivots.some((p) => cellKey(p.lat, p.lon) === result.point.key)
            )
              continue;
            if (result.assessment)
              (s.ensembles ??= {})[result.point.key] = result.assessment;
            if (result.error)
              (s.ensembleFailures ??= {})[result.point.key] = {
                at: new Date().toISOString(),
                message: result.error,
              };
            else if (s.ensembleFailures)
              delete s.ensembleFailures[result.point.key];
          }
        });
        const errors = results.filter((r) => r.error);
        if (errors.length)
          throw new Error(
            `${errors.length} ubicaciones con descargas incompletas; reintento automático.`,
          );
      },
    });
  }
  tasks.push(...weatherTasks);
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
