import { NextResponse } from "next/server";
import { readState } from "@/persistence/store";
import { buildOpportunityReport } from "@/domain/opportunity-report";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(
      buildOpportunityReport(await readState({ purpose: "planning" })),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    console.error(
      "Informe de oportunidades:",
      e instanceof Error ? e.message : "Error de lectura",
    );
    return NextResponse.json(
      {
        error:
          "No se pudo actualizar el informe. Se conservan los últimos datos visibles; reintentá en unos segundos.",
      },
      { status: 500 },
    );
  }
}
