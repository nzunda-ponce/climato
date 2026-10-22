import type { HistoricalClimate } from "../domain/evidence";
import { compatibleMachineLearning } from "../domain/machine-learning";
import { boostedProbability } from "../domain/boosted-model";
import { probabilityDiagnostics } from "../domain/ml-diagnostics";
import { prepareTrainingRows } from "./training-rows";
import { trainingFingerprint } from "./train-climate";

export function modelDiagnostics(
  history: HistoricalClimate,
  threshold: number,
) {
  const artifact = compatibleMachineLearning(history);
  if (!artifact || trainingFingerprint(history) !== artifact.fingerprint)
    return null;
  const rows = prepareTrainingRows(
    history,
    artifact.splits,
    artifact.splits.test,
  );
  const results = (["weather", "calendar"] as const).map((name) => {
    const cohort = rows[
      name === "weather" ? "weatherRows" : "calendarRows"
    ].filter(
      (row) =>
        artifact.splits.test.includes(Number(row.date.slice(0, 4))) &&
        row.baseline !== null,
    );
    const model = probabilityDiagnostics(
      cohort.map((row) => ({
        probability: boostedProbability(artifact[name].model, row.values),
        target: row.target,
      })),
      threshold,
    );
    const baseline = probabilityDiagnostics(
      cohort.map((row) => ({ probability: row.baseline!, target: row.target })),
      threshold,
    );
    const same = (a: number | null, b: number | null) =>
      a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-10);
    return [
      name,
      {
        model,
        baseline,
        matchesSavedCount: cohort.length === artifact[name].test.count,
        matchesSavedMetrics:
          same(model.brier, artifact[name].test.brier) &&
          same(baseline.brier, artifact[name].test.baselineBrier),
      },
    ] as const;
  });
  return {
    key: history.key,
    trainedAt: artifact.trainedAt,
    threshold,
    years: artifact.splits.test,
    ...Object.fromEntries(results),
  } as {
    key: string;
    trainedAt: string;
    threshold: number;
    years: number[];
    weather: (typeof results)[number][1];
    calendar: (typeof results)[number][1];
  };
}
export type ModelDiagnostics = NonNullable<ReturnType<typeof modelDiagnostics>>;
