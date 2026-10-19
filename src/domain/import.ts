import { XMLParser } from "fast-xml-parser";
import Papa from "papaparse";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { Pivot } from "./types";
export function parsePivots(buffer: Uint8Array, filename: string): Pivot[] {
  let text = new TextDecoder().decode(buffer);
  let name = filename.toLowerCase();
  if (name.endsWith(".kmz")) {
    const files = unzipSync(buffer);
    const key = Object.keys(files).find((k) =>
      k.toLowerCase().endsWith(".kml"),
    );
    if (!key) throw new Error("El KMZ no contiene KML.");
    text = new TextDecoder().decode(files[key]);
    name = "map.kml";
  }
  const raw: {
    name: string;
    field: string;
    region?: string;
    province?: string;
    lat: number;
    lon: number;
  }[] = [];
  if (name.endsWith(".csv")) {
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    if (parsed.errors.length)
      throw new Error("CSV inválido: " + parsed.errors[0].message);
    parsed.data.forEach((r, i) =>
      raw.push({
        name: r.name || r.nombre || r.id || `Pivot ${i + 1}`,
        field: r.field || r.establecimiento || "",
        lat: (r.lat ?? r.latitude ?? r.latitud)?.trim()
          ? Number(r.lat ?? r.latitude ?? r.latitud)
          : NaN,
        lon: (r.lon ?? r.longitude ?? r.longitud)?.trim()
          ? Number(r.lon ?? r.longitude ?? r.longitud)
          : NaN,
      }),
    );
  } else if (name.endsWith(".json") || name.endsWith(".geojson")) {
    const data = JSON.parse(text);
    const features =
      data.type === "FeatureCollection"
        ? data.features
        : data.type === "Feature"
          ? [data]
          : [];
    for (const f of features) {
      if (f.geometry?.type !== "Point") continue;
      raw.push({
        name:
          f.properties?.name ||
          f.properties?.nombre ||
          `Pivot ${raw.length + 1}`,
        field: f.properties?.field || f.properties?.establecimiento || "",
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      });
    }
  } else if (name.endsWith(".kml")) {
    const xml = new XMLParser({ ignoreAttributes: false }).parse(text);
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "Placemark") {
          for (const p of Array.isArray(value) ? value : [value]) {
            const coords = p.Point?.coordinates;
            if (coords) {
              const [lon, lat] = String(coords).trim().split(",").map(Number);
              const entries = p.ExtendedData?.Data;
              const metadata = Object.fromEntries(
                (Array.isArray(entries)
                  ? entries
                  : entries
                    ? [entries]
                    : []
                ).map((entry: Record<string, unknown>) => [
                  String(entry["@_name"]).toLowerCase(),
                  String(entry.value ?? ""),
                ]),
              );
              raw.push({
                name: String(p.name || `Pivot ${raw.length + 1}`),
                field:
                  metadata.campo ||
                  metadata.establecimiento ||
                  metadata.field ||
                  "",
                region: metadata["región"],
                province: metadata.provincia,
                lat,
                lon,
              });
            }
          }
        } else if (Array.isArray(value)) value.forEach(walk);
        else walk(value);
      }
    };
    walk(xml);
  } else throw new Error("Formato no admitido. Usá CSV, GeoJSON, KML o KMZ.");
  if (!raw.length)
    throw new Error(
      "No se encontraron puntos. Exportá las ubicaciones como puntos geográficos.",
    );
  if (raw.length > 3000) throw new Error("Máximo 3000 puntos por importación.");
  return raw.map((p, i) => {
    if (
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lon) > 180
    )
      throw new Error(`Coordenadas inválidas en fila ${i + 1}.`);
    return {
      ...p,
      id: createHash("sha256")
        .update(`${p.name}|${p.lat}|${p.lon}`)
        .digest("hex")
        .slice(0, 20),
      status: "PENDIENTE",
      road: "DESCONOCIDO",
    };
  });
}
