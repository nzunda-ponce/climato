"use client";

import { type ReactNode, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { PlanningReport, PlanningZone } from "@/domain/planning-report";
import {
  availabilityBacking,
  availabilityCell,
  availabilityColor,
  availabilityGroups,
  availabilityRegion,
} from "@/domain/availability-matrix";
import { reportDates } from "@/domain/opportunity-report";
import { addDays } from "@/domain/types";
import "./work-overview.css";
import "./planning-studio.css";
import "./results-modern.css";

const PlanningSpatial = dynamic(() => import("./PlanningSpatial"));
const HistoricalYearsChart = dynamic(() => import("./HistoricalYearsChart"));
const n = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const date = (v: string) =>
  new Date(v + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export default function WorkOverview({
  navigation,
  windyEnabled = false,
  report,
  zones,
  error,
  onRetry,
  onDetail,
}: {
  navigation: ReactNode;
  report: PlanningReport | null;
  zones: PlanningZone[];
  windyEnabled?: boolean;
  error: string;
  onRetry: () => void;
  onDetail: (key: string, date: string) => void;
}) {
  const [region, setRegion] = useState("");
  const [equipment, setEquipment] = useState("");
  const [activeWeek, setActiveWeek] = useState("");
  const groups = availabilityGroups(zones);
  const regional = zones.filter(
    (z) => !region || availabilityRegion(z) === region,
  );
  const filtered = regional.filter(
    (z) => !equipment || z.equipment.some((e) => e.id === equipment),
  );
  const start = report?.start ?? "";
  const end = start ? `${start.slice(0, 4)}-12-31` : "";
  const dates = start && end ? reportDates(start, end) : [];
  const total = availabilityCell(filtered, dates);
  const weeks = dates
    .filter((_, i) => i % 7 === 0)
    .map((d) => {
      const days = dates.filter((day) => day >= d && day <= addDays(d, 6));
      return { start: d, days, cell: availabilityCell(filtered, days) };
    });
  const chosen = weeks.find((w) => w.start === activeWeek) ?? weeks[0];
  const stale = report?.publication?.stale;
  const updated = report?.publication?.at ?? report?.computedAt;
  return (
    <div className="planning-studio">
      {navigation}
      <div className="studio-body">
        <div className="studio-edition">
          <span>RESULTADOS / CAMPAÑA {start.slice(0, 4) || "—"}</span>
          <span>
            {updated
              ? `Publicado ${new Date(updated).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
              : "Conectando con el informe…"}
          </span>
        </div>
        <header className="studio-heading">
          <h1>Disponibilidad de trabajo</h1>
          <p>Estimación hasta el 31 de diciembre. Promedios por ubicación.</p>
        </header>
        <div className="studio-controls">
          <div className="studio-selectors">
            <label>
              Zona
              <select
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value);
                  setEquipment("");
                }}
              >
                <option value="">Todas las zonas</option>
                {groups.map(([name]) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Equipo
              <select
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
              >
                <option value="">Todos los equipos</option>
                {regional
                  .flatMap((z) => z.equipment)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.field ? ` · ${e.field}` : ""}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </div>
        {error && (
          <p className="studio-notice" role="alert">
            {error} <button onClick={onRetry}>Reintentar</button>
          </p>
        )}
        {stale && (
          <p className="studio-notice" role="alert">
            Publicación atrasada. Estas estimaciones no deben tomarse como un
            pronóstico vigente.
          </p>
        )}
        {report?.publication?.pendingChanges && (
          <p className="studio-notice">
            Hay nuevos datos pendientes de publicar.
          </p>
        )}
        {!report ? (
          <div className="studio-empty" role="status">
            {error
              ? "No se pudo cargar el informe."
              : "Preparando las estimaciones…"}
          </div>
        ) : !filtered.length ? (
          <div className="studio-empty">
            No hay ubicaciones seleccionadas.{" "}
            <a href="#zonas">Elegir equipos →</a>
          </div>
        ) : (
          <>
            <section className="studio-summary" aria-label="Métrica general">
              <div>
                <span className="studio-eyebrow">
                  DEL {date(start).toUpperCase()} AL 31 DE DICIEMBRE
                </span>
                <div className="studio-total">
                  {n(total.expected)}
                  <span>
                    días aptos estimados
                    <br />
                    por ubicación
                  </span>
                </div>
              </div>
              <p>
                Un día apto permite al menos un ensayo completo según tus
                criterios. Es una suma de probabilidades, no días garantizados.
                <small>
                  {total.complete
                    ? "Período completo"
                    : "Estimación parcial: faltan fechas o ubicaciones"}
                  {" · "}
                  {availabilityBacking(total)} · Promedio por coordenada, no
                  capacidad de la flota.
                </small>
              </p>
            </section>
            <HistoricalYearsChart items={filtered} dates={dates} />
            <PlanningSpatial
              items={filtered}
              periods={weeks}
              active={chosen?.start ?? ""}
              onSelect={setActiveWeek}
              onDetail={onDetail}
              windyEnabled={windyEnabled}
            />
            <section className="studio-territory">
              <div className="studio-section-heading">
                <div>
                  <h2>Detalle por zona</h2>
                </div>
                <span>
                  {chosen
                    ? `Semana del ${date(chosen.start)} al ${date(chosen.days.at(-1)!)}`
                    : ""}
                </span>
              </div>
              {availabilityGroups(filtered).map(([name, items]) => {
                const period = chosen?.days ?? [];
                const cell = availabilityCell(items, period);
                return (
                  <details className="studio-zone" key={name}>
                    <summary>
                      <span>
                        <MapPin size={15} />
                        {name}
                      </span>
                      <span className="studio-zone-track">
                        <i
                          style={{
                            width: `${(cell.probability ?? 0) * 100}%`,
                            ...availabilityColor(cell.probability),
                          }}
                        />
                      </span>
                      <strong>{n(cell.expected)} días</strong>
                      <small>
                        {availabilityBacking(cell)}
                        {!cell.complete ? " · Parcial" : ""}
                      </small>
                      <span>＋</span>
                    </summary>
                    <div className="studio-location-list">
                      {items.map((z) => (
                        <button
                          key={z.key}
                          onClick={() => onDetail(z.key, period[0])}
                        >
                          <span>
                            {z.equipment.map((e) => e.name).join(", ")}
                          </span>
                          <span>
                            Ver horarios y evidencia <ArrowUpRight size={14} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </details>
                );
              })}
            </section>
          </>
        )}
        <footer className="studio-footer">
          <span>CLIMATO / USO INTERNO</span>
          <a href="#datos">Criterios y fuentes ↗</a>
          <a
            href="https://www.windy.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Consultar mapa meteorológico ↗
          </a>
        </footer>
      </div>
    </div>
  );
}
