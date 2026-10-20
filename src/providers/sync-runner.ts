function describeError(error: unknown, fallback: string) {
  let text = error instanceof Error ? error.message : fallback;
  for (const key of ["DATABASE_URL", "WEATHER_API_KEY"]) {
    const secret = process.env[key];
    if (secret) text = text.split(secret).join("[oculto]");
  }
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s\"'`]+/gi, "[conexión ocultada]")
    .replace(/(apikey=)[^&\s]+/gi, "$1[oculto]")
    .slice(0, 1800);
}

export interface SyncStatus {
  running: boolean;
  message: string;
  completed: number;
  total: number;
  errors: string[];
  retryAt: number;
  deferred?: boolean;
  updatedAt?: string;
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
  hooks: {
    onStatus?: (status: SyncStatus) => Promise<void>;
    afterTask?: () => Promise<void>;
    stopOnRateLimit?: boolean;
    maxTasks?: () => number;
    maxMs?: () => number;
  } = {},
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
      deferred: false,
    });
    pending = (async () => {
      let release: (() => Promise<void>) | undefined;
      let elsewhere = false;
      const started = now();
      let blockedUntil = 0;
      async function notify() {
        if (hooks.onStatus)
          try {
            await hooks.onStatus({ ...status, errors: [...status.errors] });
          } catch {
            status.errors.push("No se pudo guardar el estado del proceso.");
          }
      }
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
          if (
            (hooks.maxTasks?.() && status.completed >= hooks.maxTasks!()) ||
            (hooks.maxMs?.() && now() - started >= hooks.maxMs!())
          ) {
            status.deferred = true;
            break;
          }
          status.message = task.label;
          await notify();
          try {
            await task.run();
          } catch (e) {
            if (
              hooks.stopOnRateLimit &&
              e instanceof Error &&
              /HTTP 429/.test(e.message)
            )
              status.deferred = true;
            status.errors.push(
              `${task.label}: ${describeError(e, "Error de descarga")}`,
            );
          }
          status.completed++;
          if (hooks.afterTask)
            try {
              await hooks.afterTask();
            } catch {
              status.errors.push(
                "Los datos se guardaron pero no se pudo publicar el informe actualizado.",
              );
            }
          if (status.deferred) break;
        }
      } catch (e) {
        if (e instanceof Error && "retryAt" in e)
          blockedUntil = Number(e.retryAt) || 0;
        status.errors.push(describeError(e, "No se pudo iniciar la carga"));
      } finally {
        failures = status.errors.length ? Math.min(failures + 1, 8) : 0;
        const retryMinutes =
          hooks.stopOnRateLimit && status.errors.some((e) => /HTTP 429/.test(e))
            ? 60
            : Math.min(360, 5 * 2 ** Math.max(0, failures - 1));
        status.running = false;
        status.message = invalidated
          ? "Recalculando con las nuevas reglas"
          : status.deferred
            ? "Avance guardado. La preparación continuará en la próxima ejecución."
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
        status.retryAt = Math.max(status.retryAt, blockedUntil);
        if (!elsewhere) await notify();
        if (release)
          try {
            await release();
          } catch {
            status.errors.push(
              "La coordinación se recuperará por vencimiento.",
            );
          }
        pending = undefined;
      }
    })();
    return pending;
  }
  return { status, start, invalidate };
}
