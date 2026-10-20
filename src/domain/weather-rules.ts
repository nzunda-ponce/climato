import { Hour, Rules } from "./types";

export function dailyRainTotal(hours: Hour[]): number | null {
  if (
    hours.length !== 24 ||
    new Set(hours.map((h) => h.time.slice(11, 16))).size !== 24 ||
    hours.some((h) => h.rain === null || !Number.isFinite(h.rain) || h.rain < 0)
  )
    return null;
  return hours.reduce((total, h) => total + h.rain!, 0);
}

// Prior-day rainfall remains a separate access criterion. Rain outside the
// trial on the current day must not invalidate an otherwise dry work window.
export function previousRainEligible(
  previous: Hour[],
  rules: Rules,
): boolean | null {
  const rain = dailyRainTotal(previous);
  return rain === null ? null : rain < rules.rain24Limit;
}

export function windowRainEligible(
  hours: Hour[],
  rules: Rules,
): boolean | null {
  if (
    !hours.length ||
    hours.some((h) => h.rain === null || !Number.isFinite(h.rain) || h.rain < 0)
  )
    return null;
  return hours.reduce((s, h) => s + h.rain!, 0) <= rules.rain + 1e-9;
}
