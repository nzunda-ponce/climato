import { PivotPlan } from "./types";
export type MapLayer =
  | "availability"
  | "probability"
  | "priority"
  | "access"
  | "wind"
  | "rain"
  | "deadline";
export const layers: {
  id: MapLayer;
  label: string;
  unit: string;
  max: number;
  description: string;
}[] = [
  {
    id: "availability",
    label: "Disponibilidad",
    unit: "",
    max: 100,
    description: "Ventana de ensayo y acceso para la fecha seleccionada.",
  },
  {
    id: "probability",
    label: "Probabilidad de ventana",
    unit: "%",
    max: 100,
    description:
      "Fracción de miembros favorables, con el mismo peso por familia. Sin calibrar.",
  },
  {
    id: "priority",
    label: "Prioridad operativa",
    unit: "/100",
    max: 100,
    description:
      "Ventana actual, oportunidades futuras, concentración de pendientes y plazo.",
  },
  {
    id: "access",
    label: "Riesgo de acceso",
    unit: "/100",
    max: 100,
    description:
      "Estimación de lluvia y suelo; un registro manual prevalece en el punto.",
  },
  {
    id: "deadline",
    label: "Riesgo de atraso",
    unit: "%",
    max: 100,
    description:
      "Fracción de simulaciones donde la zona no completa sus equipos antes del plazo. Estimación sin calibrar.",
  },
  {
    id: "wind",
    label: "Viento máximo diario",
    unit: "km/h",
    max: 40,
    description:
      "Mediana del máximo diario de los modelos determinísticos; no es el viento de la ventana.",
  },
  {
    id: "rain",
    label: "Lluvia acumulada diaria",
    unit: "mm",
    max: 40,
    description:
      "Mediana del acumulado de 24 horas de los modelos determinísticos.",
  },
];
export function mapValue(
  p: PivotPlan,
  date: string,
  layer: MapLayer,
): number | null {
  if (p.locationWarning) return null;
  const d = p.days.find((d) => d.date === date);
  if (!d) return null;
  if (layer === "availability")
    return d.condition === "DESCONOCIDO"
      ? null
      : d.condition === "APTO"
        ? 100
        : d.condition === "RIESGO"
          ? 50
          : 0;
  if (layer === "probability")
    return d.window?.probability ?? (d.coverage ? 0 : null);
  if (layer === "priority") return d.coverage ? d.priority : null;
  if (layer === "deadline") return p.campaignRisk ?? null;
  if (layer === "access")
    return d.road.manual
      ? d.road.condition === "APTO"
        ? 0
        : d.road.condition === "NO APTO"
          ? 100
          : null
      : d.road.score;
  if (layer === "wind") return d.weather?.wind ?? null;
  return d.weather?.rain ?? null;
}
export function layerColor(
  value: number,
  layer: MapLayer,
): [number, number, number] {
  const max = layers.find((l) => l.id === layer)!.max;
  let t = Math.max(0, Math.min(1, value / max));
  if (
    layer === "access" ||
    layer === "wind" ||
    layer === "rain" ||
    layer === "deadline"
  )
    t = 1 - t;
  const stops: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ] = [
    [220, 83, 76],
    [238, 194, 78],
    [48, 163, 126],
  ];
  const a = t < 0.5 ? stops[0] : stops[1],
    b = t < 0.5 ? stops[1] : stops[2];
  const f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return a.map((v, i) => Math.round(v + (b[i] - v) * f)) as [
    number,
    number,
    number,
  ];
}
export function weightedSurface(
  points: { x: number; y: number; radius: number; value: number }[],
  x: number,
  y: number,
): { value: number; coverage: number } | null {
  let total = 0,
    weight = 0,
    coverage = 0;
  for (const p of points) {
    const distance = Math.hypot(p.x - x, p.y - y) / p.radius;
    if (distance >= 1) continue;
    const w = (1 - distance * distance) ** 2;
    total += p.value * w;
    weight += w;
    coverage = Math.max(coverage, 1 - distance);
  }
  return weight ? { value: total / weight, coverage } : null;
}
