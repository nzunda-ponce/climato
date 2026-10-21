import { weatherJson } from "./weather-request";
import { WeatherForecast, ModelForecast } from "@/domain/types";
export interface WeatherProvider {
  forecast(lat: number, lon: number): Promise<WeatherForecast>;
}
export class OpenMeteoProvider implements WeatherProvider {
  async forecast(lat: number, lon: number): Promise<WeatherForecast> {
    return (await this.forecastMany([{ lat, lon }]))[0];
  }
  async forecastMany(
    points: { lat: number; lon: number }[],
  ): Promise<WeatherForecast[]> {
    const models = [
      "ecmwf_ifs025",
      "gfs_seamless",
      "icon_seamless",
      "gem_seamless",
    ];
    const errors: string[] = [];
    const results = await Promise.allSettled(
      models.map(async (model) => {
        const url = new URL(
          process.env.WEATHER_API_KEY
            ? "https://customer-api.open-meteo.com/v1/forecast"
            : "https://api.open-meteo.com/v1/forecast",
        );
        const params: Record<string, string> = {
          latitude: points.map((p) => p.lat).join(","),
          longitude: points.map((p) => p.lon).join(","),
          models: model,
          hourly:
            "wind_speed_10m,wind_gusts_10m,precipitation,soil_moisture_0_to_10cm",
          past_days: "3",
          forecast_days: "16",
          timezone: "America/Argentina/Buenos_Aires",
          wind_speed_unit: "kmh",
        };
        if (process.env.WEATHER_API_KEY)
          params.apikey = process.env.WEATHER_API_KEY;
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        type Location = {
          hourly: { time: string[]; [key: string]: unknown[] };
        };
        const payload = await weatherJson<Location | Location[]>(url);
        const data = Array.isArray(payload) ? payload : [payload];
        if (data.length !== points.length || data.some((d) => !d.hourly?.time))
          throw new Error(`${model}: respuesta sin datos horarios completos`);
        return data.map((d) => {
          const h = d.hourly;
          const numeric = (v: unknown) =>
            typeof v === "number" && Number.isFinite(v) ? v : null;
          return {
            model,
            hours: h.time.map((time: string, i: number) => ({
              time,
              wind: numeric(h.wind_speed_10m?.[i]),
              gust: numeric(h.wind_gusts_10m?.[i + 1]),
              rain: numeric(h.precipitation?.[i + 1]),
              soil: numeric(h.soil_moisture_0_to_10cm?.[i]),
            })),
          } satisfies ModelForecast;
        });
      }),
    );
    results.forEach((res, i) => {
      if (res.status === "rejected")
        errors.push(
          `${models[i]}: ${res.reason instanceof Error ? res.reason.message : "no disponible"}`,
        );
    });
    return points.map((_, index) => ({
      intervalAligned: true,
      fetchedAt: new Date().toISOString(),
      models: results.flatMap((res) =>
        res.status === "fulfilled" ? [res.value[index]] : [],
      ),
      errors,
      source:
        "Open-Meteo · acuerdo entre modelos determinísticos (no ensemble)",
    }));
  }
}
export interface SeasonalProvider {
  availability(
    region: string,
    month: number,
  ): Promise<{ fraction: number; source: string; sampleYears: number }>;
}
