import { NextResponse } from "next/server";
import { readState, mutateState } from "@/persistence/store";
import { cellKey } from "@/domain/evidence";
import { localDate, locationWarning } from "@/domain/types";
import {
  EnsoIndex,
  ForecastGrid,
  PUBLIC_WEATHER_BOUNDS,
  publicGridPoints,
} from "@/domain/seasonal";
import {
  gridCoordinates,
  loadEnso,
  loadGridBatch,
  loadLongHistory,
  loadSeasonal,
  readLongCache,
  writeLongCache,
} from "@/providers/long-range";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const [s, grid, index] = await Promise.all([
      readState(),
      readLongCache<ForecastGrid>("grid"),
      readLongCache<EnsoIndex>("enso-roni"),
    ]);
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
    const enso = index
      ? {
          ...index,
          values: undefined,
          phases: undefined,
          latest: {
            ...index.latest,
            phase:
              index.latest.value >= 0.5
                ? "Niño"
                : index.latest.value <= -0.5
                  ? "Niña"
                  : "Neutral",
          },
        }
      : null;
    return NextResponse.json({
      cells,
      enso,
      grid: new URL(request.url).searchParams.has("grid") ? grid : undefined,
      gridStatus: grid
        ? {
            fetchedAt: grid.fetchedAt,
            points: grid.nodes.length,
            total: grid.coarseStep
              ? publicGridPoints().length
              : gridCoordinates(grid.bounds, grid.step).length,
            step: grid.step,
            model: grid.model,
            bounds: grid.bounds,
            errors: grid.errors,
          }
        : null,
      regions: cells.map((c) => {
        const h = s.climate?.[c.key],
          f = s.seasonal?.[c.key],
          e = s.ensembles?.[c.key];
        return {
          ...c,
          history: h
            ? {
                years: h.years,
                source: h.source,
                samples: h.features?.length ?? 0,
                enso: h.enso,
                validation: h.validation,
                fetchedAt: h.fetchedAt,
              }
            : null,
          forecast: f
            ? {
                days: Object.keys(f.days).length,
                covered: Object.values(f.days).filter(
                  (d) => d.probability !== null,
                ).length,
                fetchedAt: f.fetchedAt,
                errors: f.errors,
                method: f.method,
              }
            : null,
          ensemble: e?.sources ?? [],
        };
      }),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "No se pudieron leer las fuentes",
      },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.kind === "enso")
      return NextResponse.json({ ok: true, enso: await loadEnso() });
    const s = await readState();
    if (body.kind === "grid") {
      if (!Number.isInteger(body.offset) || body.offset < 0)
        throw new Error("Lote de malla inválido");
      // Public, fixed geography. No pivot coordinates are sent to build this grid.
      const bounds = PUBLIC_WEATHER_BOUNDS,
        nodes = publicGridPoints(),
        slice = nodes.slice(body.offset, body.offset + 8);
      if (!slice.length) throw new Error("Lote fuera de la malla");
      const result = await loadGridBatch(slice, s.rules.deadline),
        old = await readLongCache<ForecastGrid>("grid");
      const grid: ForecastGrid =
        old && old.end === s.rules.deadline && old.start === localDate()
          ? { ...old, bounds, coarseStep: 2 }
          : {
              bounds,
              step: 1,
              coarseStep: 2,
              start: localDate(),
              end: s.rules.deadline,
              fetchedAt: new Date().toISOString(),
              nodes: [],
              model:
                "Open-Meteo corto plazo / ECMWF EC46 / SEAS5 ensemble mean",
              errors: [],
            };
      grid.nodes = grid.nodes
        .filter((n) => !result.some((p) => p.lat === n.lat && p.lon === n.lon))
        .concat(result);
      grid.fetchedAt = new Date().toISOString();
      await writeLongCache("grid", grid);
      return NextResponse.json({
        ok: true,
        done: grid.nodes.length,
        total: nodes.length,
      });
    }
    const p = s.pivots.find(
      (p) => cellKey(p.lat, p.lon) === body.key && !locationWarning(p),
    );
    if (!p) throw new Error("Ubicación inválida");
    if (body.kind === "history") {
      const h = await loadLongHistory(
        body.key,
        p.lat,
        p.lon,
        s.rules,
        await loadEnso(),
      );
      const forecast = await loadSeasonal(body.key, p.lat, p.lon, s.rules, h);
      await mutateState((s) => {
        (s.climate ??= {})[body.key] = h;
        (s.seasonal ??= {})[body.key] = forecast;
      });
      return NextResponse.json({
        ok: true,
        years: h.years.length,
        days: Object.keys(forecast.days).length,
      });
    }
    if (body.kind === "seasonal") {
      const forecast = await loadSeasonal(
        body.key,
        p.lat,
        p.lon,
        s.rules,
        s.climate?.[body.key],
      );
      await mutateState((s) => {
        (s.seasonal ??= {})[body.key] = forecast;
      });
      return NextResponse.json({ ok: true, errors: forecast.errors });
    }
    throw new Error("Fuente no válida");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error consultando la fuente" },
      { status: 502 },
    );
  }
}
