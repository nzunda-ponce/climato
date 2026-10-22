import { loadEnvConfig } from "@next/env";
import { trainingHistoryCoverage } from "../src/ml/history-coverage";
loadEnvConfig(process.cwd());
// A separate CLI process owns training. Next only reads fitted trees.
process.env.CLIMATO_ROLE = "worker";

function safeError(error: unknown) {
  let text =
    error instanceof Error
      ? error.message
      : "No se pudo completar el entrenamiento.";
  for (const name of ["DATABASE_URL", "WEATHER_API_KEY"]) {
    const value = process.env[name];
    if (value) text = text.split(value).join("[oculto]");
  }
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s\"'`]+/gi, "[conexión ocultada]")
    .slice(0, 1000);
}
async function main() {
  const { readState, mutateState, acquireSyncLease, closeDatabase } =
    await import("../src/persistence/store");
  const { trainClimateModels, trainingFingerprint } =
    await import("../src/ml/train-climate");
  const { compatibleMachineLearning } =
    await import("../src/domain/machine-learning");
  const { publishPlanningReport } =
    await import("../src/persistence/published-report");
  const { localDate } = await import("../src/domain/types");
  const { cellKey, rulesSignature } = await import("../src/domain/evidence");
  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireSyncLease("machine-learning-training");
    if (!release)
      throw new Error(
        "Ya hay un entrenamiento en ejecución. Se conserva su avance.",
      );
    const state = await readState({
      namespaces: ["settings", "pivot", "climate", "climate-feature"],
    });
    const requiredArg = process.argv.find((arg) =>
      arg.startsWith("--require-years="),
    );
    if (requiredArg) {
      const required = Number(requiredArg.split("=")[1]);
      if (!Number.isInteger(required) || required < 21 || required > 45)
        throw new Error("--require-years debe ser un entero entre 21 y 45.");
      const coverage = trainingHistoryCoverage(state, required);
      if (!coverage.locations || coverage.missingSeasons)
        throw new Error(
          `Histórico incompleto: ${coverage.complete}/${coverage.locations} ubicaciones con ${required} temporadas. Completar el histórico antes de entrenar.`,
        );
    }
    const keys = new Set(
      state.pivots
        .filter((p) => p.status !== "TERMINADO")
        .map((p) => cellKey(p.lat, p.lon)),
    );
    const locations = Object.values(state.climate ?? {}).filter(
      (h) =>
        keys.has(h.key) && h.rulesSignature === rulesSignature(state.rules),
    );
    if (!locations.length)
      throw new Error(
        "No hay históricos compatibles para los equipos pendientes. Cargá históricos antes de entrenar.",
      );
    const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
    const limit = limitArg ? Number(limitArg.split("=")[1]) : locations.length;
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("--limit debe ser un entero positivo.");
    const refreshForecast = process.argv.includes("--refresh-forecast");
    let completed = 0,
      skipped = 0,
      failed = 0;
    for (const [index, history] of locations.slice(0, limit).entries()) {
      console.log(
        `[ML] Ubicación ${index + 1}/${Math.min(limit, locations.length)} · ${history.years.length} años disponibles`,
      );
      try {
        const fingerprint = trainingFingerprint(history);
        let artifact = compatibleMachineLearning(history);
        if (
          !process.argv.includes("--force") &&
          artifact?.fingerprint === fingerprint
        ) {
          console.log("[ML] Modelo vigente; se conserva.");
          skipped++;
          if (!refreshForecast) continue;
        } else {
          const trained = trainClimateModels(
            history,
            Number(localDate().slice(0, 4)),
            (message) => console.log(`[ML] ${message}`),
          );
          await mutateState(
            (s) => {
              const current = s.climate?.[history.key];
              if (
                !current ||
                rulesSignature(s.rules) !== history.rulesSignature ||
                current.fetchedAt !== history.fetchedAt ||
                current.rulesSignature !== history.rulesSignature ||
                JSON.stringify(current.days) !== JSON.stringify(history.days)
              )
                throw new Error(
                  "Los históricos cambiaron durante el entrenamiento. Se descartó el modelo para evitar mezclar versiones.",
                );
              current.machineLearning = trained;
            },
            { namespaces: ["settings", "climate"] },
          );
          artifact = trained;
          completed++;
        }
        const fitted = artifact;
        if (!fitted) throw new Error("No hay un modelo entrenado compatible.");
        const metric = (value: number | null) =>
          value === null ? "sin muestra" : value.toFixed(3);
        console.log(
          `[ML] Brier de prueba final · meteorología: ${metric(artifact.weather.test.brier)} (base ${metric(artifact.weather.test.baselineBrier)}); calendario: ${metric(artifact.calendar.test.brier)} (base ${metric(artifact.calendar.test.baselineBrier)})`,
        );
        console.log(
          `[ML] Selección tras validación y prueba final · meteorología ${artifact.weather.accepted ? "ML seleccionado" : "se conserva análogos"}; calendario ${artifact.calendar.accepted ? "ML seleccionado" : "se conserva referencia semanal"}.`,
        );
        if (artifact.weather.accepted) {
          try {
            const { loadSeasonal } =
              await import("../src/providers/long-range");
            const forecast = await loadSeasonal(
              history.key,
              history.lat,
              history.lon,
              state.rules,
              { ...history, machineLearning: artifact },
              !refreshForecast,
            );
            await mutateState(
              (s) => {
                if (
                  s.climate?.[history.key]?.machineLearning?.fingerprint ===
                    fitted.fingerprint &&
                  rulesSignature(s.rules) === fitted.rulesSignature
                )
                  (s.seasonal ??= {})[history.key] = forecast;
              },
              { namespaces: ["settings", "climate", "seasonal"] },
            );
            console.log(
              refreshForecast
                ? "[ML] Escenarios estacionales vigentes procesados con el modelo ML."
                : "[ML] Escenarios estacionales en caché recalculados sin descargar datos nuevos.",
            );
          } catch (error) {
            console.log(
              "[ML] Sin escenarios estacionales compatibles en caché. El modelo meteorológico queda preparado para la próxima descarga.",
            );
            if (refreshForecast) {
              console.error(`[ML] ${safeError(error)}`);
              failed++;
            }
          }
        }
        await publishPlanningReport(true);
      } catch (error) {
        failed++;
        console.error(`[ML] ${safeError(error)}`);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    console.log(
      `[ML] Terminados: ${completed}; vigentes: ${skipped}; sin completar: ${failed}. Los modelos guardados sobreviven al reinicio.`,
    );
    if (failed) process.exitCode = 1;
  } finally {
    if (release) await release();
    await closeDatabase();
  }
}
void main().catch((error) => {
  console.error(`[ML] ${safeError(error)}`);
  console.error(
    "[ML] No se pudo iniciar o completar el entrenamiento. Revisá la disponibilidad de históricos y la conexión a la base; los datos guardados se conservan.",
  );
  process.exitCode = 1;
});
