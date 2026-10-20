import { verificationSync } from "./verification-sync";
import { autoSync } from "./auto-sync";
import { operationalSync } from "./operational-sync";

const shared = globalThis as unknown as {
  climatoSyncTimer?: ReturnType<typeof setInterval>;
};
export function startAutoSyncScheduler() {
  // The shared cloud database is refreshed by GitHub Actions twice daily.
  // Opening another local installation must not start additional API imports.
  if (process.env.DATABASE_URL?.trim()) return;
  if (shared.climatoSyncTimer) return;
  const tick = async () => {
    try {
      // Short-term refresh has its own lane: a large ERA5 import must not
      // prevent tomorrow's report from receiving a new weather forecast.
      void operationalSync.start();
      void autoSync.start();
      void verificationSync.start();
    } catch (e) {
      console.error(
        "Actualización automática:",
        e instanceof Error ? e.message : "Error de persistencia",
      );
    }
  };
  shared.climatoSyncTimer = setInterval(() => void tick(), 60000);
  shared.climatoSyncTimer.unref();
  void tick();
}
