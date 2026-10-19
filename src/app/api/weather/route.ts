import { NextResponse } from "next/server";
import { OpenMeteoProvider } from "@/providers/weather";
import { readState, mutateState, saveSnapshot } from "@/persistence/store";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ids: string[] = body.pivotIds ?? [body.pivotId];
    if (!Array.isArray(ids) || !ids.length || ids.length > 20)
      return NextResponse.json(
        { error: "Seleccioná entre 1 y 20 equipos por lote." },
        { status: 400 },
      );
    const state = await readState();
    const pivots = ids.map((id) => state.pivots.find((p) => p.id === id));
    if (pivots.some((p) => !p))
      return NextResponse.json(
        { error: "Equipo inexistente" },
        { status: 404 },
      );
    const fresh = pivots.filter((p) => {
      const cached = state.forecasts[p!.id];
      return !cached || Date.now() - Date.parse(cached.fetchedAt) >= 3600000;
    });
    if (!fresh.length) return NextResponse.json({ ok: true, cached: true });
    const forecasts = await new OpenMeteoProvider().forecastMany(
      fresh.map((p) => p!),
    );
    if (!forecasts.some((f) => f.models.length))
      return NextResponse.json(
        {
          error:
            "No se pudo obtener meteorología real. " +
            forecasts[0].errors.join(" · "),
        },
        { status: 502 },
      );
    for (let i = 0; i < fresh.length; i++)
      await saveSnapshot(fresh[i]!.id, forecasts[i]);
    await mutateState((s) => {
      fresh.forEach((p, i) => {
        if (forecasts[i].models.length) s.forecasts[p!.id] = forecasts[i];
      });
    });
    return NextResponse.json({
      ok: true,
      models: forecasts[0].models.length,
      warnings: forecasts[0].errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error de proveedor" },
      { status: 500 },
    );
  }
}
