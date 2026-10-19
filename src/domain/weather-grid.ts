import { ForecastGrid } from "./seasonal";
// Daily precipitation: neutral dry areas, then blue, green, yellow and red.
// Legend positions are equally spaced; the rainfall intervals are nonlinear.
export const RAIN_COLORS = [
  [0, 112, 115, 119],
  [0.5, 74, 126, 159],
  [2, 39, 145, 192],
  [5, 53, 174, 131],
  [10, 219, 207, 74],
  [20, 231, 120, 47],
  [50, 194, 54, 88],
] as const;
export const RAIN_GRADIENT = `linear-gradient(90deg,${RAIN_COLORS.map(([, r, g, b]) => `rgb(${r},${g},${b})`).join(",")})`;
export type WeatherField = "wind" | "rain" | "u" | "v";
export function weatherPeriodDays(start: string, end: string) {
  return Math.max(
    1,
    Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1,
  );
}
export function createGridSampler(
  grid: ForecastGrid,
  start: string,
  end: string,
  field: WeatherField,
) {
  const values = new Map<string, number | null>();
  const expectedDays =
    Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  for (const n of grid.nodes) {
    const v = Object.entries(n.days)
      .filter(([date]) => date >= start && date <= end)
      .map(([, d]) => d[field])
      .filter((v): v is number => v !== null);
    values.set(
      `${n.lat},${n.lon}`,
      field === "rain"
        ? v.length === expectedDays
          ? v.reduce((a, b) => a + b, 0)
          : null
        : v.length
          ? v.reduce((a, b) => a + b, 0) / v.length
          : null,
    );
  }
  const { south, north, west, east } = grid.bounds,
    step = grid.step;
  return (lat: number, lon: number) => {
    if (lat < south || lat > north || lon < west || lon > east) return null;
    const sampleStep = (step: number) => {
      const a = Math.min(
          north - step,
          south + Math.floor((lat - south) / step) * step,
        ),
        b = Math.min(
          east - step,
          west + Math.floor((lon - west) / step) * step,
        );
      const corners = [
        [a, b],
        [a, b + step],
        [a + step, b],
        [a + step, b + step],
      ].map(([la, lo]) => values.get(`${la},${lo}`));
      if (corners.some((v) => v === undefined || v === null)) return null;
      const x = (lon - b) / step,
        y = (lat - a) / step;
      return (
        corners[0]! * (1 - x) * (1 - y) +
        corners[1]! * x * (1 - y) +
        corners[2]! * (1 - x) * y +
        corners[3]! * x * y
      );
    };
    return (
      sampleStep(step) ?? (grid.coarseStep ? sampleStep(grid.coarseStep) : null)
    );
  };
}
export function weatherColor(
  value: number,
  field: "wind" | "rain",
  periodDays = 1,
): [number, number, number] {
  if (field === "rain") {
    // A weekly total must use a weekly legend, not the daily saturation limit.
    const amount = Math.max(0, Math.min(50, value / Math.max(1, periodDays)));
    const i = Math.min(
      RAIN_COLORS.length - 2,
      Math.max(0, RAIN_COLORS.findIndex((s) => s[0] >= amount) - 1),
    );
    const a = RAIN_COLORS[i],
      b = RAIN_COLORS[i + 1];
    const f = (amount - a[0]) / (b[0] - a[0]);
    return [1, 2, 3].map((j) => Math.round(a[j] + (b[j] - a[j]) * f)) as [
      number,
      number,
      number,
    ];
  }
  const stops = [
    [50, 79, 139],
    [46, 128, 164],
    [48, 166, 137],
    [140, 189, 93],
    [232, 192, 64],
    [219, 107, 61],
    [164, 55, 105],
  ];
  const t = Math.max(
      0,
      Math.min(stops.length - 1, (value / 40) * (stops.length - 1)),
    ),
    i = Math.min(stops.length - 2, Math.floor(t)),
    f = t - i;
  return stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f)) as [
    number,
    number,
    number,
  ];
}
