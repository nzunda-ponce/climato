import type { Pivot } from "@/domain/types";
// Rotate work regions instead of exhausting a single region's equipment first.
export function fairEnsembleOrder(
  points: [string, Pivot][],
  hasData: (key: string) => boolean,
) {
  const regions = new Map<string, typeof points>();
  for (const entry of [...points].sort(
    ([a], [b]) => Number(hasData(a)) - Number(hasData(b)),
  )) {
    const name = entry[1].region || entry[1].province || entry[1].field;
    regions.set(name, [...(regions.get(name) ?? []), entry]);
  }
  const ordered: typeof points = [];
  while ([...regions.values()].some((rows) => rows.length))
    for (const rows of regions.values()) {
      const point = rows.shift();
      if (point) ordered.push(point);
    }
  return ordered;
}
