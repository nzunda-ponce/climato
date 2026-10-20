import {
  createSyncRunner,
  type SyncTask,
  type SyncStatus,
} from "@/providers/sync-runner";
import { acquireSyncLease, getDatabase } from "@/persistence/store";
import { makeRecord, unpack } from "@/persistence/records";
import { publishPlanningReport } from "@/persistence/published-report";
export function createDataRunner(
  name: string,
  plan: () => Promise<SyncTask[]>,
) {
  return createSyncRunner(
    async () => {
      const db = await getDatabase();
      const row = await db.read((tx) =>
        tx.get("system", "provider-paused-until"),
      );
      const until = row ? unpack<number>(row) : 0;
      if (until > Date.now())
        throw Object.assign(
          new Error(
            "El proveedor está en pausa por límite de solicitudes. Se conservaron los datos y se reintentará más tarde.",
          ),
          { retryAt: until },
        );
      return plan();
    },
    Date.now,
    () => acquireSyncLease(name),
    {
      stopOnRateLimit: true,
      maxTasks: () => Number(process.env.CLIMATO_JOB_MAX_TASKS) || 0,
      maxMs: () => (Number(process.env.CLIMATO_JOB_MAX_MINUTES) || 0) * 60000,
      async onStatus(status) {
        const copy = {
          ...status,
          errors: [...status.errors].slice(-30),
          updatedAt: new Date().toISOString(),
        };
        if (process.env.CLIMATO_ROLE === "worker" && !copy.running) {
          copy.retryAt = 0;
          if (copy.errors.length || copy.deferred)
            copy.message =
              "Avance guardado. El proceso continuará en la próxima ejecución programada.";
        }
        const db = await getDatabase();
        await db.transaction(async (tx) => {
          await tx.put(makeRecord("job", name, copy));
          if (!status.running && status.errors.some((e) => /HTTP 429/.test(e)))
            await tx.put(
              makeRecord("system", "provider-paused-until", status.retryAt),
            );
        });
        if (!status.running) await publishPlanningReport(true);
      },
      afterTask: async () => {
        await publishPlanningReport();
      },
    },
  );
}
export async function readDataJobStatus(): Promise<SyncStatus> {
  const db = await getDatabase();
  return db.read(async (tx) => {
    const rows = await tx.list({ namespaces: ["job", "lease"] });
    const jobs = rows
      .filter((r) => r.namespace === "job")
      .map((r) => {
        const status = unpack<SyncStatus>(r),
          lease = rows.find((l) => l.namespace === "lease" && l.key === r.key);
        const active =
          !!lease && unpack<{ until: number }>(lease).until > Date.now();
        return {
          ...status,
          running: status.running && active,
          interrupted: status.running && !active,
        };
      });
    const current =
      jobs.find((j) => j.running) ?? jobs.find((j) => j.interrupted) ?? jobs[0];
    if (!current)
      return {
        running: false,
        message: "Todavía no se registró una ejecución del proceso de datos.",
        completed: 0,
        total: 0,
        errors: [],
        retryAt: 0,
      };
    return {
      ...current,
      message: current.interrupted
        ? "El proceso se interrumpió. El avance está guardado para la próxima ejecución."
        : current.message,
      errors: [...new Set(jobs.flatMap((j) => j.errors))],
    };
  });
}
