import { PivotPlan, Rules } from "@/domain/types";
import { climatePotential } from "@/domain/climatic";
import { HistoricalClimate } from "@/domain/evidence";
import { EnsoIndex, ForecastGrid } from "@/domain/seasonal";
export interface ClimateData {
  plans: PivotPlan[];
  rules: Rules;
  climatic: ReturnType<typeof climatePotential>;
  today: string;
}
export interface SourceStatus {
  cells: { key: string; lat: number; lon: number }[];
  enso: {
    source: string;
    fetchedAt: string;
    latest: EnsoIndex["latest"];
  } | null;
  grid?: ForecastGrid;
  gridStatus: {
    fetchedAt: string;
    points: number;
    total: number;
    step: number;
    model: string;
    errors: string[];
  } | null;
  regions: {
    key: string;
    lat: number;
    lon: number;
    history: {
      years: number[];
      source: string;
      samples: number;
      enso: HistoricalClimate["enso"];
      validation: HistoricalClimate["validation"];
      fetchedAt: string;
    } | null;
    forecast: {
      days: number;
      covered: number;
      fetchedAt: string;
      errors: string[];
      method: string;
    } | null;
    ensemble: { family: string; members: number; usableMembers: number }[];
  }[];
}
