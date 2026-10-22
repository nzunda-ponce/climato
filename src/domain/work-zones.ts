export function equipmentZone(name: string): string | null {
  if (/^TBD(?:\b|_)/i.test(name.trim())) return null;
  return (
    name
      .trim()
      .toUpperCase()
      .match(/^[A-Z]([A-Z])/)?.[1] ?? null
  );
}
type Equipment = { name: string; field?: string };
export function equipmentZoneNames(equipment: Equipment[]) {
  return [
    ...new Set(
      equipment
        .map((e) => equipmentZone(e.name) ?? "?")
        .map((code) => (code === "?" ? "Sin zona asignada" : `Zona ${code}`)),
    ),
  ].sort();
}
// Weather remains keyed by coordinate. Split display memberships only when
// equipment from different work zones happens to share the same coordinate.
export function splitWorkZones<
  T extends {
    key: string;
    equipment: Equipment[];
    regions: string[];
    fields: string[];
    pending: number;
    name?: string;
    locationKey?: string;
  },
>(z: T) {
  const names = equipmentZoneNames(z.equipment);
  if (!names.length) return [{ ...z, locationKey: z.locationKey ?? z.key }];
  return names.map((name) => {
    const equipment = z.equipment.filter(
      (e) =>
        (equipmentZone(e.name)
          ? `Zona ${equipmentZone(e.name)}`
          : "Sin zona asignada") === name,
    ) as T["equipment"];
    return {
      ...z,
      name,
      key: names.length > 1 ? `${z.locationKey ?? z.key}::${name}` : z.key,
      locationKey: z.locationKey ?? z.key,
      regions: [name],
      fields: [
        ...new Set(
          equipment.map((e) => e.field).filter((f): f is string => !!f),
        ),
      ],
      equipment,
      pending: equipment.length,
    };
  });
}
