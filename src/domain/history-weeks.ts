import { addDays } from "./types";

export function calendarWeekStart(date: string) {
  const weekday = new Date(date + "T12:00Z").getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

// Historical labels are available for October–December. Use Monday–Sunday
// weeks, clipped at the boundaries of that observed season rather than filling
// September or January with synthetic data.
export function historicalWeek(date: string) {
  const year = date.slice(0, 4);
  const seasonStart = `${year}-10-01`,
    seasonEnd = `${year}-12-31`;
  if (date < seasonStart || date > seasonEnd)
    return { start: date, end: date, dates: [] as string[] };
  const monday = calendarWeekStart(date);
  const start = monday < seasonStart ? seasonStart : monday;
  const sunday = addDays(monday, 6);
  const end = sunday > seasonEnd ? seasonEnd : sunday;
  const dates: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) dates.push(day);
  return { start, end, dates };
}

export function historicalWeeks(dates: string[]) {
  const groups = new Map<string, string[]>();
  for (const date of dates) {
    const week = historicalWeek(date);
    if (!week.dates.length) continue;
    const days = groups.get(week.start) ?? [];
    days.push(date);
    groups.set(week.start, days);
  }
  return [...groups].map(([key, days]) => ({
    key,
    start: days[0],
    end: days.at(-1)!,
    dates: days,
  }));
}

export function historicalWeekSample(values: (number | null | undefined)[]) {
  const covered = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
  if (!values.length || covered.length / values.length < 0.8) return null;
  return {
    probability: covered.filter((v) => v > 0).length / covered.length,
    slots: covered.reduce((sum, v) => sum + v, 0) / covered.length,
    covered: covered.length,
    total: values.length,
  };
}
