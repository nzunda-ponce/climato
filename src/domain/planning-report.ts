import {
  buildOpportunityReport,
  ReportState,
  isFresh,
  scenarioConsecutiveDays,
  reportDates,
} from "./opportunity-report";
import { dayEvidence } from "./forecast-validation";
import { rulesSignature } from "./evidence";

export function buildPlanningReport(state: ReportState, now = new Date()) {
  const report = buildOpportunityReport(state, now),
    signature = rulesSignature(state.rules);
  return {
    ...report,
    zones: report.zones.map((zone) => {
      const e = state.ensembles?.[zone.key];
      const valid =
        e?.rulesSignature === signature &&
        isFresh(e.fetchedAt, now.getTime(), 12);
      return {
        ...zone,
        consecutive7:
          valid && zone.next7.scenarios
            ? scenarioConsecutiveDays(
                e.paths,
                reportDates(zone.next7.start, zone.next7.end),
              )
            : null,
        consecutive14:
          valid && zone.next14.scenarios
            ? scenarioConsecutiveDays(
                e.paths,
                reportDates(zone.next14.start, zone.next14.end),
              )
            : null,
        training:
          state.climate?.[zone.key]?.rulesSignature === signature
            ? (state.climate[zone.key].validation ?? null)
            : null,
        daily: zone.daily
          .filter((d) => d.date >= report.start)
          .map((d) => {
            const evidence = valid ? dayEvidence(e, d.date) : null;
            const windows = valid
              ? e.windows
                  .filter((w) => w.start.startsWith(d.date))
                  .map((w) => ({
                    start: w.start,
                    end: w.end,
                    hours: w.hours,
                    probability: w.probability,
                    families: w.families ?? 0,
                    members: w.members,
                    coverage:
                      w.coverage === undefined ? null : w.coverage / 100,
                    supported:
                      (w.familyEvidence?.length ?? 0) >= 2 &&
                      w.familyEvidence!.every(
                        (g) => g.usable >= 10 && g.usable / g.total >= 0.8,
                      ),
                    basis: w.basis ?? "model-agreement",
                  }))
              : [];
            return {
              ...d,
              probability: evidence?.supported ? evidence.probability : null,
              supported: evidence?.supported ?? false,
              evidence: evidence?.groups ?? [],
              windows,
              followingConsecutive:
                valid && d.following
                  ? scenarioConsecutiveDays(
                      e.paths,
                      reportDates(
                        new Date(Date.parse(d.date + "T12:00Z") + 86400000)
                          .toISOString()
                          .slice(0, 10),
                        d.followingEnd,
                      ),
                      d.date,
                    )
                  : null,
            };
          }),
      };
    }),
  };
}
export type PlanningReport = ReturnType<typeof buildPlanningReport>;
export type PlanningZone = PlanningReport["zones"][number];
