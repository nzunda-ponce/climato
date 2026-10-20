import type { PlanningZone } from "./planning-report";
// Geographic search references, not a claim about municipal boundaries or field addresses.
const references: [string, number, number][] = [
  ["Necochea", -38.5545, -58.7396],
  ["Balcarce", -37.8462, -58.2555],
  ["Mar del Plata", -38.0055, -57.5426],
  ["Tandil", -37.3217, -59.1332],
  ["Tres Arroyos", -38.3739, -60.2797],
  ["Pergamino", -33.8899, -60.5736],
  ["Junín", -34.585, -60.958],
  ["Venado Tuerto", -33.7456, -61.9688],
  ["Río Cuarto", -33.1232, -64.3493],
  ["San Miguel de Tucumán", -26.8083, -65.2176],
  ["Concepción", -27.3428, -65.5933],
  ["Villa Mercedes", -33.6757, -65.4578],
];
export function nearbyReference(z: Pick<PlanningZone, "lat" | "lon">) {
  const rad = Math.PI / 180;
  const nearby = references
    .map(([name, lat, lon]) => {
      const a =
        Math.sin(((lat - z.lat) * rad) / 2) ** 2 +
        Math.cos(z.lat * rad) *
          Math.cos(lat * rad) *
          Math.sin(((lon - z.lon) * rad) / 2) ** 2;
      return {
        name,
        km: Math.round(6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))),
      };
    })
    .filter((p) => p.km <= 60)
    .sort((a, b) => a.km - b.km)[0];
  return nearby ? `A ${nearby.km} km de ${nearby.name} (referencia)` : "";
}
export function matchesLocation(
  z: PlanningZone,
  query: string,
  region: string,
) {
  const normalize = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es");
  return normalize(
    [
      region,
      ...z.provinces,
      ...z.fields,
      ...z.equipment.map((e) => e.name),
      nearbyReference(z),
      z.key,
    ].join(" "),
  ).includes(normalize(query.trim()));
}
