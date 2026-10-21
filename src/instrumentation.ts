import { isReportServer } from "./runtime/role";
import { startInBackground } from "./runtime/background-startup";

const shared = globalThis as unknown as {
  climatoSchedulerStartupScheduled?: boolean;
};

export function register() {
  if (
    !isReportServer() &&
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    !process.env.DATABASE_URL?.trim() &&
    !shared.climatoSchedulerStartupScheduled
  ) {
    shared.climatoSchedulerStartupScheduled = true;
    startInBackground(
      async () => {
        const { startAutoSyncScheduler } =
          await import("./providers/sync-scheduler");
        startAutoSyncScheduler();
      },
      () => {
        delete shared.climatoSchedulerStartupScheduled;
        console.error(
          "[Climato] No se pudo iniciar la actualización meteorológica. La página sigue disponible; reiniciá el servidor para reintentar.",
        );
      },
    );
  }
}
