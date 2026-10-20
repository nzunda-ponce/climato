import { ClimateDay, ClimateZone } from "./climatic";
import { PivotPlan } from "./types";
import { cellKey } from "./evidence";

export function expectedDayWindows(day: ClimateDay) {
  if (day.probability === null || day.probability <= 0 || (day.slots ?? 0) <= 0)
    return 0;
  return day.slots!;
}

export function zoneWorkWindows(
  zone: ClimateZone,
  start: string,
  end: string,
  minimumProbability = 0,
) {
  const days = zone.days.filter((day) => day.date >= start && day.date <= end);
  const available = days.filter(
    (day) =>
      day.probability !== null &&
      day.probability > 0 &&
      day.probability * 100 >= minimumProbability &&
      (day.slots ?? 0) > 0,
  );
  // Keep the unconditional ensemble expectation. Dividing by probability
  // would erase uncertainty and overstate the number of expected work windows.
  const expectedWindows = available.reduce(
    (total, day) => total + expectedDayWindows(day),
    0,
  );
  return {
    expectedWindows,
    bestProbability: days.some((day) => day.probability !== null)
      ? Math.max(...days.map((day) => day.probability ?? 0)) * 100
      : null,
    covered:
      days.length > 0 &&
      days.every((day) => day.probability !== null && day.slots !== null),
    dates: available.map((day) => day.date),
  };
}

export function workWindowSummary(
  zones: ClimateZone[],
  start: string,
  end: string,
  minimumProbability = 0,
) {
  const totalEquipment = zones.reduce((total, zone) => total + zone.pending, 0);
  let expectedWindows = 0,
    equipmentWithWindow = 0,
    coveredEquipment = 0,
    probabilitySum = 0,
    probabilityWeight = 0;
  for (const zone of zones) {
    const result = zoneWorkWindows(zone, start, end, minimumProbability);
    expectedWindows += result.expectedWindows * zone.pending;
    if (result.expectedWindows > 0) equipmentWithWindow += zone.pending;
    if (result.covered) coveredEquipment += zone.pending;
    for (const day of zone.days) {
      if (day.date < start || day.date > end || day.probability === null)
        continue;
      probabilitySum += day.probability * zone.pending;
      probabilityWeight += zone.pending;
    }
  }
  return {
    expectedWindows,
    expectedWindowsPerEquipment:
      totalEquipment > 0 && coveredEquipment === totalEquipment
        ? expectedWindows / totalEquipment
        : null,
    equipmentWithWindow,
    totalEquipment,
    coveredEquipment,
    meanDailyProbability: probabilityWeight
      ? (probabilitySum / probabilityWeight) * 100
      : null,
    percent: totalEquipment
      ? (equipmentWithWindow / totalEquipment) * 100
      : null,
  };
}

export interface PossibleWindow {
  id: string;
  pivotId: string;
  equipment: string;
  field: string;
  date: string;
  expectedWindows: number;
  probability: number;
  source?: ClimateDay["source"];
}

export function listPossibleWindows(
  plans: PivotPlan[],
  zones: ClimateZone[],
  start: string,
  end: string,
): PossibleWindow[] {
  const byZone = new Map(zones.map((zone) => [zone.key, zone]));
  return plans
    .flatMap((plan) => {
      if (plan.locationWarning || plan.pivot.status === "TERMINADO") return [];
      const zone = byZone.get(cellKey(plan.pivot.lat, plan.pivot.lon));
      return (zone?.days ?? []).flatMap((day) => {
        if (day.date < start || day.date > end) return [];
        const expectedWindows = expectedDayWindows(day);
        return expectedWindows
          ? [
              {
                id: `${plan.pivot.id}/${day.date}`,
                pivotId: plan.pivot.id,
                equipment: plan.pivot.name,
                field: plan.pivot.field,
                date: day.date,
                expectedWindows,
                probability: day.probability! * 100,
                source: day.source,
              },
            ]
          : [];
      });
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        b.probability - a.probability ||
        a.equipment.localeCompare(b.equipment),
    );
}

// One calendar date per weather zone; adding neighboring equipment cannot
// create extra days. The complete period is needed to show a period total.
export function workDaySummary(
  zones: ClimateZone[],
  start: string,
  end: string,
) {
  const totalDays = Math.max(
    0,
    Math.round(
      (Date.parse(end + "T00:00Z") - Date.parse(start + "T00:00Z")) / 86400000,
    ) + 1,
  );
  const complete = zones.flatMap((zone) => {
    const days = zone.days.filter((d) => d.date >= start && d.date <= end);
    if (
      !totalDays ||
      new Set(days.map((d) => d.date)).size !== totalDays ||
      days.some((d) => d.probability === null)
    )
      return [];
    return [{ expected: days.reduce((s, d) => s + d.probability!, 0) }];
  });
  return {
    expectedDays:
      zones.length && complete.length === zones.length
        ? complete.reduce((s, z) => s + z.expected, 0) / zones.length
        : null,
    coveredZones: complete.length,
    totalZones: zones.length,
    totalDays,
  };
}

export function workDayLabel(probability: number | null, tentative = false) {
  if (probability === null) return "Faltan datos";
  if (tentative) return "Volver a revisar más cerca";
  return probability >= 0.7
    ? "Buen día para evaluar"
    : probability >= 0.4
      ? "Puede servir; falta confirmar"
      : "Pocas chances por ahora";
}

export function estimatedDaysText(value: number | null) {
  if (value === null) return "—";
  if (value > 0 && value < 1) return "<1";
  return String(Math.round(value));
}
