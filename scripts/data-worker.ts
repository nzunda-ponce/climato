import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
// Set before any data modules are imported: this process owns writes, while
// Vercel/the public web is always a reader of complete publications.
process.env.CLIMATO_ROLE = "worker";
if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "El proceso compartido requiere DATABASE_URL. No se usará una base local vacía.",
  );
  process.exit(1);
}
const mode = process.argv[2] ?? "refresh";
if (!["refresh", "bootstrap", "publish"].includes(mode)) {
  console.error("Usar refresh, bootstrap o publish.");
  process.exit(1);
}
// A bounded pass checkpoints every task. The next run replans only missing years.
process.env.CLIMATO_JOB_MAX_MINUTES ??= mode === "bootstrap" ? "30" : "20";
async function main() {
  const { closeDatabase } = await import("../src/persistence/store");
  const { publishPlanningReport } =
    await import("../src/persistence/published-report");
  try {
    if (mode === "refresh") {
      const { operationalSync } =
        await import("../src/providers/operational-sync");
      await operationalSync.start();
      await publishPlanningReport(true);
      const { verificationSync } =
        await import("../src/providers/verification-sync");
      await verificationSync.start();
      console.log(
        `Pronósticos: ${operationalSync.status.completed}/${operationalSync.status.total} tareas; ${operationalSync.status.errors.length} errores.`,
      );
      if (
        operationalSync.status.errors.length ||
        verificationSync.status.errors.length
      ) {
        // Runner errors are already redacted for public job status.
        for (const message of new Set([
          ...operationalSync.status.errors,
          ...verificationSync.status.errors,
        ]))
          console.warn(message);
        process.exitCode = 1;
      }
    }
    if (mode === "bootstrap") {
      const { autoSync } = await import("../src/providers/auto-sync");
      await autoSync.start();
      console.log(
        `Históricos: ${autoSync.status.completed}/${autoSync.status.total} tareas. ${autoSync.status.message}`,
      );
      if (autoSync.status.errors.length) process.exitCode = 1;
    }
    if (!(await publishPlanningReport(true)))
      throw new Error(
        "No se pudo publicar un informe completo de la campaña existente.",
      );
    console.log(
      "Informe publicado en la base compartida. La web no realiza estas descargas.",
    );
  } catch {
    console.error(
      "El proceso no pudo completar esta ejecución. Los avances confirmados se conservan; revisá el estado de las fuentes y la conexión.",
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
void main().catch(() => {
  console.error("No se pudo iniciar el proceso de datos.");
  process.exitCode = 1;
});
