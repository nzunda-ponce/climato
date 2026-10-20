export interface SyncStatus {
  running: boolean;
  message: string;
  completed: number;
  total: number;
  errors: string[];
  retryAt: number;
}
export interface SyncTask {
  label: string;
  run: () => Promise<void>;
}

// Shared by all tabs. Only one automatic import runs in this server process.
export function createSyncRunner(
  plan: () => Promise<SyncTask[]>,
  now = Date.now,
  acquire?: () => Promise<(() => Promise<void>) | undefined>,
) {
  const status: SyncStatus = {
    running: false,
    message: "",
    completed: 0,
    total: 0,
    errors: [],
    retryAt: 0,
  };
  let pending: Promise<void> | undefined;
  let invalidated = false;
  let failures = 0;
  function invalidate() {
    invalidated = true;
    failures = 0;
    status.retryAt = 0;
  }
  function start() {
    if (pending) return pending;
    if (now() < status.retryAt) return Promise.resolve();
    invalidated = false;
    Object.assign(status, {
      running: true,
      message: "Preparando carga automática",
      completed: 0,
      total: 0,
      errors: [],
    });
    pending = (async () => {
      let release: (() => Promise<void>) | undefined;
      let elsewhere = false;
      try {
        if (acquire) {
          release = await acquire();
          if (!release) {
            elsewhere = true;
            return;
          }
        }
        const tasks = await plan();
        status.total = tasks.length;
        for (const task of tasks) {
          if (invalidated) break;
          status.message = task.label;
          try {
            await task.run();
          } catch (e) {
            status.errors.push(
              `${task.label}: ${e instanceof Error ? e.message : "Error de descarga"}`,
            );
          }
          status.completed++;
        }
      } catch (e) {
        status.errors.push(
          e instanceof Error ? e.message : "No se pudo iniciar la carga",
        );
      } finally {
        if (release)
          try {
            await release();
          } catch {
            status.errors.push(
              "No se pudo liberar la coordinación; se recuperará por vencimiento.",
            );
          }
        failures = status.errors.length ? Math.min(failures + 1, 8) : 0;
        const retryMinutes = Math.min(360, 5 * 2 ** Math.max(0, failures - 1));
        status.running = false;
        status.message = invalidated
          ? "Recalculando con las nuevas reglas"
          : elsewhere
            ? "Actualización en otro proceso"
            : status.errors.length
              ? `Carga parcial. Reintentaremos automáticamente en ${retryMinutes} minutos.`
              : "Datos actualizados";
        status.retryAt = invalidated
          ? 0
          : now() +
            (elsewhere
              ? 5 * 60000
              : status.errors.length
                ? retryMinutes * 60000
                : 60 * 60000);
        pending = undefined;
      }
    })();
    return pending;
  }
  return { status, start, invalidate };
}
