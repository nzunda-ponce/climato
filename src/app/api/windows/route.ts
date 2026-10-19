import { NextResponse } from "next/server";
import { z } from "zod";
import { readState } from "@/persistence/store";
import { hourlyWindowDetail } from "@/domain/window-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const parameters = z
    .object({ pivotId: z.string().min(1).max(200), date: z.string().date() })
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parameters.success)
    return NextResponse.json(
      { error: "Indicá equipo y fecha válidos." },
      { status: 400 },
    );
  try {
    const state = await readState();
    const { pivotId, date } = parameters.data;
    if (!state.pivots.some((pivot) => pivot.id === pivotId))
      return NextResponse.json(
        { error: "Equipo inexistente." },
        { status: 404 },
      );
    return NextResponse.json(
      hourlyWindowDetail(state.forecasts[pivotId], state.rules, date),
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo consultar el horario. Reintentá." },
      { status: 500 },
    );
  }
}
