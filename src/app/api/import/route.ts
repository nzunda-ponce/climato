import { NextResponse } from "next/server";
import { parsePivots } from "@/domain/import";
import { mutateState } from "@/persistence/store";
import { syncPivots } from "@/domain/sync-pivots";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    let bytes: Uint8Array;
    let filename: string;
    if (req.headers.get("content-type")?.includes("application/json")) {
      const { url } = await req.json();
      const parsed = new URL(url);
      if (
        !["www.google.com", "google.com"].includes(parsed.hostname) ||
        !parsed.searchParams.get("mid")
      )
        throw new Error("Usá un enlace válido de Google My Maps.");
      const endpoint = new URL("https://www.google.com/maps/d/kml");
      endpoint.searchParams.set("mid", parsed.searchParams.get("mid")!);
      endpoint.searchParams.set("forcekml", "1");
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      if (!res.ok)
        throw new Error(
          "Mapa no accesible. Exportalo como KML/KMZ e importá el archivo.",
        );
      bytes = new Uint8Array(await res.arrayBuffer());
      filename = "map.kml";
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("Seleccioná un archivo.");
      if (file.size > 10_000_000) throw new Error("El máximo es 10 MB.");
      bytes = new Uint8Array(await file.arrayBuffer());
      filename = file.name;
    }
    const pivots = parsePivots(bytes, filename);
    let added = 0;
    let updated = 0;
    await mutateState(
      (s) => {
        const result = syncPivots(s.pivots, pivots);
        s.pivots = result.pivots;
        added = result.added;
        updated = result.changedIds.length;
        for (const id of result.changedIds) delete s.forecasts[id];
      },
      { namespaces: ["settings", "pivot", "forecast"] },
    );
    return NextResponse.json({ added, updated, total: pivots.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo importar" },
      { status: 400 },
    );
  }
}
