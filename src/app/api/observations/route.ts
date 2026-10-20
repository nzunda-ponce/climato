import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readState, mutateState } from "@/persistence/store";
import { trainCalibration } from "@/domain/evidence";
const schema = z
  .object({
    pivotId: z.string(),
    issuedAt: z.string().datetime(),
    validAt: z.string().datetime(),
    probability: z.number().min(0).max(1),
    operable: z.boolean(),
    source: z.enum(["estacion", "ensayo", "encargado"]),
    wind: z.number().nonnegative().optional(),
    rain: z.number().nonnegative().optional(),
    access: z.boolean().optional(),
  })
  .refine(
    (v) => v.issuedAt < v.validAt && Date.parse(v.validAt) <= Date.now(),
    "La verificación debe corresponder a una ventana pasada y a un pronóstico emitido antes de ella.",
  );
export async function GET() {
  const s = await readState({ namespaces: ["observation"] });
  return NextResponse.json({
    count: s.observations?.length ?? 0,
    calibration: trainCalibration(s.observations ?? []),
  });
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const entries = z
      .array(schema)
      .max(10000)
      .parse(Array.isArray(body) ? body : [body]);
    await mutateState(
      (s) => {
        for (const item of entries) {
          if (!s.pivots.some((p) => p.id === item.pivotId))
            throw new Error("Equipo inexistente");
          if (
            s.observations?.some(
              (o) => o.pivotId === item.pivotId && o.validAt === item.validAt,
            )
          )
            throw new Error("Ventana ya verificada para ese equipo");
          (s.observations ??= []).push({ id: randomUUID(), ...item });
        }
      },
      { namespaces: ["pivot", "observation"] },
    );
    return NextResponse.json({ ok: true, added: entries.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verificación inválida" },
      { status: 400 },
    );
  }
}
