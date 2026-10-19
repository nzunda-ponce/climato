import { Pivot } from "./types";
export function syncPivots(existing: Pivot[], incoming: Pivot[]) {
  const pivots = existing.map((p) => ({ ...p }));
  const names = (s: string) => s.trim().toLocaleLowerCase("es-AR");
  const changedIds: string[] = [];
  let added = 0;
  for (const p of incoming) {
    const matches = pivots.filter((e) => names(e.name) === names(p.name));
    const old =
      pivots.find((e) => e.id === p.id) ??
      (matches.length === 1 &&
      incoming.filter((e) => names(e.name) === names(p.name)).length === 1
        ? matches[0]
        : undefined);
    if (!old) {
      pivots.push(p);
      added++;
      continue;
    }
    if (old.lat !== p.lat || old.lon !== p.lon) {
      old.lat = p.lat;
      old.lon = p.lon;
      changedIds.push(old.id);
    }
    for (const key of ["field", "province", "region"] as const)
      if (p[key]) old[key] = p[key];
  }
  return { pivots, added, changedIds };
}
