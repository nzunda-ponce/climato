import {
  sigmoid,
  treeScore,
  modelVector,
  boostedProbability,
  boostedScore,
  type BoostedBinaryModel,
  type ModelTree,
  type ModelMetrics,
} from "../domain/boosted-model";
export interface TrainingRow {
  date: string;
  values: (number | null)[];
  target: number;
  baseline: number | null;
}
const clip = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const loss = (p: number, target: number) =>
  -(
    target * Math.log(Math.max(1e-8, p)) +
    (1 - target) * Math.log(Math.max(1e-8, 1 - p))
  );
export function evaluateModel(
  model: BoostedBinaryModel,
  rows: TrainingRow[],
): ModelMetrics {
  let brier = 0,
    logLoss = 0,
    baseline = 0,
    baselineCount = 0;
  for (const row of rows) {
    const p = boostedProbability(model, row.values);
    brier += (p - row.target) ** 2;
    logLoss += loss(p, row.target);
    if (row.baseline !== null) {
      baseline += (row.baseline - row.target) ** 2;
      baselineCount++;
    }
  }
  const b = rows.length ? brier / rows.length : null;
  // Compare only equal cohorts. A missing baseline never becomes a zero.
  const base =
    rows.length && baselineCount === rows.length
      ? baseline / rows.length
      : null;
  return {
    count: rows.length,
    brier: b,
    logLoss: rows.length ? logLoss / rows.length : null,
    baselineBrier: base,
    skill: b !== null && base !== null && base > 0 ? 1 - b / base : null,
  };
}
export function fitBoosting(
  train: TrainingRow[],
  tune: TrainingRow[],
  featureNames: string[],
  options: { depth: number; trees?: number; minLeaf?: number },
) {
  if (!train.length || !tune.length)
    throw new Error("Faltan muestras de entrenamiento o selección temporal.");
  const medians = featureNames.map((_, i) => {
    const values = train
      .map((row) => row.values[i])
      .filter((v): v is number => v !== null && Number.isFinite(v))
      .sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)] : 0;
  });
  const vectors = train.map((row) => modelVector(row.values, medians));
  const tuneVectors = tune.map((row) => modelVector(row.values, medians));
  const dimensions = vectors[0].length;
  const thresholds = Array.from({ length: dimensions }, (_, feature) => {
    const sorted = [...new Set(vectors.map((row) => row[feature]))].sort(
      (a, b) => a - b,
    );
    return [
      ...new Set(
        Array.from(
          { length: Math.min(12, Math.max(0, sorted.length - 1)) },
          (_, i) => sorted[Math.floor(((i + 1) * sorted.length) / 13)],
        ),
      ),
    ].filter((value) => value < sorted.at(-1)!);
  });
  const average =
    (train.reduce((sum, row) => sum + row.target, 0) + 1) / (train.length + 2);
  const model: BoostedBinaryModel = {
    baseScore: Math.log(average / (1 - average)),
    learningRate: 0.07,
    trees: [],
    medians,
    featureNames,
    calibration: { slope: 1, intercept: 0 },
  };
  const scores = train.map(() => model.baseScore),
    tuneScores = tune.map(() => model.baseScore);
  const importance = Array.from({ length: dimensions }, () => 0);
  let bestImportance = [...importance];
  let bestLoss = Infinity,
    bestCount = 0,
    stalled = 0;
  const minLeaf = options.minLeaf ?? 25,
    lambda = 2;
  for (let iteration = 0; iteration < (options.trees ?? 70); iteration++) {
    const gradients = scores.map(
      (score, i) => train[i].target - sigmoid(score),
    );
    const hessians = scores.map((score) =>
      Math.max(0.001, sigmoid(score) * (1 - sigmoid(score))),
    );
    const build = (indices: number[], depth: number): ModelTree => {
      const gradient = indices.reduce((sum, i) => sum + gradients[i], 0),
        hessian = indices.reduce((sum, i) => sum + hessians[i], 0);
      const leaf = { value: clip(gradient / (hessian + lambda), -3, 3) };
      if (depth >= options.depth || indices.length < 2 * minLeaf) return leaf;
      let bestGain = 0.01,
        bestFeature = -1,
        bestThreshold = 0;
      for (let feature = 0; feature < dimensions; feature++)
        for (const threshold of thresholds[feature]) {
          let leftGradient = 0,
            leftHessian = 0,
            leftCount = 0;
          for (const i of indices)
            if (vectors[i][feature] <= threshold) {
              leftGradient += gradients[i];
              leftHessian += hessians[i];
              leftCount++;
            }
          if (leftCount < minLeaf || indices.length - leftCount < minLeaf)
            continue;
          const gain =
            leftGradient ** 2 / (leftHessian + lambda) +
            (gradient - leftGradient) ** 2 / (hessian - leftHessian + lambda) -
            gradient ** 2 / (hessian + lambda);
          if (gain > bestGain) {
            bestGain = gain;
            bestFeature = feature;
            bestThreshold = threshold;
          }
        }
      if (bestFeature < 0) return leaf;
      importance[bestFeature] += bestGain;
      const left = indices.filter(
          (i) => vectors[i][bestFeature] <= bestThreshold,
        ),
        right = indices.filter((i) => vectors[i][bestFeature] > bestThreshold);
      return {
        ...leaf,
        feature: bestFeature,
        threshold: bestThreshold,
        left: build(left, depth + 1),
        right: build(right, depth + 1),
      };
    };
    const tree = build(
      train.map((_, i) => i),
      0,
    );
    model.trees.push(tree);
    for (let i = 0; i < scores.length; i++)
      scores[i] += model.learningRate * treeScore(tree, vectors[i]);
    for (let i = 0; i < tuneScores.length; i++)
      tuneScores[i] += model.learningRate * treeScore(tree, tuneVectors[i]);
    const validationLoss =
      tuneScores.reduce(
        (sum, score, i) => sum + loss(sigmoid(score), tune[i].target),
        0,
      ) / tune.length;
    if (validationLoss < bestLoss - 1e-5) {
      bestLoss = validationLoss;
      bestCount = model.trees.length;
      bestImportance = [...importance];
      stalled = 0;
    } else stalled++;
    if (stalled >= 8) break;
  }
  model.trees = model.trees.slice(0, bestCount);
  const total = bestImportance.reduce((sum, gain) => sum + gain, 0) || 1;
  return {
    model,
    importance: featureNames
      .map((feature, i) => ({
        feature,
        gain:
          (bestImportance[i] + bestImportance[i + featureNames.length]) / total,
      }))
      .sort((a, b) => b.gain - a.gain),
  };
}
export function calibrateModel(model: BoostedBinaryModel, rows: TrainingRow[]) {
  // This block is separate from early stopping and from the final test years.
  const raw = rows.map((row) => boostedScore(model, row.values));
  let slope = 1,
    intercept = 0;
  for (let iteration = 0; iteration < 250; iteration++) {
    let a = 0,
      b = 0;
    for (let i = 0; i < rows.length; i++) {
      const error = sigmoid(slope * raw[i] + intercept) - rows[i].target;
      a += error * raw[i];
      b += error;
    }
    slope = clip(slope - 0.03 * (a / rows.length + 0.01 * (slope - 1)), 0.1, 4);
    intercept = clip(intercept - (0.03 * b) / rows.length, -3, 3);
  }
  return { ...model, calibration: { slope, intercept } };
}
