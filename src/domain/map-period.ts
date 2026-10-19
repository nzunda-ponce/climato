import { addDays } from "./types";

export function nextMonday(today: string) {
  const weekday = new Date(today + "T12:00Z").getUTCDay();
  return addDays(today, weekday === 0 ? 1 : 8 - weekday);
}

// Current-week selections keep today's heatmap; later weeks use their own forecast.
export function weatherMapPeriod(
  today: string,
  selected: string,
  campaign = false,
) {
  if (campaign || selected < nextMonday(today))
    return { start: today, end: today };
  const weekday = new Date(selected + "T12:00Z").getUTCDay();
  const start = addDays(selected, -(weekday === 0 ? 6 : weekday - 1));
  return { start, end: addDays(start, 6) };
}
