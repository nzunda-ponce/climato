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
  function start() {
    if (pending) return pending;
    if (now() < status.retryAt) return Promise.resolve();
    Object.assign(status, {
      running: true,
      message: "Preparando carga automática",
      completed: 0,
      total: 0,
      errors: [],
    });
    pending = (async () => {
      try {
        const tasks = await plan();
        status.total = tasks.length;
        for (const task of tasks) {
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
        status.running = false;
        status.message = status.errors.length
          ? "Carga parcial. Reintentaremos automáticamente en 5 minutos."
          : "Datos actualizados";
        status.retryAt =
          now() + (status.errors.length ? 5 * 60000 : 60 * 60000);
        pending = undefined;
      }
    })();
    return pending;
  }
  return { status, start };
}
