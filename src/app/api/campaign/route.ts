import { NextResponse } from "next/server";
import { z } from "zod";
import { readState, mutateState } from "@/persistence/store";
import { buildPlans, projectCampaign } from "@/domain/planning";
import {
  defaultRules,
  localDate,
  locationWarning,
  PivotPlan,
} from "@/domain/types";
import { simulateCampaign } from "@/domain/simulation";
import { climatePotential } from "@/domain/climatic";
import { trainCalibration, cellKey } from "@/domain/evidence";
import { autoSync } from "@/providers/auto-sync";
import { operationalSync } from "@/providers/operational-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const state = await readState();
    if (new URL(request.url).searchParams.get("mode") === "climate") {
      const plans: PivotPlan[] = state.pivots.map((pivot) => ({
        pivot,
        days: [],
        cluster: cellKey(pivot.lat, pivot.lon),
        nearby: 0,
        locationWarning: locationWarning(pivot),
      }));
      return NextResponse.json({
        plans,
        rules: state.rules,
        today: localDate(),
        climatic: climatePotential(
          plans,
          state.rules,
          state.ensembles,
          state.climate,
          localDate(),
          Date.now(),
          state.seasonal,
        ),
      });
    }
    const plans = buildPlans(
      state.pivots,
      state.forecasts,
      state.rules,
      state.ensembles,
      state.climate,
    );
    const simulation = simulateCampaign(
      plans,
      state.rules,
      state.ensembles ?? {},
      state.climate ?? {},
      500,
    );
    const campaign = projectCampaign(plans, state.rules);
    campaign.probability = null;
    campaign.status =
      simulation.completedP90 <
      campaign.pending - simulation.unresolvedLocations
        ? "CRÍTICO"
        : simulation.unresolvedLocations
          ? "EN RIESGO"
          : simulation.probability >= 80
            ? "EN TIEMPO"
            : simulation.probability < 20
              ? "CRÍTICO"
              : "EN RIESGO";
    plans.forEach((p) => {
      const region = simulation.regions.find(
        (g) => g.key === cellKey(p.pivot.lat, p.pivot.lon),
      );
      p.campaignRisk = region ? 100 - region.completionProbability : undefined;
    });
    return NextResponse.json({
      plans,
      rules: state.rules,
      campaign,
      simulation,
      climatic: climatePotential(
        plans,
        state.rules,
        state.ensembles,
        state.climate,
        localDate(),
        Date.now(),
        state.seasonal,
      ),
      evidence: {
        ensembles: Object.keys(state.ensembles ?? {}).length,
        climate: Object.keys(state.climate ?? {}).length,
        calibration: trainCalibration(state.observations ?? []),
      },
      today: localDate(),
      updatedAt: Object.values(state.forecasts)
        .map((f) => f.fetchedAt)
        .sort()
        .at(-1),
      storage: process.env.DATABASE_URL ? "PostgreSQL" : "Archivo local",
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "No se pudo leer la campaña. Revisá la conexión de persistencia.",
      },
      { status: 500 },
    );
  }
}
const positive = z.number().finite().positive();
const rulesSchema = z
  .object({
    minimumProbability: z.number().min(0).max(100),
    wind: positive.max(100),
    minHours: z.number().int().min(1).max(12),
    rain: z.number().min(0).max(20),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    crews: z.number().int().min(1).max(100),
    jobsPerCrew: z.number().int().min(1).max(20),
    horizon: z.number().int().min(1).max(35),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => !Number.isNaN(Date.parse(v))),
    clusterKm: positive.max(500),
    rain24Limit: positive.max(300),
    rain72Limit: positive.max(600),
    soilLimit: positive.max(1),
    historicalAvailability: z.number().min(0).max(1),
    seasonalAdjustment: positive.max(2),
  })
  .refine(
    (r) => r.endHour - r.startHour >= r.minHours,
    "El horario debe permitir la duración mínima.",
  );
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === "rules") {
      const rules = rulesSchema.parse({ ...defaultRules, ...body.rules });
      await mutateState((s) => {
        s.rules = rules;
      });
      autoSync.invalidate();
      operationalSync.invalidate();
      void operationalSync.start();
      void autoSync.start();
    } else if (body.action === "pivot") {
      const patch = z
        .object({
          id: z.string(),
          status: z.enum(["PENDIENTE", "PROGRAMADO", "TERMINADO"]),
          road: z.enum(["APTO", "NO APTO", "DESCONOCIDO"]),
          roadComment: z.string().max(1000).optional(),
          scheduledDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          crew: z.number().int().positive().optional(),
          lat: z.number().finite().min(-90).max(90).optional(),
          lon: z.number().finite().min(-180).max(180).optional(),
        })
        .parse(body.pivot);
      await mutateState((s) => {
        const p = s.pivots.find((p) => p.id === patch.id);
        if (!p) throw new Error("Equipo inexistente.");
        if (
          patch.status === "PROGRAMADO" &&
          (!patch.scheduledDate || !patch.crew)
        )
          throw new Error("Indicá fecha y cuadrilla.");
        if (patch.crew && patch.crew > s.rules.crews)
          throw new Error("Cuadrilla no disponible.");
        if (
          patch.status === "PROGRAMADO" &&
          s.pivots.filter(
            (p) =>
              p.id !== patch.id &&
              p.status === "PROGRAMADO" &&
              p.scheduledDate === patch.scheduledDate &&
              p.crew === patch.crew,
          ).length >= s.rules.jobsPerCrew
        )
          throw new Error("La cuadrilla alcanzó su capacidad diaria.");
        if (
          (patch.lat !== undefined && patch.lat !== p.lat) ||
          (patch.lon !== undefined && patch.lon !== p.lon)
        )
          delete s.forecasts[p.id];
        const roadChanged =
          patch.road !== p.road || patch.roadComment !== p.roadComment;
        Object.assign(
          p,
          patch,
          roadChanged ? { roadUpdatedAt: new Date().toISOString() } : {},
        );
      });
    } else throw new Error("Acción no válida.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues.map((i) => i.message).join(", ")
            : e instanceof Error
              ? e.message
              : "Solicitud inválida",
      },
      { status: 400 },
    );
  }
}
