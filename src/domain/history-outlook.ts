import { HistoricalClimate, rulesSignature } from "./evidence";
import { Rules } from "./types";
export const MIN_HISTORY_YEARS = 10;
const valid = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
export function historyDay(
  history: HistoricalClimate | undefined,
  rules: Rules,
  date: string,
) {
  if (!history || history.rulesSignature !== rulesSignature(rules)) return null;
  const values = [...new Set(history.years)]
    .map((year) => history.days[`${year}${date.slice(4)}`])
    .filter(valid);
  if (values.length < MIN_HISTORY_YEARS) return null;
  return {
    probability: values.filter((v) => v > 0).length / values.length,
    slots: values.reduce((s, v) => s + v, 0) / values.length,
    years: values.length,
  };
}
// Entire historical years are the sampling unit: preserve runs of wet/dry
// days and never fabricate independent daily samples or joint model members.
export function historyPeriod(
  history: HistoricalClimate | undefined,
  rules: Rules,
  dates: string[],
) {
  if (
    !history ||
    history.rulesSignature !== rulesSignature(rules) ||
    !dates.length
  )
    return null;
  const counts = [...new Set(history.years)]
    .flatMap((year) => {
      const values = dates.map(
        (date) => history.days[`${year}${date.slice(4)}`],
      );
      return values.every(valid) ? [values.filter((v) => v! > 0).length] : [];
    })
    .sort((a, b) => a - b);
  if (
    counts.length < MIN_HISTORY_YEARS ||
    counts.length / history.years.length < 0.8
  )
    return null;
  const q = (p: number) =>
    counts[Math.max(0, Math.ceil(p * counts.length) - 1)];
  return {
    expected: counts.reduce((s, n) => s + n, 0) / counts.length,
    range: [q(0.1), q(0.9)] as [number, number],
    years: counts.length,
  };
}
