import type { HistoricalClimate } from "./evidence";
import { boostedProbability, type TrainedEstimator } from "./boosted-model";
import {
  calendarFeatures,
  weatherFeatures,
  type WeatherDayInput,
} from "./ml-features";
import { historicalWeek } from "./history-weeks";

export function compatibleMachineLearning(
  history: HistoricalClimate | undefined,
) {
  const artifact = history?.machineLearning;
  return artifact?.version === "climato-gbdt-v1" &&
    artifact.rulesSignature === history!.rulesSignature &&
    artifact.sourceFetchedAt === history!.fetchedAt
    ? artifact
    : null;
}
export function mlCalendarProbability(
  history: HistoricalClimate,
  date: string,
) {
  const artifact = compatibleMachineLearning(history);
  if (
    !artifact?.calendar.accepted ||
    Number(date.slice(0, 4)) <= Math.max(...artifact.splits.calibration)
  )
    return null;
  const week = historicalWeek(date);
  if (!week.dates.length) return null;
  const p =
    week.dates.reduce(
      (sum, day) =>
        sum +
        boostedProbability(artifact.calendar.model, calendarFeatures(day)),
      0,
    ) / week.dates.length;
  return {
    probability: p,
    slots: p * artifact.positiveSlotsMean,
    years: artifact.splits.train.length,
    start: week.start,
    end: week.end,
  };
}
export function mlWeatherProbability(
  history: HistoricalClimate | undefined,
  date: string,
  input: WeatherDayInput,
  previous: (date: string) => WeatherDayInput | undefined,
) {
  const artifact = compatibleMachineLearning(history);
  if (
    !artifact?.weather.accepted ||
    Number(date.slice(0, 4)) <= Math.max(...artifact.splits.calibration) ||
    input.wind === null ||
    input.rain === null ||
    !Number.isFinite(input.wind) ||
    !Number.isFinite(input.rain)
  )
    return null;
  const p = boostedProbability(
    artifact.weather.model,
    weatherFeatures(date, input, previous),
  );
  return { probability: p, slots: p * artifact.positiveSlotsMean };
}
const estimatorSummary = (estimator: TrainedEstimator) => ({
  accepted: estimator.accepted,
  trees: estimator.model.trees.length,
  features: estimator.model.featureNames,
  tune: estimator.tune,
  calibration: estimator.calibration,
  test: estimator.test,
  importance: estimator.importance,
});
export function machineLearningSummary(
  history: HistoricalClimate | undefined,
  forecastFingerprint?: string,
) {
  if (!history) return null;
  const artifact = compatibleMachineLearning(history);
  if (!artifact)
    return {
      status: "not-trained" as const,
      availableYears: history.years.length,
    };
  return {
    status: "trained" as const,
    version: artifact.version,
    weatherApplied: forecastFingerprint === artifact.fingerprint,
    trainedAt: artifact.trainedAt,
    splits: artifact.splits,
    samples: artifact.samples,
    weather: estimatorSummary(artifact.weather),
    calendar: estimatorSummary(artifact.calendar),
    label: artifact.label,
    availableYears: history.years.length,
  };
}
