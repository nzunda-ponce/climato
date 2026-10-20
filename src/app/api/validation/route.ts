import { NextResponse } from "next/server";
import { readState } from "@/persistence/store";
import { cellKey, rulesSignature } from "@/domain/evidence";
import { confusionReport } from "@/domain/forecast-validation";
import { locationWarning } from "@/domain/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const s = await readState(),
      params = new URL(request.url).searchParams;
    const lead = Number(params.get("lead") ?? 1),
      threshold = Number(params.get("threshold") ?? 0.7);
    if (
      !Number.isInteger(lead) ||
      lead < 1 ||
      lead > 14 ||
      !Number.isFinite(threshold) ||
      threshold < 0.5 ||
      threshold > 0.95
    )
      return NextResponse.json(
        { error: "Horizonte o umbral inválido." },
        { status: 400 },
      );
    const allowed = new Set(
      s.pivots
        .filter((p) => p.status !== "TERMINADO" && !locationWarning(p))
        .map((p) => cellKey(p.lat, p.lon)),
    );
    const keys = [...new Set(params.getAll("key"))].filter((k) =>
      allowed.has(k),
    );
    return NextResponse.json(
      confusionReport(
        s.validationArchive ?? { predictions: [], outcomes: [] },
        keys,
        rulesSignature(s.rules),
        lead,
        threshold,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo consultar la verificación." },
      { status: 500 },
    );
  }
}
