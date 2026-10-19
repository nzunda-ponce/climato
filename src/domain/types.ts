export type WorkStatus = "PENDIENTE" | "PROGRAMADO" | "TERMINADO";
export type Access = "APTO" | "NO APTO" | "DESCONOCIDO";
export interface Pivot {
  id: string;
  name: string;
  field: string;
  region?: string;
  province?: string;
  lat: number;
  lon: number;
  status: WorkStatus;
  scheduledDate?: string;
  crew?: number;
  road: Access;
  roadComment?: string;
  roadUpdatedAt?: string;
}
export interface Rules {
  minimumProbability: number;
  wind: number;
  minHours: number;
  rain: number;
  startHour: number;
  endHour: number;
  crews: number;
  jobsPerCrew: number;
  horizon: number;
  deadline: string;
  clusterKm: number;
  rain24Limit: number;
  rain72Limit: number;
  soilLimit: number;
  historicalAvailability: number;
  seasonalAdjustment: number;
}
export const defaultRules: Rules = {
  minimumProbability: 50,
  wind: 16,
  minHours: 4,
  rain: 0,
  startHour: 7,
  endHour: 19,
  crews: 2,
  jobsPerCrew: 2,
  horizon: 14,
  deadline: "2026-12-31",
  clusterKm: 30,
  rain24Limit: 15,
  rain72Limit: 35,
  soilLimit: 0.38,
  historicalAvailability: 0.42,
  seasonalAdjustment: 1,
};
export interface Hour {
  time: string;
  wind: number | null;
  gust: number | null;
  rain: number | null;
  soil: number | null;
}
export interface ModelForecast {
  model: string;
  family?: string;
  member?: string;
  kind?: "deterministic" | "ensemble";
  hours: Hour[];
}
export interface WeatherForecast {
  intervalAligned?: boolean;
  fetchedAt: string;
  models: ModelForecast[];
  errors: string[];
  source: string;
}
export interface Window {
  start: string;
  end: string;
  hours: number;
  probability: number;
  confidence: number;
  wind: number;
  gust: number;
  rain: number;
  members: number;
  families?: number;
  basis?: "ensemble" | "model-agreement";
  coverage?: number;
  spread?: number;
  windRainAgreement?: number;
}
export interface RoadRisk {
  score: number | null;
  condition: "APTO" | "RIESGO" | "NO APTO" | "DESCONOCIDO";
  rain24: number | null;
  rain48: number | null;
  rain72: number | null;
  soil: number | null;
  manual: boolean;
}
export interface DayDecision {
  weather?: { wind: number | null; gust: number | null; rain: number | null };
  date: string;
  window: Window | null;
  road: RoadRisk;
  condition: "APTO" | "RIESGO" | "NO APTO" | "DESCONOCIDO";
  priority: number;
  opportunity: number;
  futureWindows: number;
  explanation: string;
  coverage: number;
}
export interface PivotPlan {
  campaignRisk?: number;
  locationWarning?: string;
  pivot: Pivot;
  cluster: string;
  nearby: number;
  days: DayDecision[];
  error?: string;
}
export function locationWarning(pivot: Pivot): string | undefined {
  return pivot.province && pivot.lat > 0
    ? "Latitud norte para un establecimiento identificado en una provincia argentina. Verificar coordenadas antes de planificar."
    : undefined;
}
export const localDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
