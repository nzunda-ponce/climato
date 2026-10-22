import { NextResponse } from "next/server";
import { readState, readClimate, readClimateBatch } from "@/persistence/store";
import { cellKey, rulesSignature } from "@/domain/evidence";
import { locationWarning } from "@/domain/types";
import { modelDiagnostics } from "@/ml/model-diagnostics";
import {
  combineDiagnostics,
  type DiagnosticBatch,
} from "@/domain/ml-diagnostics";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const key = params.get("key");
  const global = params.get("scope") === "all";
  const offset = Number(params.get("offset") ?? 0);
  const threshold = Number(params.get("threshold") ?? 0.7);
  if (
    (!key && !global) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isFinite(threshold) ||
    threshold < 0.5 ||
    threshold > 0.95
  )
    return NextResponse.json(
      { error: "Ubicación o umbral inválido." },
      { status: 400 },
    );
  try {
    const state = await readState({ namespaces: ["settings", "pivot"] });
    if (global) {
      const keys = [
        ...new Set(
          state.pivots
            .filter((p) => p.status !== "TERMINADO" && !locationWarning(p))
            .map((p) => cellKey(p.lat, p.lon)),
        ),
      ].sort();
      const signature = rulesSignature(state.rules);
      const page = keys.slice(offset, offset + 8);
      const histories = await readClimateBatch(page);
      const results = histories.map((history) => {
        if (!history || history.rulesSignature !== signature) return null;
        const result = modelDiagnostics(history, threshold);
        return result &&
          result.weather.matchesSavedCount &&
          result.weather.matchesSavedMetrics &&
          result.calendar.matchesSavedCount &&
          result.calendar.matchesSavedMetrics
          ? result
          : null;
      });
      const valid = results.filter((result) => result !== null);
      const batch: DiagnosticBatch = {
        total: keys.length,
        processed: offset + page.length,
        next: offset + page.length < keys.length ? offset + page.length : null,
        included: valid.length,
        excluded: page.length - valid.length,
        cohort: createHash("sha256")
          .update(JSON.stringify([signature, keys]))
          .digest("hex"),
        years: [...new Set(valid.flatMap((result) => result.years))].sort(
          (a, b) => a - b,
        ),
        weather: {
          model: combineDiagnostics(valid.map((r) => r.weather.model)),
          baseline: combineDiagnostics(valid.map((r) => r.weather.baseline)),
        },
        calendar: {
          model: combineDiagnostics(valid.map((r) => r.calendar.model)),
          baseline: combineDiagnostics(valid.map((r) => r.calendar.baseline)),
        },
      };
      return NextResponse.json(batch, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (
      !state.pivots.some(
        (p) =>
          p.status !== "TERMINADO" &&
          !locationWarning(p) &&
          cellKey(p.lat, p.lon) === key,
      )
    )
      return NextResponse.json(
        { error: "Ubicación fuera del análisis activo." },
        { status: 404 },
      );
    const history = await readClimate(key!);
    if (!history || history.rulesSignature !== rulesSignature(state.rules))
      return NextResponse.json(
        { error: "No hay históricos compatibles con los criterios actuales." },
        { status: 409 },
      );
    const diagnostics = modelDiagnostics(history, threshold);
    if (!diagnostics)
      return NextResponse.json(
        {
          error:
            "El modelo o las variables históricas no coinciden con el entrenamiento guardado. No se reconstruye una matriz con datos diferentes.",
        },
        { status: 409 },
      );
    return NextResponse.json(diagnostics, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo calcular el diagnóstico histórico." },
      { status: 500 },
    );
  }
}
