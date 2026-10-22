import type { HistoricalClimate } from "../domain/evidence";
import type { ClimateMachineLearning } from "../domain/boosted-model";
import { historicalModel } from "../domain/history-model";
import { historicalWeek, historicalWeekSample } from "../domain/history-weeks";
import { analogueModel } from "../domain/seasonal";
import { calendarFeatures, weatherFeatures } from "../domain/ml-features";
import type { TrainingRow } from "./gradient-boosting";

// Shared by training and read-only diagnostics so test cohorts stay identical.
export function prepareTrainingRows(
  history: HistoricalClimate,
  splits: ClimateMachineLearning["splits"],
  targetYears?: number[],
) {
  const years = [
    ...splits.train,
    ...splits.tune,
    ...splits.calibration,
    ...splits.test,
  ];
  const features = (history.features ?? []).filter(
    (row) =>
      years.includes(Number(row.date.slice(0, 4))) &&
      Number.isFinite(row.wind) &&
      row.wind >= 0 &&
      Number.isFinite(row.rain) &&
      row.rain >= 0,
  );
  const lookup = new Map(features.map((row) => [row.date, row]));
  const trainingHistory = {
    ...history,
    years: splits.train,
    machineLearning: undefined,
  };
  const analogues = analogueModel(
    features.filter((row) =>
      splits.train.includes(Number(row.date.slice(0, 4))),
    ),
  );
  const baselineFit = historicalModel(trainingHistory, splits.tune[0]);
  const weeklyCache = new Map<string, number | null>();
  const weeklyBaseline = (date: string) => {
    const week = historicalWeek(date);
    if (!weeklyCache.has(week.start)) {
      const samples = baselineFit.trainingYears.flatMap((year) => {
        const sample = historicalWeekSample(
          week.dates.map((day) => history.days[`${year}${day.slice(4)}`]),
        );
        return sample ? [sample.probability] : [];
      });
      weeklyCache.set(
        week.start,
        samples.length >= 10
          ? (samples.reduce((sum, p) => sum + p, 0) + baselineFit.model.prior) /
              (samples.length + 2 * baselineFit.model.prior)
          : null,
      );
    }
    return weeklyCache.get(week.start) ?? null;
  };
  const weatherRows: TrainingRow[] = [],
    calendarRows: TrainingRow[] = [];
  for (const [date, slots] of Object.entries(history.days).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (
      slots === null ||
      !Number.isFinite(slots) ||
      slots < 0 ||
      !(targetYears ?? years).includes(Number(date.slice(0, 4)))
    )
      continue;
    const input = lookup.get(date);
    const inTrain = splits.train.includes(Number(date.slice(0, 4)));
    const reference = inTrain ? 0.5 : weeklyBaseline(date);
    calendarRows.push({
      date,
      target: slots > 0 ? 1 : 0,
      values: calendarFeatures(date),
      baseline: reference,
    });
    if (input) {
      const prior =
        input.previousRain ??
        lookup.get(
          new Date(Date.parse(date + "T12:00Z") - 86400000)
            .toISOString()
            .slice(0, 10),
        )?.rain;
      weatherRows.push({
        date,
        target: slots > 0 ? 1 : 0,
        values: weatherFeatures(date, input, (d) => lookup.get(d)),
        baseline: inTrain
          ? 0.5
          : prior == null
            ? null
            : (analogues(date.slice(5, 7), input.wind, input.rain, prior)
                ?.probability ?? null),
      });
    }
  }
  // Train rows have no baseline to compare against yet; only later blocks need
  // matched references. Populate train baselines without reading their targets.
  for (const row of [...weatherRows, ...calendarRows])
    if (splits.train.includes(Number(row.date.slice(0, 4)))) row.baseline = 0.5;
  return { weatherRows, calendarRows, features };
}
