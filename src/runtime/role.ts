// Local installations keep their existing background scheduler. Hosted report
// servers only read published results; a separate process owns all downloads.
export function isReportServer() {
  return (
    process.env.CLIMATO_ROLE === "web" ||
    (process.env.VERCEL === "1" && process.env.CLIMATO_ROLE !== "worker")
  );
}
export function reportRequestAllowed(path: string, method: string) {
  return (
    ["GET", "HEAD"].includes(method) &&
    [
      "/api/planning",
      "/api/validation",
      "/api/storage",
      "/api/auto-sync",
      "/api/dev-version",
    ].includes(path.replace(/\/$/, ""))
  );
}
