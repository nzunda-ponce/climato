import { NextResponse } from "next/server";
import { readState } from "@/persistence/store";
import { buildPlanningReport } from "@/domain/planning-report";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(buildPlanningReport(await readState()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo cargar el informe de planificación." },
      { status: 500 },
    );
  }
}
