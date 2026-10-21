"use client";

import { type ReactNode, useMemo, useState } from "react";
import type { PlanningReport, PlanningZone } from "@/domain/planning-report";
import {
  availabilityCell,
  availabilityGroups,
  availabilityRegion,
} from "@/domain/availability-matrix";
import { addDays } from "@/domain/types";
import { reportDates } from "@/domain/opportunity-report";
import "./work-overview.css";
import WindyMap from "./WindyMap";

const number = (value: number) =>
  value.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const date = (value: string) =>
  new Date(value + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export default function WorkOverview({
  navigation,
  report,
  zones,
  windyEnabled = false,
  error,
  onRetry,
  onDetail,
}: {
  navigation: ReactNode;
  windyEnabled?: boolean;
  report: PlanningReport | null;
  zones: PlanningZone[];
  error: string;
  onRetry: () => void;
  onDetail: (key: string, date: string) => void;
}) {
  const [region, setRegion] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [period, setPeriod] = useState("year");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [overlay, setOverlay] = useState("wind");
  const groups = useMemo(() => availabilityGroups(zones), [zones]);
  const regionZones = zones.filter(
    (z) => !region || availabilityRegion(z) === region,
  );
  const equipment = regionZones
    .flatMap((z) =>
      z.equipment.map((e) => ({
        ...e,
        lat: e.lat ?? z.lat,
        lon: e.lon ?? z.lon,
      })),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
  const selectedEquipment = equipment.find((e) => e.id === equipmentId);
  const filtered = regionZones.filter(
    (z) =>
      !selectedEquipment ||
      z.equipment.some((e) => e.id === selectedEquipment.id),
  );
  const start = report
    ? period === "custom" && from
      ? [from, report.start].sort().at(-1)!
      : report.start
    : "";
  const yearEnd = report ? `${report.start.slice(0, 4)}-12-31` : "";
  const end = report
    ? [
        yearEnd,
        period === "custom"
          ? to || yearEnd
          : period === "year"
            ? yearEnd
            : addDays(start, Number(period) - 1),
      ].sort()[0]
    : "";
  const dates = start && end ? reportDates(start, end) : [];
  const rows = availabilityGroups(filtered).map(([name, items]) => ({
    name,
    items,
    summary: availabilityCell(items, dates),
  }));
  const mapPoints = selectedEquipment ? [selectedEquipment] : filtered;
  const lat = mapPoints.length
    ? mapPoints.reduce((sum, p) => sum + p.lat, 0) / mapPoints.length
    : -36.6;
  const lon = mapPoints.length
    ? mapPoints.reduce((sum, p) => sum + p.lon, 0) / mapPoints.length
    : -60.2;
  const embed = new URLSearchParams({
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    detailLat: lat.toFixed(5),
    detailLon: lon.toFixed(5),
    zoom: selectedEquipment ? "11" : region ? "7" : "5",
    overlay,
    level: "surface",
    product: "ecmwf",
    calendar: "now",
    type: "map",
    location: "coordinates",
    marker: selectedEquipment ? "true" : "",
    metricRain: "mm",
    metricWind: "km/h",
    metricTemp: "°C",
  });
  const publishedAt = report?.publication?.at ?? report?.computedAt;
  const stale = report?.publication?.stale;
  return (
    <div className="work-overview">
      <section className="work-map" aria-label="Mapa de Windy">
        <div className="work-map-toolbar">
          <a
            href={`https://www.windy.com/?${overlay},${lat.toFixed(5)},${lon.toFixed(5)},${selectedEquipment ? 11 : region ? 7 : 5}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir Windy con la selección actual"
          >
            Windy ↗
          </a>
          <label>
            Capa
            <select
              aria-label="Capa"
              value={overlay}
              onChange={(e) => setOverlay(e.target.value)}
            >
              <option value="wind">Viento</option>
              <option value="rain">Lluvia</option>
            </select>
          </label>
        </div>
        <WindyMap
          enabled={windyEnabled}
          embed={embed.toString()}
          lat={lat}
          lon={lon}
          zoom={selectedEquipment ? 11 : region ? 7 : 5}
          overlay={overlay}
          points={selectedEquipment ? [selectedEquipment] : equipment}
          onSelect={setEquipmentId}
        />
        {selectedEquipment && (
          <div className="work-map-location">
            {selectedEquipment.name} · {selectedEquipment.field}
          </div>
        )}
      </section>
      <section className="work-results" aria-label="Días aptos por zona">
        {navigation}
        <header className="work-heading">
          <h1>Días aptos de trabajo</h1>
          {publishedAt && (
            <span>
              Actualizado{" "}
              {new Date(publishedAt).toLocaleString("es-AR", {
                timeZone: "America/Argentina/Buenos_Aires",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </header>
        <div className="work-filters">
          <label>
            Zona
            <select
              aria-label="Zona"
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                setEquipmentId("");
              }}
            >
              <option value="">Todas</option>
              {groups.map(([name]) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Período
            <select
              aria-label="Período"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="7">Próximos 7 días</option>
              <option value="14">Próximos 14 días</option>
              <option value="30">Próximos 30 días</option>
              <option value="year">Hasta fin de año</option>
              <option value="custom">Elegir fechas</option>
            </select>
          </label>
          <label className="work-equipment-filter">
            Equipo
            <select
              aria-label="Equipo"
              value={selectedEquipment?.id ?? ""}
              onChange={(e) => setEquipmentId(e.target.value)}
            >
              <option value="">Todos</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.field ? ` · ${e.field}` : ""}
                </option>
              ))}
            </select>
          </label>
          {period === "custom" && (
            <>
              <label>
                Desde
                <input
                  type="date"
                  value={from || report?.start || ""}
                  min={report?.start}
                  max={to || yearEnd}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={to || yearEnd || ""}
                  min={from || report?.start}
                  max={yearEnd}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        {error && (
          <div className="work-notice" role="alert">
            {error} <button onClick={onRetry}>Reintentar</button>
          </div>
        )}
        {stale && (
          <p className="work-notice" role="alert">
            Actualización atrasada. Los días estimados pueden haber cambiado.
          </p>
        )}
        {!report ? (
          <p role="status">
            {error ? "Sin informe disponible." : "Cargando días aptos…"}
          </p>
        ) : !dates.length ? (
          <p role="status">No quedan fechas en el período elegido.</p>
        ) : !rows.length ? (
          <p role="status">No hay equipos pendientes en esta selección.</p>
        ) : (
          <>
            <div className="work-period">
              <strong>
                {date(start)} – {date(end)}
              </strong>
              <span>{dates.length} días</span>
            </div>
            <p className="work-estimate-note">
              Promedio de días aptos estimados por ubicación, no días
              confirmados. Los equipos de una zona comparten días; no se suman
              sus jornadas.
            </p>
            <div className="work-zone-list">
              {rows.map(({ name, items, summary }) => {
                const bestDates = stale
                  ? []
                  : dates
                      .filter((d) => d <= addDays(report.today, 14))
                      .map((d) => {
                        const forecastItems = items.map((z) => ({
                          ...z,
                          outlook: z.outlook.filter(
                            (day) => day.source === "pronóstico",
                          ),
                        }));
                        return {
                          date: d,
                          cell: availabilityCell(forecastItems, [d]),
                        };
                      })
                      .filter(
                        (d) =>
                          d.cell.complete &&
                          d.cell.probability !== null &&
                          d.cell.probability > 0,
                      )
                      .sort((a, b) => b.cell.probability! - a.cell.probability!)
                      .slice(0, 3)
                      .sort((a, b) => a.date.localeCompare(b.date));
                const count = items.reduce(
                  (sum, z) =>
                    sum + (selectedEquipment ? 1 : z.equipment.length),
                  0,
                );
                const historical = (summary.sources["histórico"] ?? 0) > 0;
                return (
                  <details className="work-zone" key={name}>
                    <summary className="work-zone-summary">
                      <div className="work-zone-title">
                        <h2>{name}</h2>
                        <span>
                          {count} {count === 1 ? "equipo" : "equipos"}
                        </span>
                      </div>
                      <div className="work-zone-number">
                        <strong>
                          {summary.expected === null
                            ? "—"
                            : number(summary.expected)}
                        </strong>
                        <span>días aptos estimados</span>
                        <small>
                          {summary.expected === null
                            ? "Sin datos"
                            : !summary.complete
                              ? "Datos parciales"
                              : ""}
                          {historical
                            ? `${!summary.complete ? " · " : ""}Incluye histórico`
                            : ""}
                        </small>
                      </div>
                      <span className="work-zone-toggle" aria-hidden="true">
                        ⌄
                      </span>
                    </summary>
                    <div className="work-zone-body">
                      <MonthlyEstimate items={items} dates={dates} />
                      <progress
                        aria-label={`Días aptos estimados en ${name}`}
                        value={summary.expected ?? 0}
                        max={Math.max(1, dates.length)}
                      />
                      {summary.expected === null ? (
                        <p className="work-missing">
                          Sin datos para este período.
                        </p>
                      ) : (
                        <>
                          {!summary.complete && (
                            <p className="work-missing">
                              Estimación parcial: faltan datos de algunas
                              fechas.
                            </p>
                          )}
                          {historical && (
                            <p className="work-missing">
                              Incluye estimación histórica.
                            </p>
                          )}
                        </>
                      )}
                      {bestDates.length > 0 && (
                        <div className="work-best-dates">
                          <span>Mejores fechas</span>
                          {bestDates.map((d) => (
                            <button
                              key={d.date}
                              onClick={() => onDetail(items[0].key, d.date)}
                            >
                              {date(d.date)}
                            </button>
                          ))}
                        </div>
                      )}
                      <details className="work-equipment">
                        <summary>Ver equipos</summary>
                        <ul>
                          {items
                            .flatMap((z) => z.equipment)
                            .filter(
                              (e) =>
                                !selectedEquipment ||
                                e.id === selectedEquipment.id,
                            )
                            .map((e) => (
                              <li key={e.id}>
                                <button
                                  onClick={() => {
                                    setRegion(name);
                                    setEquipmentId(e.id);
                                  }}
                                >
                                  {e.name}
                                  <span>{e.field}</span>
                                  <small>Ver en Windy ↗</small>
                                </button>
                              </li>
                            ))}
                        </ul>
                      </details>
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MonthlyEstimate({
  items,
  dates,
}: {
  items: PlanningZone[];
  dates: string[];
}) {
  const months = new Map<string, string[]>();
  for (const day of dates) {
    const month = day.slice(0, 7);
    const days = months.get(month) ?? [];
    days.push(day);
    months.set(month, days);
  }
  const rows = [...months].map(([month, days]) => ({
    month,
    days,
    cell: availabilityCell(items, days),
  }));
  const scale = Math.max(1, ...rows.map(({ days }) => days.length));
  return (
    <figure className="work-monthly">
      <figcaption>
        Estimación mensual <span>Días aptos por ubicación</span>
      </figcaption>
      <ul>
        {rows.map(({ month, days, cell }) => (
          <li key={month}>
            <span className="work-month-name">
              {new Date(month + "-01T12:00Z").toLocaleDateString("es-AR", {
                month: "short",
                timeZone: "UTC",
              })}
            </span>
            <span
              className={`work-month-track ${cell.expected === null ? "missing" : ""}`}
              aria-hidden="true"
            >
              {cell.expected !== null && (
                <span style={{ width: `${(100 * cell.expected) / scale}%` }} />
              )}
            </span>
            <span className="work-month-value">
              {cell.expected === null
                ? "Sin datos"
                : `${number(cell.expected)} días`}
              {cell.expected !== null && !cell.complete && (
                <small>Parcial</small>
              )}
            </span>
            <span className="work-month-period">
              {date(days[0])} – {date(days.at(-1)!)}
            </span>
          </li>
        ))}
      </ul>
      <p>
        Solo fechas del período elegido. Las barras comparten escala; los meses
        sin datos no se cuentan como cero.
      </p>
    </figure>
  );
}
