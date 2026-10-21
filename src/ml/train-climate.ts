import { createHash } from "node:crypto";
import type { HistoricalClimate } from "../domain/evidence";
import { historicalModel } from "../domain/history-model";
import { historicalWeek, historicalWeekSample } from "../domain/history-weeks";
import { analogueModel } from "../domain/seasonal";
import {
  calendarFeatures,
  weatherFeatures,
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
  const features = (history.features ?? []).filter(
    (row) =>
      years.includes(Number(row.date.slice(0, 4))) &&
      Number.isFinite(row.wind) &&
      row.wind >= 0 &&
      Number.isFinite(row.rain) &&
      row.rain >= 0,
  );
  if (features.length < 1000)
    throw new Error(
      "Faltan variables meteorológicas históricas: se necesitan al menos 1000 muestras con viento y lluvia, además de las etiquetas de aptitud.",
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
      !years.includes(Number(date.slice(0, 4)))
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
