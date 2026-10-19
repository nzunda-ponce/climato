import { Hour, Rules } from "./types";

export function dailyRainTotal(hours: Hour[]): number | null {
  if (
    hours.length !== 24 ||
    new Set(hours.map((h) => h.time.slice(11, 16))).size !== 24 ||
    hours.some((h) => h.rain === null || !Number.isFinite(h.rain))
  )
    return null;
  return hours.reduce((total, h) => total + h.rain!, 0);
}

// A dry working day and limited rain on the previous calendar day.
// Missing rainfall must not be interpreted as dry weather or safe access.
export function dayRainEligible(
  hours: Hour[],
  previous: Hour[],
  rules: Rules,
): boolean | null {
  const rain = dailyRainTotal(hours),
    before = dailyRainTotal(previous);
  if (rain !== null && rain > rules.rain) return false;
  if (before !== null && before >= rules.rain24Limit) return false;
  if (rain === null || before === null) return null;
  return true;
}
