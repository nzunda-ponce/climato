import {
  buildPlanningReport,
  type PlanningReport,
} from "@/domain/planning-report";
import { localDate } from "@/domain/types";
import { getDatabase, readPlanningSnapshot } from "./store";
import { makeRecord, unpack } from "./records";
import { isReportServer } from "@/runtime/role";
import { splitWorkZones } from "@/domain/work-zones";
interface Publication {
  report: PlanningReport;
  revision: string | null;
  at: string;
  validUntil?: number;
  sourceUpdatedAt?: number;
}
let lastPublish = 0;
const shared = globalThis as unknown as {
  climatoPublishedCache?: { hash: string; value: Publication };
};
// Build a consistent snapshot outside the write transaction. Ongoing imports
// may advance the source; they must not starve publication. A slower publisher
// must still never replace a publication built from newer data.
export async function publishPlanningReport(force = false): Promise<boolean> {
  if (!force && Date.now() - lastPublish < 60000) return false;
  const db = await getDatabase();
  const startedAt = Date.now();
  const { state, revision, sourceUpdatedAt } = await readPlanningSnapshot();
  if (!state.pivots.length) return false;
  const report = buildPlanningReport(state);
  const expiry = report.zones.flatMap((z) => [
    ...(z.outlook.some((d) => d.source === "pronóstico") && z.sources.ensembleAt
      ? [Date.parse(z.sources.ensembleAt) + 12 * 3600000]
      : []),
    ...(z.outlook.some(
      (d) => d.source === "subestacional" || d.source === "estacional",
    ) && z.sources.seasonalAt
      ? [Date.parse(z.sources.seasonalAt) + 36 * 3600000]
      : []),
  ]);
  const validUntil = Math.min(Date.now() + 13 * 3600000, ...expiry);
  await db.transaction(async (tx) => {
    const existing = await tx.get("published", "planning");
    if (existing) {
      const previous = unpack<Publication>(existing);
      if (
        (previous.sourceUpdatedAt ?? 0) > sourceUpdatedAt ||
        ((previous.sourceUpdatedAt ?? 0) === sourceUpdatedAt &&
          Date.parse(previous.at) > startedAt)
      )
        return true;
    }
    await tx.put(
      makeRecord("published", "planning", {
        report,
        validUntil,
        revision,
        sourceUpdatedAt,
        at: new Date().toISOString(),
      } satisfies Publication),
    );
    return true;
  });
  lastPublish = Date.now();
  return true;
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
      zones: structuredClone(value.report.zones).flatMap(splitWorkZones),
      publication: {
        at: value.at,
        readOnly: isReportServer(),
        pendingChanges: (revision?.hash ?? null) !== value.revision,
        stale:
          localDate(now) !== value.report.today ||
          now.getTime() >
            (value.validUntil ?? Date.parse(value.at) + 13 * 3600000),
      },
    };
  });
}
