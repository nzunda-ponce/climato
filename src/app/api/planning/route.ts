import { isReportServer } from "@/runtime/role";
import { readPublishedPlanningReport } from "@/persistence/published-report";
import { NextResponse } from "next/server";
import { readState } from "@/persistence/store";
import { buildPlanningReport } from "@/domain/planning-report";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (isReportServer()) {
      const report = await readPublishedPlanningReport();
      if (!report)
        return NextResponse.json(
          {
            error:
              "El informe todavía no fue publicado. El proceso de datos debe completar la preparación inicial.",
          },
          { status: 503 },
        );
      return NextResponse.json(report, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json(
      buildPlanningReport(await readState({ purpose: "planning" })),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo cargar el informe de planificación." },
      { status: 500 },
    );
  }
}
