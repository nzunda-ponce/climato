import { Rules, WeatherForecast, Window } from "./types";
import { calculateOperationalWindows } from "./windows";

export interface WindowDetail {
  status: "available" | "tentative" | "unconfirmed" | "stale";
  message: string;
  fetchedAt?: string;
  window:
    | (Pick<Window, "start" | "end" | "hours" | "probability"> & {
        blocks: { start: string; end: string }[];
      })
    | null;
}
export function hourlyWindowDetail(
  forecast: WeatherForecast | undefined,
  rules: Rules,
  date: string,
  now = new Date(),
): WindowDetail {
  if (
    !forecast ||
    !forecast.models.some((model) =>
      model.hours.some((hour) => hour.time.startsWith(date)),
    )
  )
    return {
      status: "tentative",
      window: null,
      message:
        "Fecha tentativa: el pronóstico aún no permite precisar un horario.",
    };
  const age = now.getTime() - Date.parse(forecast.fetchedAt);
  if (!Number.isFinite(age) || age < 0 || age >= 36 * 3600000)
    return {
      status: "stale",
      window: null,
      fetchedAt: forecast.fetchedAt,
      message:
        "Hace falta actualizar el pronóstico horario para confirmar una franja.",
    };
  const models = forecast.models.map((model) => ({
    ...model,
    hours: model.hours.filter(
      (hour) =>
        hour.time.startsWith(date) ||
        hour.time.startsWith(
          new Date(Date.parse(date + "T00:00Z") - 86400000)
            .toISOString()
            .slice(0, 10),
        ),
    ),
  }));
  const window = calculateOperationalWindows(
    { ...forecast, models },
    rules,
    now,
  ).find((window) => window.start.startsWith(date));
  if (!window)
    return {
      status: "unconfirmed",
      window: null,
      fetchedAt: forecast.fetchedAt,
      message:
        "El pronóstico horario no confirma una franja. Esta posibilidad sigue siendo tentativa.",
    };
  return {
    status: "available",
    fetchedAt: forecast.fetchedAt,
    message:
      "Horario propuesto por el pronóstico horario; revisalo antes de salir.",
    window: {
      start: window.start,
      end: window.end,
      hours: window.hours,
      probability: window.probability,
      blocks: Array.from(
        { length: Math.floor(window.hours / rules.minHours) },
        (_, index) => {
          const start =
            Date.parse(window.start + "Z") + index * rules.minHours * 3600000;
          return {
            start: new Date(start).toISOString().slice(0, 16),
            end: new Date(start + rules.minHours * 3600000)
              .toISOString()
              .slice(0, 16),
          };
        },
      ),
    },
  };
}
