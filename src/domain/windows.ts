import {
  addDays,
  Rules,
  WeatherForecast,
  Window,
  RoadRisk,
  Pivot,
} from "./types";
import { previousRainEligible, windowRainEligible } from "./weather-rules";
export function calculateOperationalWindows(
  forecast: WeatherForecast,
  rules: Rules,
  now = new Date(),
): Window[] {
  const dates = [
    ...new Set(
      forecast.models.flatMap((m) => m.hours.map((h) => h.time.slice(0, 10))),
    ),
  ].sort();
  const result: Window[] = [];
  for (const date of dates) {
    const members = forecast.models.map((m) => {
      const eligible = previousRainEligible(
        m.hours.filter((h) => h.time.startsWith(addDays(date, -1))),
        rules,
      );
      const hours = new Map(
        m.hours
          .filter((h) => h.time.startsWith(date))
          .map((h) => [Number(h.time.slice(11, 13)), h]),
      );
      let available = 0,
        valid = 0,
        weatherAvailable = 0,
        weatherValid = 0;
      for (let hour = rules.startHour; hour < rules.endHour; hour++) {
        if (eligible === null) continue;
        const h = hours.get(hour);
        if (h && h.wind !== null && h.rain !== null) {
          weatherAvailable |= 1 << hour;
          if (eligible && h.wind <= rules.wind) weatherValid |= 1 << hour;
        }
        if (!h || h.wind === null || h.rain === null) continue;
        available |= 1 << hour;
        if (eligible && h.wind <= rules.wind) valid |= 1 << hour;
      }
      return {
        model: m,
        family: m.family ?? m.model,
        hours,
        available,
        valid,
        weatherAvailable,
        weatherValid,
      };
    });
    let best: Window | undefined;
    for (
      let start = rules.startHour;
      start <= rules.endHour - rules.minHours;
      start++
    ) {
      const timestamp = date + "T" + String(start).padStart(2, "0") + ":00";
      if (Date.parse(timestamp + "-03:00") < now.getTime()) continue;
      for (let end = start + rules.minHours; end <= rules.endHour; end++) {
        const mask = ((1 << (end - start)) - 1) << start;
        const available = members.filter((m) => (m.available & mask) === mask);
        if (!available.length) continue;
        const dry = (m: (typeof members)[number]) =>
          windowRainEligible(
            Array.from({ length: end - start }, (_, i) =>
              m.hours.get(start + i)!,
            ),
            rules,
          ) === true;
        const favorable = available.filter(
          (m) => (m.valid & mask) === mask && dry(m),
        );
        if (!favorable.length) continue;
        const families = [...new Set(available.map((m) => m.family))];
        const fractions = families.map(
          (f) =>
            favorable.filter((m) => m.family === f).length /
            available.filter((m) => m.family === f).length,
        );
        const probability =
          fractions.reduce((s, v) => s + v, 0) / families.length;
        const weatherMembers = members.filter(
          (m) => (m.weatherAvailable & mask) === mask,
        );
        const weatherFamilies = [
          ...new Set(weatherMembers.map((m) => m.family)),
        ];
        const windRainAgreement = weatherFamilies.length
          ? weatherFamilies.reduce((s, f) => {
              const group = weatherMembers.filter((m) => m.family === f);
              return (
                s +
                group.filter((m) => (m.weatherValid & mask) === mask && dry(m))
                  .length /
                  group.length
              );
            }, 0) / weatherFamilies.length
          : probability;
        const spread = Math.sqrt(
          fractions.reduce((s, v) => s + (v - probability) ** 2, 0) /
            fractions.length,
        );
        const days = Math.max(
          0,
          (Date.parse(timestamp + "-03:00") - now.getTime()) / 86400000,
        );
        const isEnsemble = available.some((m) => m.model.kind === "ensemble");
        const coverage = available.length / Math.max(1, members.length);
        const confidence = Math.round(
          100 *
            Math.exp(-days / 13) *
            Math.min(1, families.length / (isEnsemble ? 2 : 4)) *
            Math.sqrt(coverage) *
            (1 - spread) *
            (isEnsemble ? 0.85 : 1) *
            (1 - Math.abs(windRainAgreement - probability)),
        );
        const favorableHours = favorable.flatMap((m) =>
          Array.from({ length: end - start }, (_, i) =>
            m.hours.get(start + i)!,
          ),
        );
        const w: Window = {
          start: timestamp,
          end:
            end === 24
              ? new Date(Date.parse(date + "T00:00Z") + 86400000)
                  .toISOString()
                  .slice(0, 10) + "T00:00"
              : date + "T" + String(end).padStart(2, "0") + ":00",
          hours: end - start,
          probability: Math.round(probability * 100),
          confidence,
          wind: Math.max(...favorableHours.map((h) => h.wind!)),
          gust: Math.max(...favorableHours.map((h) => h.gust!)),
          rain: Math.max(
            ...favorable.map((m) =>
              Array.from(
                { length: end - start },
                (_, i) => m.hours.get(start + i)!.rain!,
              ).reduce((s, v) => s + v, 0),
            ),
          ),
          members: available.length,
          families: families.length,
          basis: isEnsemble ? "ensemble" : "model-agreement",
          familyEvidence: [...new Set(members.map((m) => m.family))].map(
            (family) => ({
              family,
              total: members.filter((m) => m.family === family).length,
              usable: available.filter((m) => m.family === family).length,
              favorable: favorable.filter((m) => m.family === family).length,
            }),
          ),
          coverage: Math.round(coverage * 100),
          spread: Math.round(spread * 100),
          windRainAgreement: Math.round(windRainAgreement * 100),
        };
        if (
          !best ||
          w.probability * 100 + w.hours > best.probability * 100 + best.hours
        )
          best = w;
      }
    }
    if (best) result.push(best);
  }
  return result;
}
export function roadAccessRiskScore(
  f: WeatherForecast | undefined,
  pivot: Pivot,
  date: string,
  r: Rules,
): RoadRisk {
  const cutoff = date + "T07:00";
  const since = (n: number) =>
    new Date(new Date(cutoff + "Z").getTime() - n * 3600000)
      .toISOString()
      .slice(0, 16);
  const since72 = since(72);
  const source = f?.models.find(
    (m) =>
      m.hours.filter(
        (h) => h.time < cutoff && h.time >= since72 && h.rain !== null,
      ).length === 72,
  );
  const past = source?.hours.filter((h) => {
    return h.time < cutoff && h.time >= since72;
  });
  const sum = (n: number) => {
    const lower = since(n);
    return (
      past
        ?.filter((h) => h.time >= lower)
        .reduce((s, h) => s + (h.rain ?? 0), 0) ?? null
    );
  };
  const complete =
    !!past && past.length === 72 && past.every((h) => h.rain !== null);
  const lastHour = since(1);
  const soil =
    f?.models
      .map((m) => m.hours.find((h) => h.time === lastHour)?.soil)
      .find((value) => value !== null && value !== undefined) ?? null;
  const rain24 = complete ? sum(24) : null,
    rain48 = complete ? sum(48) : null,
    rain72 = complete ? sum(72) : null;
  const upcoming =
    source?.hours
      .filter((h) => h.time.startsWith(date))
      .reduce((s, h) => s + (h.rain ?? 0), 0) ?? 0;
  const score = complete
    ? Math.round(
        Math.min(
          100,
          100 *
            Math.max(
              (rain24 ?? 0) / r.rain24Limit,
              (rain72 ?? 0) / r.rain72Limit,
              soil === null ? 0 : soil / r.soilLimit,
            ) *
            0.65 +
            Math.min(20, upcoming),
        ),
      )
    : null;
  return {
    score,
    condition:
      pivot.road !== "DESCONOCIDO"
        ? pivot.road
        : score === null
          ? "DESCONOCIDO"
          : score >= 75
            ? "NO APTO"
            : score >= 40
              ? "RIESGO"
              : "APTO",
    rain24,
    rain48,
    rain72,
    soil,
    manual: pivot.road !== "DESCONOCIDO",
  };
}
