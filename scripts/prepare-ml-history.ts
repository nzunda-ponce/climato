import { loadEnvConfig } from "@next/env";
import { trainingHistoryCoverage } from "../src/ml/history-coverage";
loadEnvConfig(process.cwd());
process.env.CLIMATO_ROLE = "worker";
process.env.CLIMATO_JOB_MAX_MINUTES = "45";
process.env.CLIMATO_JOB_MAX_TASKS = "0";

async function main() {
  if (!process.env.DATABASE_URL?.trim())
    throw new Error(
      "Se requiere la base compartida para preparar el entrenamiento.",
    );
  const { readState, closeDatabase } = await import("../src/persistence/store");
  const { autoSync } = await import("../src/providers/auto-sync");
  try {
    for (let pass = 0; pass < 4; pass++) {
      const state = await readState({
        namespaces: ["settings", "pivot", "climate"],
      });
      const coverage = trainingHistoryCoverage(state);
      if (!coverage.locations)
        throw new Error("No hay ubicaciones activas válidas.");
      console.log(
        `[ML] Históricos ${coverage.years[0]}–${coverage.years.at(-1)}: ${coverage.complete}/${coverage.locations} ubicaciones completas; faltan ${coverage.missingSeasons} temporadas-ubicación.`,
      );
      if (!coverage.missingSeasons) return;
      if (pass) {
        // A quota pause is persisted by the runner. Respect it across passes.
        const quota = autoSync.status.errors.some((message) =>
          /HTTP 429|proveedor está en pausa/.test(message),
        );
        const delay = quota
          ? Math.max(0, autoSync.status.retryAt - Date.now())
          : [60000, 300000, 900000][pass - 1];
        console.log(
          `[ML] Reanudación ${pass + 1}/4 en ${Math.ceil(delay / 60000)} minutos; el avance está guardado.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      autoSync.invalidate();
      await autoSync.start();
      for (const error of new Set(autoSync.status.errors)) console.warn(error);
    }
    const coverage = trainingHistoryCoverage(
      await readState({ namespaces: ["settings", "pivot", "climate"] }),
    );
    if (coverage.missingSeasons)
      throw new Error(
        `Faltan ${coverage.missingSeasons} temporadas-ubicación. No se iniciará un entrenamiento con menos historia; volver a ejecutar reanuda lo pendiente.`,
      );
  } finally {
    await closeDatabase();
  }
}
void main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "No se pudo completar el histórico.",
  );
  process.exitCode = 1;
});
