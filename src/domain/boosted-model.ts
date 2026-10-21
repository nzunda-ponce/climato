export type ModelTree = {
  value: number;
  feature?: number;
  threshold?: number;
  left?: ModelTree;
  right?: ModelTree;
};
export interface BoostedBinaryModel {
  baseScore: number;
  learningRate: number;
  trees: ModelTree[];
  medians: number[];
  featureNames: string[];
  calibration: { slope: number; intercept: number };
}
export interface ModelMetrics {
  count: number;
  brier: number | null;
  logLoss: number | null;
  baselineBrier: number | null;
  skill: number | null;
}
export interface TrainedEstimator {
  model: BoostedBinaryModel;
  accepted: boolean;
  tune: ModelMetrics;
  calibration: ModelMetrics;
  test: ModelMetrics;
  importance: { feature: string; gain: number }[];
}
export interface ClimateMachineLearning {
  version: "climato-gbdt-v1";
  rulesSignature: string;
  sourceFetchedAt: string;
  fingerprint: string;
  trainedAt: string;
  splits: {
    train: number[];
    tune: number[];
    calibration: number[];
    test: number[];
  };
  samples: number;
  positiveSlotsMean: number;
  weather: TrainedEstimator;
  calendar: TrainedEstimator;
  label: string;
}
export const sigmoid = (value: number) =>
  value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
export function modelVector(values: (number | null)[], medians: number[]) {
  return [
    ...values.map((v, i) =>
      v !== null && Number.isFinite(v) ? v : medians[i],
    ),
    ...values.map((v) => (v === null || !Number.isFinite(v) ? 1 : 0)),
  ];
}
export function treeScore(tree: ModelTree, values: number[]): number {
  let node = tree;
  while (node.feature !== undefined && node.left && node.right)
    node = values[node.feature] <= node.threshold! ? node.left : node.right;
  return node.value;
}
export function boostedScore(
  model: BoostedBinaryModel,
  values: (number | null)[],
) {
  const vector = modelVector(values, model.medians);
  return (
    model.baseScore +
    model.learningRate *
      model.trees.reduce((sum, tree) => sum + treeScore(tree, vector), 0)
  );
}
export function boostedProbability(
  model: BoostedBinaryModel,
  values: (number | null)[],
) {
  return sigmoid(
    model.calibration.slope * boostedScore(model, values) +
      model.calibration.intercept,
  );
}
