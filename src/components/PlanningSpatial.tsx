"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { PlanningZone } from "@/domain/planning-report";
import {
  availabilityGroups,
  availabilityCell,
  availabilityColor,
  availabilityBacking,
} from "@/domain/availability-matrix";
import WindyMap from "./WindyMap";
const AvailabilityMap = dynamic(() => import("./AvailabilityMap"), {
  ssr: false,
  loading: () => <div className="analysis-map">Cargando mapa…</div>,
});
const date = (d: string) =>
  new Date(d + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export default function PlanningSpatial({
  items,
  periods,
  active,
  onSelect,
  onDetail,
  windyEnabled,
}: {
  items: PlanningZone[];
  periods: { start: string; days: string[] }[];
  active: string;
  onSelect: (date: string) => void;
  onDetail: (key: string, date: string) => void;
  windyEnabled: boolean;
}) {
  const [layer, setLayer] = useState("availability");
  const current = periods.find((p) => p.start === active) ?? periods[0];
  if (!current) return null;
  const lat = items.reduce((s, z) => s + z.lat, 0) / Math.max(1, items.length),
    lon = items.reduce((s, z) => s + z.lon, 0) / Math.max(1, items.length);
  const embed = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    zoom: "6",
    overlay: layer,
    level: "surface",
    product: "ecmwf",
    metricWind: "km/h",
    metricRain: "mm",
  });
  return (
    <section className="analysis-spatial">
      <div className="analysis-map-panel">
        <div className="analysis-panel-heading">
          <h2>Distribución geográfica</h2>
          <select
            aria-label="Capa del mapa"
            value={layer}
            onChange={(e) => setLayer(e.target.value)}
          >
            <option value="availability">Disponibilidad estimada</option>
            <option value="wind">Viento · Windy</option>
            <option value="rain">Lluvia · Windy</option>
          </select>
        </div>
        {layer === "availability" ? (
          <AvailabilityMap
            items={items}
            dates={current.days}
            onDetail={onDetail}
          />
        ) : (
          <div className="analysis-weather">
            <WindyMap
              enabled={windyEnabled}
              embed={embed.toString()}
              lat={lat}
              lon={lon}
              zoom={6}
              overlay={layer}
              points={items.flatMap((z) =>
                z.equipment.map((e) => ({
                  id: e.id,
                  name: e.name,
                  lat: e.lat ?? z.lat,
                  lon: e.lon ?? z.lon,
                })),
              )}
              onSelect={(id) => {
                const z = items.find((z) =>
                  z.equipment.some((e) => e.id === id),
                );
                if (z) onDetail(z.key, current.start);
              }}
            />
          </div>
        )}
        <div className="analysis-map-legend">
          <span>
            {layer === "availability"
              ? `${date(current.start)}${current.days.length > 1 ? " – " + date(current.days.at(-1)!) : ""}`
              : "Fecha y modelo controlados dentro de Windy"}
          </span>
          {layer === "availability" && (
            <span>
              0% <i /> 100% · gris: sin datos
            </span>
          )}
        </div>
        <p className="studio-footnote">
          {layer === "availability"
            ? "Probabilidad media por día del período. Cada punto es una coordenada; el borde discontinuo indica datos parciales."
            : "El mapa meteorológico no está sincronizado con la fecha seleccionada ni alimenta estos cálculos."}
        </p>
      </div>
      <div className="analysis-matrix-panel">
        <div className="analysis-panel-heading">
          <h2>Disponibilidad por zona</h2>
          <span>
            {periods[0]?.days.length === 1 ? "Días" : "Semanas"} · media diaria
          </span>
        </div>
        <div className="analysis-matrix-scroll">
          <table className="analysis-matrix">
            <thead>
              <tr>
                <th>Zona / fecha</th>
                {periods.map((p) => (
                  <th key={p.start}>
                    <button
                      aria-pressed={current.start === p.start}
                      onClick={() => onSelect(p.start)}
                    >
                      {date(p.start)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {availabilityGroups(items).map(([name, zones]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  {periods.map((p) => {
                    const c = availabilityCell(zones, p.days);
                    return (
                      <td key={p.start}>
                        <button
                          style={availabilityColor(c.probability)}
                          className={
                            current.start === p.start ? "selected" : ""
                          }
                          aria-pressed={current.start === p.start}
                          onClick={() => onSelect(p.start)}
                          title={`${name} · ${date(p.start)} · ${availabilityBacking(c)} · ${c.covered}/${c.total} ubicación-días`}
                          aria-label={`${name}, ${date(p.start)}: ${c.probability === null ? "sin datos" : Math.round(c.probability * 100) + "%"}; ${availabilityBacking(c)}${c.complete ? "" : "; parcial"}`}
                        >
                          {c.probability === null
                            ? "—"
                            : Math.round(c.probability * 100) + "%"}
                          {!c.complete && c.probability !== null ? "*" : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="studio-footnote">
          Seleccionar una columna actualiza el mapa y el detalle territorial. *
          Datos parciales. Las celdas pueden incluir historia; la fuente se
          consulta al pasar el cursor o enfocar cada celda.
        </p>
      </div>
    </section>
  );
}
