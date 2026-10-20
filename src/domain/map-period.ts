import { addDays } from "./types";

export function nextMonday(today: string) {
  const weekday = new Date(today + "T12:00Z").getUTCDay();
  return addDays(today, weekday === 0 ? 1 : 8 - weekday);
}

// Use exactly the range selected in the timeline, including individual days.
export function weatherMapPeriod(start: string, end = start) {
  return { start, end };
}
