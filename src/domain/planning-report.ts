import {
  buildOpportunityReport,
  ReportState,
  isFresh,
  scenarioConsecutiveDays,
  reportDates,
  summarizeReportPeriod,
} from "./opportunity-report";
import { dayEvidence } from "./forecast-validation";
import { historyDay, historyPeriod } from "./history-outlook";
import { addDays } from "./types";
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
      const history = state.climate?.[zone.key];
      const seasonal = state.seasonal?.[zone.key];
      const seasonalValid =
        seasonal?.rulesSignature === signature &&
        isFresh(seasonal.fetchedAt, now.getTime(), 36);
      const outlook = reportDates(report.start, report.deadline).map((date) => {
        const evidence = valid ? dayEvidence(e, date) : null;
        const predicted = seasonalValid ? seasonal.days[date] : undefined;
        const historical = historyDay(history, state.rules, date);
        const source =
          evidence?.supported && date <= addDays(report.today, 14)
            ? ("pronóstico" as const)
            : predicted?.probability !== null &&
                predicted?.probability !== undefined
              ? predicted.source === "EC46"
                ? ("subestacional" as const)
                : ("estacional" as const)
              : historical
                ? ("histórico" as const)
                : ("sin datos" as const);
        return {
          date,
          source,
          probability:
            source === "pronóstico"
              ? evidence!.probability
              : source === "subestacional" || source === "estacional"
                ? predicted!.probability
                : (historical?.probability ?? null),
          slots:
            source === "pronóstico"
              ? (zone.daily.find((d) => d.date === date)?.slots ?? null)
              : source === "subestacional" || source === "estacional"
                ? predicted!.slots
                : (historical?.slots ?? null),
          historyYears: historical?.years ?? 0,
        };
      });
      const summarize = (start: string, end: string) => {
        const days = outlook.filter((d) => d.date >= start && d.date <= end);
        const summary = summarizeReportPeriod(days, start, end);
        return {
          ...summary,
          historicalDays: days.filter((d) => d.source === "histórico").length,
          historicalReference: historyPeriod(
            history,
            state.rules,
            reportDates(start, end),
          ),
        };
      };
      const weekly = [];
      for (
        let start = report.start;
        start <= report.deadline;
        start = addDays(start, 7)
      )
        weekly.push(
          summarize(
            start,
            addDays(start, 6) < report.deadline
              ? addDays(start, 6)
              : report.deadline,
          ),
        );
      return {
        ...zone,
        sources: {
          ...zone.sources,
          historyAt:
            history?.rulesSignature === signature ? history.fetchedAt : null,
          historyYears:
            history?.rulesSignature === signature ? history.years.length : 0,
        },
        weekly,
        remaining: summarize(report.start, report.deadline),
        next7: {
          ...summarize(zone.next7.start, zone.next7.end),
          scenarios: zone.next7.scenarios,
        },
        next14: {
          ...summarize(zone.next14.start, zone.next14.end),
          scenarios: zone.next14.scenarios,
        },
        dataStatus: !e
          ? state.ensembleFailures?.[zone.key]
            ? ("failed" as const)
            : ("loading" as const)
          : !valid
            ? ("outdated" as const)
            : e.errors.length
              ? ("partial" as const)
              : ("ready" as const),
        dataErrors: state.ensembleFailures?.[zone.key]
          ? [state.ensembleFailures[zone.key].message]
          : (e?.errors ?? []),
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
        daily: outlook
          .filter((d) => d.date <= addDays(report.today, 14))
          .map((resolved) => {
            const previous = zone.daily.find((d) => d.date === resolved.date);
            const d = { ...previous!, ...resolved };
            const evidence = valid ? dayEvidence(e, d.date) : null;
            const windows =
              valid && resolved.source === "pronóstico"
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
                        (w.familyEvidence?.filter(
                          (g) => g.usable >= 10 && g.usable / g.total >= 0.8,
                        ).length ?? 0) >= 2,
                      basis: w.basis ?? "model-agreement",
                    }))
                : [];
            return {
              ...d,
              probability: resolved.probability,
              supported: resolved.probability !== null,
              forecastSupported: evidence?.supported ?? false,
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
