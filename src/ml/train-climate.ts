import { createHash } from "node:crypto";
import type { HistoricalClimate } from "../domain/evidence";
import { prepareTrainingRows } from "./training-rows";
import {
  calendarFeatureNames,
  weatherFeatureNames,
} from "../domain/ml-features";
import type {
  ClimateMachineLearning,
  TrainedEstimator,
} from "../domain/boosted-model";
import {
  fitBoosting,
  calibrateModel,
  evaluateModel,
  type TrainingRow,
} from "./gradient-boosting";

export function trainingFingerprint(history: HistoricalClimate) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "climato-gbdt-v1",
        history.rulesSignature,
        history.years,
        history.days,
        history.features ?? [],
      ]),
    )
    .digest("hex");
}
export function temporalSplits(years: number[]) {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  if (sorted.length < 21)
    throw new Error(
      "Se requieren al menos 21 años: 10 para entrenamiento, 3 de selección, 3 de calibración y 5 de prueba final.",
    );
  return {
    train: sorted.slice(0, -11),
    tune: sorted.slice(-11, -8),
    calibration: sorted.slice(-8, -5),
    test: sorted.slice(-5),
  };
}
function trainEstimator(
  rows: TrainingRow[],
  names: string[],
  splits: ClimateMachineLearning["splits"],
  onProgress: (message: string) => void,
): TrainedEstimator {
  const select = (years: number[]) =>
    rows.filter(
      (row) =>
        years.includes(Number(row.date.slice(0, 4))) && row.baseline !== null,
    );
  const train = select(splits.train),
    tune = select(splits.tune),
    calibration = select(splits.calibration),
    test = select(splits.test);
  if (
    train.filter((row) => row.target === 1).length < 30 ||
    train.filter((row) => row.target === 0).length < 30 ||
    train.length < 500 ||
    tune.length < 120 ||
    calibration.length < 120 ||
    test.length < 200
  )
    throw new Error(
      "Muestra insuficiente en uno de los bloques temporales; se conserva la referencia actual.",
    );
  const candidates = [2, 3].map((depth) => {
    onProgress(`Entrenando árboles de profundidad ${depth}`);
    const fitted = fitBoosting(train, tune, names, { depth });
    return { ...fitted, metrics: evaluateModel(fitted.model, tune) };
  });
  const best = candidates.sort(
    (a, b) => a.metrics.brier! - b.metrics.brier!,
  )[0];
  const model = calibrateModel(best.model, calibration);
  const calibrationMetrics = evaluateModel(model, calibration),
    testMetrics = evaluateModel(model, test);
  // Test labels are evaluated once after model selection and calibration.
  // They gate deployment, but never change trees, thresholds, or calibration.
  const accepted =
    best.metrics.baselineBrier !== null &&
    best.metrics.brier! < best.metrics.baselineBrier &&
    calibrationMetrics.baselineBrier !== null &&
    calibrationMetrics.brier! < calibrationMetrics.baselineBrier &&
    testMetrics.baselineBrier !== null &&
    testMetrics.brier! < testMetrics.baselineBrier - 0.002;
  return {
    model,
    accepted,
    tune: best.metrics,
    calibration: calibrationMetrics,
    test: testMetrics,
    importance: best.importance,
  };
}
export function trainClimateModels(
  history: HistoricalClimate,
  beforeYear: number,
  onProgress: (message: string) => void = () => {},
): ClimateMachineLearning {
  const years = history.years.filter(
    (year) =>
      year < beforeYear &&
      Object.entries(history.days).filter(
        ([date, value]) =>
          date.startsWith(`${year}-`) &&
          value !== null &&
          Number.isFinite(value) &&
          value >= 0,
      ).length >= 60 &&
      (history.features ?? []).filter((row) => row.date.startsWith(`${year}-`))
        .length >= 60,
  );
  const splits = temporalSplits(years);
  const { weatherRows, calendarRows, features } = prepareTrainingRows(
    history,
    splits,
  );
  if (features.length < 1000)
    throw new Error(
      "Faltan variables meteorológicas históricas: se necesitan al menos 1000 muestras con viento y lluvia, además de las etiquetas de aptitud.",
    );
  onProgress("Modelo meteorológico condicionado a escenarios");
  const weather = trainEstimator(
    weatherRows,
    weatherFeatureNames,
    splits,
    onProgress,
  );
  onProgress("Modelo de referencia climática semanal");
  const calendar = trainEstimator(
    calendarRows,
    calendarFeatureNames,
    splits,
    onProgress,
  );
  const positive = features.filter(
    (row) =>
      splits.train.includes(Number(row.date.slice(0, 4))) && row.slots > 0,
  );
  return {
    version: "climato-gbdt-v1",
    rulesSignature: history.rulesSignature,
    sourceFetchedAt: history.fetchedAt,
    fingerprint: trainingFingerprint(history),
    trainedAt: new Date().toISOString(),
    splits,
    samples: calendarRows.length,
    positiveSlotsMean: positive.length
      ? positive.reduce((sum, row) => sum + row.slots, 0) / positive.length
      : 1,
    weather,
    calendar,
    label:
      "Validación temporal interna con ERA5. El modelo meteorológico valida la traducción de variables a aptitud; no mide habilidad del pronóstico EC46/SEAS5 ni resultados de campo.",
  };
}
