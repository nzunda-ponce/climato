"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { PlanningReport, PlanningZone } from "@/domain/planning-report";
import {
  availabilityCell,
  availabilityColor,
  availabilityGroups,
  type AvailabilityCell,
} from "@/domain/availability-matrix";
const number = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const date = (value: string) =>
  new Date(value + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const weekday = (value: string) =>
  new Date(value + "T12:00Z").toLocaleDateString("es-AR", {
    weekday: "short",
    timeZone: "UTC",
  });
const percent = (v: number | null) =>
  v === null ? "—" : `${Math.round(v * 100)}%`;
const sourceName: Record<string, string> = {
  pronóstico: "Pronóstico meteorológico",
  histórico: "Referencia histórica",
  subestacional: "Proyección subestacional",
  estacional: "Proyección estacional",
};
export default function AvailabilityOverview({
  report,
  zones,
  onZones,
  onDetail,
}: {
  report: PlanningReport | null;
  zones: PlanningZone[];
  onZones: () => void;
  onDetail: (key: string, date: string) => void;
}) {
  const [mode, setMode] = useState<"days" | "weeks">("days");
  const [mapRegion, setMapRegion] = useState("");
  const [overlay, setOverlay] = useState("wind");
  const [active, setActive] = useState<{
    region: string;
    start: string;
  } | null>(null);
  const groups = useMemo(() => availabilityGroups(zones), [zones]);
  const days = zones[0]?.outlook.slice(0, 14).map((d) => d.date) ?? [];
  const periods =
    mode === "days"
      ? days.map((d) => ({ start: d, end: d, dates: [d] }))
      : (zones[0]?.weekly ?? []).map((w) => ({
          start: w.start,
          end: w.end,
          dates: zones[0].outlook
            .filter((d) => d.date >= w.start && d.date <= w.end)
            .map((d) => d.date),
        }));
  const periodDates = periods.flatMap((p) => p.dates);
  const rows = groups.map(([name, items]) => ({
    name,
    items,
    total: availabilityCell(items, periodDates),
    cells: periods.map((p) => availabilityCell(items, p.dates)),
  }));
  const next = availabilityCell(zones, days);
  const remaining = availabilityCell(
    zones,
    zones[0]?.outlook.map((d) => d.date) ?? [],
  );
  const best = days
    .map((d) => ({ date: d, cell: availabilityCell(zones, [d]) }))
    .filter((d) => d.cell.complete)
    .sort((a, b) => b.cell.probability! - a.cell.probability!)[0];
  const mapPoints = groups.find(([name]) => name === mapRegion)?.[1] ?? zones;
  const lat = mapPoints.length
    ? mapPoints.reduce((s, z) => s + z.lat, 0) / mapPoints.length
    : -38.55;
  const lon = mapPoints.length
    ? mapPoints.reduce((s, z) => s + z.lon, 0) / mapPoints.length
    : -58.74;
  const embed = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    zoom: mapRegion ? "8" : "5",
    level: "surface",
    overlay,
    product: "ecmwf",
    menu: "",
    message: "true",
    marker: "true",
    calendar: "now",
    type: "map",
    location: "coordinates",
    metricWind: "km/h",
    metricTemp: "°C",
  });
  const selectedRow = rows.find((r) => r.name === active?.region),
    selectedIndex = periods.findIndex((p) => p.start === active?.start),
    selectedCell = selectedRow?.cells[selectedIndex],
    selectedPeriod = periods[selectedIndex];
  const coverage = (cell: AvailabilityCell) =>
    `${cell.covered}/${cell.total} combinaciones de ubicación y fecha con datos`;
  return (
    <div className="availability-overview">
      <div className="availability-top">
        <section
          className="availability-map"
          aria-label="Mapa meteorológico de Windy"
        >
          <div className="availability-map-header">
            <strong>
              Windy <span>Clima en las zonas de trabajo</span>
            </strong>
            <div>
              <label>
                <span className="availability-sr-only">Zona del mapa</span>
                <select
                  aria-label="Zona del mapa"
                  value={groups.some(([n]) => n === mapRegion) ? mapRegion : ""}
                  onChange={(e) => setMapRegion(e.target.value)}
                >
                  <option value="">Todas las zonas</option>
                  {groups.map(([name]) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="availability-sr-only">Capa de Windy</span>
                <select
                  aria-label="Capa de Windy"
                  value={overlay}
                  onChange={(e) => setOverlay(e.target.value)}
                >
                  <option value="wind">Viento</option>
                  <option value="rain">Lluvia</option>
                </select>
              </label>
            </div>
          </div>
          <iframe
            title="Windy · mapa meteorológico oficial"
            src={`https://embed.windy.com/embed2.html?${embed}`}
            loading="lazy"
            allowFullScreen
          />
          <div className="availability-map-foot">
            <span>
              La fecha y el modelo se eligen dentro de Windy. Sus colores no
              indican días aptos.
            </span>
            <a
              href={`https://www.windy.com/?${overlay === "rain" ? "rain," : ""}${lat.toFixed(3)},${lon.toFixed(3)},6`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir Windy <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </div>
        </section>
        <section
          className="availability-summary"
          aria-label="Resumen de días disponibles"
        >
          <div className="availability-summary-head">
            <span className="planning-eyebrow">DÍAS DISPONIBLES ESTIMADOS</span>
            <button onClick={onZones}>
              Elegir zonas <ArrowUpRight size={12} aria-hidden="true" />
            </button>
          </div>
          <div className="availability-primary-stat">
            <span>Próximos {days.length || 14} días</span>
            <strong>
              {number(next.expected)} <small>días</small>
            </strong>
            <p>
              en promedio por ubicación
              {!next.complete && next.expected !== null
                ? " · cobertura parcial"
                : ""}
            </p>
          </div>
          <div className="availability-secondary-stat">
            <div>
              <span>
                Hasta {report ? date(report.deadline) : "fin de campaña"}
              </span>
              <strong>
                {number(remaining.expected)} <small>días / ubicación</small>
              </strong>
              {remaining.expected !== null && !remaining.complete && (
                <small>Estimación parcial</small>
              )}
            </div>
            <div>
              <span>Selección</span>
              <strong>
                {groups.length} <small>zonas</small>
              </strong>
              <small>
                {zones.length} ubicaciones ·{" "}
                {zones.reduce((s, z) => s + z.pending, 0)} equipos
              </small>
            </div>
          </div>
          <div className="availability-best-day">
            <span>Mayor disponibilidad en los próximos 14 días</span>
            <strong>
              {best
                ? `${date(best.date)} · ${percent(best.cell.probability)}`
                : "Sin cobertura completa para comparar"}
            </strong>
            <small>
              {best
                ? `${Object.keys(best.cell.sources)
                    .map((s) => sourceName[s] ?? s)
                    .join(
                      " + ",
                    )} · promedio por ubicación. No confirma una fecha de trabajo.`
                : "La comparación aparecerá cuando todas las ubicaciones tengan información."}
            </small>
          </div>
          <p className="availability-summary-note">
            Pronósticos y referencia histórica. Cobertura de datos a 14 días:{" "}
            {next.total
              ? `${Math.floor((next.covered / next.total) * 100)}%`
              : "sin datos"}
            . Los días esperados suman probabilidades; no son días confirmados.
          </p>
        </section>
      </div>
      <section
        className="availability-matrix-panel"
        aria-labelledby="availability-heading"
      >
        <div className="availability-matrix-heading">
          <div>
            <h2 id="availability-heading">Disponibilidad por zona</h2>
            <p>
              {mode === "days"
                ? "Próximos 14 días · probabilidad diaria de al menos un ensayo completo"
                : `Hasta ${report ? date(report.deadline) : "fin de campaña"} · días esperados por semana y ubicación`}
            </p>
          </div>
          <div
            className="availability-switch"
            role="group"
            aria-label="Agrupar disponibilidad"
          >
            <button
              aria-pressed={mode === "days"}
              onClick={() => {
                setMode("days");
                setActive(null);
              }}
            >
              Días
            </button>
            <button
              aria-pressed={mode === "weeks"}
              onClick={() => {
                setMode("weeks");
                setActive(null);
              }}
            >
              Semanas
            </button>
          </div>
        </div>
        <div className="availability-legend">
          <div>
            <span>Menor</span>
            <i aria-hidden="true" />
            <span>Mayor disponibilidad</span>
          </div>
          <span>
            <i className="availability-missing-swatch" /> Sin datos
          </span>
          <span>
            <i className="availability-partial-swatch" /> Cobertura parcial
          </span>
        </div>
        {!report ? (
          <div className="availability-empty" role="status">
            Cargando las estimaciones…
          </div>
        ) : !zones.length ? (
          <div className="availability-empty">
            <strong>
              {report.zones.length
                ? "Elegí las zonas que querés analizar"
                : "Importando ubicaciones de los equipos"}
            </strong>
            <p>
              {report.zones.length
                ? "La selección se aplica al resumen y a toda la matriz."
                : "La disponibilidad aparecerá cuando se descarguen datos suficientes."}
            </p>
            <button onClick={onZones}>Ver zonas de trabajo</button>
          </div>
        ) : (
          <>
            <div
              className="availability-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Matriz de disponibilidad por zona; desplazable horizontalmente"
            >
              <table className="availability-table">
                <caption className="availability-sr-only">
                  Disponibilidad estimada: filas por zona y columnas por{" "}
                  {mode === "days" ? "día" : "semana"}. Cada zona promedia sus
                  ubicaciones seleccionadas, sin multiplicar por cantidad de
                  equipos.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Zona de trabajo</th>
                    {periods.map((p) => (
                      <th scope="col" key={p.start}>
                        {date(p.start)}
                        <small>
                          {mode === "days"
                            ? weekday(p.start)
                            : `al ${date(p.end)}`}
                        </small>
                      </th>
                    ))}
                    <th scope="col" className="availability-total">
                      Días estimados<small>del período</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name}>
                      <th scope="row">
                        <button
                          onClick={() =>
                            onDetail(row.items[0].key, periods[0]?.start ?? "")
                          }
                        >
                          {row.name}
                        </button>
                        <small>
                          {row.items.length} ubicaciones ·{" "}
                          {row.items.reduce((s, z) => s + z.pending, 0)} equipos
                        </small>
                      </th>
                      {row.cells.map((cell, i) => {
                        const p = periods[i],
                          label =
                            cell.expected === null
                              ? "Sin datos"
                              : mode === "days"
                                ? percent(cell.probability)
                                : `${number(cell.expected)} d`,
                          description = `${row.name} · ${date(p.start)}${mode === "weeks" ? ` al ${date(p.end)}` : ""}: ${label}. ${coverage(cell)}. ${Object.keys(
                            cell.sources,
                          )
                            .map((s) => sourceName[s] ?? s)
                            .join(
                              " + ",
                            )}${!cell.complete && cell.expected !== null ? ". Estimación parcial." : ""}`;
                        return (
                          <td key={p.start}>
                            <button
                              className={`availability-cell ${cell.expected === null ? "missing" : ""} ${!cell.complete && cell.expected !== null ? "partial" : ""}`}
                              style={availabilityColor(cell.probability)}
                              title={description}
                              aria-label={description}
                              aria-pressed={
                                active?.region === row.name &&
                                active.start === p.start
                              }
                              onClick={() =>
                                setActive((current) =>
                                  current?.region === row.name &&
                                  current.start === p.start
                                    ? null
                                    : { region: row.name, start: p.start },
                                )
                              }
                            >
                              {label}
                              {!cell.complete && cell.expected !== null && (
                                <span
                                  className="availability-partial-mark"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          </td>
                        );
                      })}
                      <td className="availability-total">
                        <strong>{number(row.total.expected)}</strong>
                        <small>
                          {row.total.expected === null
                            ? "Sin datos"
                            : row.total.complete
                              ? "días / ubicación"
                              : "días · parcial"}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedCell && selectedRow && selectedPeriod && (
              <div className="availability-cell-detail" role="status">
                <div>
                  <strong>
                    {selectedRow.name} · {date(selectedPeriod.start)}
                    {mode === "weeks" ? ` al ${date(selectedPeriod.end)}` : ""}
                  </strong>
                  <p>
                    {mode === "days"
                      ? `${percent(selectedCell.probability)} de probabilidad diaria promedio`
                      : `${number(selectedCell.expected)} días esperados por ubicación`}
                    . {coverage(selectedCell)}.
                    {!selectedCell.complete
                      ? " Cobertura incompleta; no se extrapolan los faltantes."
                      : ""}
                  </p>
                  <p>
                    {Object.entries(selectedCell.sources).length
                      ? Object.entries(selectedCell.sources)
                          .map(
                            ([s, n]) =>
                              `${sourceName[s] ?? s}: ${n} ubicación-fechas`,
                          )
                          .join(" · ")
                      : "Todavía no hay evidencia suficiente. Revisá el estado de las descargas en Datos y criterios."}
                  </p>
                </div>
                <button
                  onClick={() =>
                    onDetail(selectedRow.items[0].key, selectedPeriod.start)
                  }
                >
                  Ver detalle por ubicación{" "}
                  <ArrowUpRight size={12} aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="availability-table-note">
              <span>
                Cada fila promedia las coordenadas de los equipos de esa zona.
                Tocá una celda para ver sus fuentes y cobertura.
              </span>
              <button onClick={onZones}>Modificar selección</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
