import {
  buildPlanningReport,
  type PlanningReport,
} from "@/domain/planning-report";
import { localDate } from "@/domain/types";
import { getDatabase, readState } from "./store";
import { makeRecord, unpack } from "./records";
import { isReportServer } from "@/runtime/role";
interface Publication {
  report: PlanningReport;
  revision: string | null;
  at: string;
  validUntil?: number;
}
let lastPublish = 0;
const shared = globalThis as unknown as {
  climatoPublishedCache?: { hash: string; value: Publication };
};
// Build outside the write transaction. Publish only if the source revision is
// still current; concurrent readers retain the previous complete publication.
export async function publishPlanningReport(force = false): Promise<boolean> {
  if (!force && Date.now() - lastPublish < 60000) return false;
  const db = await getDatabase();
  for (let attempt = 0; attempt < (force ? 3 : 1); attempt++) {
    const before = await db.read((tx) => tx.get("system", "revision"));
    const state = await readState({ purpose: "planning" });
    if (!state.pivots.length) return false;
    const report = buildPlanningReport(state);
    const expiry = report.zones.flatMap((z) => [
      ...(z.outlook.some((d) => d.source === "pronóstico") &&
      z.sources.ensembleAt
        ? [Date.parse(z.sources.ensembleAt) + 12 * 3600000]
        : []),
      ...(z.outlook.some(
        (d) => d.source === "subestacional" || d.source === "estacional",
      ) && z.sources.seasonalAt
        ? [Date.parse(z.sources.seasonalAt) + 36 * 3600000]
        : []),
    ]);
    const validUntil = Math.min(Date.now() + 3 * 3600000, ...expiry);
    const published = await db.transaction(async (tx) => {
      const current = await tx.get("system", "revision");
      if (current?.hash !== before?.hash) return false;
      await tx.put(
        makeRecord("published", "planning", {
          report,
          validUntil,
          revision: current?.hash ?? null,
          at: new Date().toISOString(),
        } satisfies Publication),
      );
      return true;
    });
    if (published) {
      lastPublish = Date.now();
      return true;
    }
  }
  return false;
}
export async function readPublishedPlanningReport(
  now = new Date(),
): Promise<PlanningReport | null> {
  const db = await getDatabase();
  return db.read(async (tx) => {
    const meta = (
      await tx.list({
        namespaces: ["published"],
        keys: ["planning"],
        metadataOnly: true,
      })
    )[0];
    if (!meta) return null;
    let value =
      shared.climatoPublishedCache?.hash === meta.hash
        ? shared.climatoPublishedCache.value
        : undefined;
    if (!value) {
      const row = await tx.get("published", "planning");
      if (!row) return null;
      value = unpack<Publication>(row);
      shared.climatoPublishedCache = { hash: row.hash, value };
    }
    const revision = await tx.get("system", "revision");
    return {
      ...structuredClone(value.report),
      publication: {
        at: value.at,
        readOnly: isReportServer(),
        pendingChanges: (revision?.hash ?? null) !== value.revision,
        stale:
          localDate(now) !== value.report.today ||
          now.getTime() >
            (value.validUntil ?? Date.parse(value.at) + 3 * 3600000),
      },
    };
  });
}
