import { NextResponse } from "next/server";
import { readState, mutateState } from "@/persistence/store";
import { cellKey, trainCalibration } from "@/domain/evidence";
import { locationWarning } from "@/domain/types";
import { loadEnsemble, loadHistoricalClimate } from "@/providers/research";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET() {
  const s = await readState();
  const cells = [
    ...new Map(
      s.pivots
        .filter((p) => !locationWarning(p))
        .map((p) => [
          cellKey(p.lat, p.lon),
          { key: cellKey(p.lat, p.lon), lat: p.lat, lon: p.lon },
        ]),
    ).values(),
  ];
  return NextResponse.json({
    cells,
    ensembles: Object.values(s.ensembles ?? {}).map(
      ({ paths, windows, ...summary }) => ({
        ...summary,
        windows: windows.length,
      }),
    ),
    climate: Object.values(s.climate ?? {}).map(
      ({ days, ...summary }) => summary,
    ),
    calibration: trainCalibration(s.observations ?? []),
  });
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const s = await readState();
    const point = s.pivots.find(
      (p) => cellKey(p.lat, p.lon) === body.key && !locationWarning(p),
    );
    if (!point) throw new Error("Celda sin ubicación válida");
    if (body.kind === "ensemble") {
      const result = await loadEnsemble(
        body.key,
        point.lat,
        point.lon,
        s.rules,
      );
      await mutateState((s) => {
        (s.ensembles ??= {})[body.key] = result;
      });
      return NextResponse.json({
        ok: true,
        sources: result.sources,
        errors: result.errors,
      });
    }
    if (body.kind === "history") {
      const result = await loadHistoricalClimate(
        body.key,
        point.lat,
        point.lon,
        s.rules,
      );
      await mutateState((s) => {
        (s.climate ??= {})[body.key] = result;
      });
      return NextResponse.json({ ok: true, years: result.years });
    }
    throw new Error("Fuente no válida");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error de fuente" },
      { status: 502 },
    );
  }
}
