import {
  cellKey,
  rulesSignature,
  type HistoricalClimate,
} from "../domain/evidence";
import {
  localDate,
  locationWarning,
  type Pivot,
  type Rules,
} from "../domain/types";

export function trainingHistoryCoverage(
  state: {
    pivots: Pivot[];
    rules: Rules;
    climate?: Record<string, HistoricalClimate>;
  },
  count = 45,
  lastYear = Number(localDate().slice(0, 4)) - 1,
) {
  const years = Array.from(
    { length: count },
    (_, i) => lastYear - count + 1 + i,
  );
  const keys = [
    ...new Set(
      state.pivots
        .filter((p) => p.status !== "TERMINADO" && !locationWarning(p))
        .map((p) => cellKey(p.lat, p.lon)),
    ),
  ];
  const signature = rulesSignature(state.rules);
  const locations = keys.map((key) => {
    const history = state.climate?.[key];
    const available =
      history?.rulesSignature === signature ? history.years : [];
    return { key, missing: years.filter((year) => !available.includes(year)) };
  });
  return {
    years,
    locations: locations.length,
    complete: locations.filter((location) => !location.missing.length).length,
    missingSeasons: locations.reduce(
      (sum, location) => sum + location.missing.length,
      0,
    ),
  };
}
