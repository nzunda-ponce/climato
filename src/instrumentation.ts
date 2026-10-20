import { isReportServer } from "./runtime/role";
export async function register() {
  if (
    !isReportServer() &&
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startAutoSyncScheduler } =
      await import("./providers/sync-scheduler");
    startAutoSyncScheduler();
  }
}
