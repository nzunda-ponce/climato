"use client";

import { useMemo, useState } from "react";
import type { PlanningZone, PlanningReport } from "@/domain/planning-report";
import {
  estimateEvidence,
  estimateTimeline,
  estimateSources,
  type EstimateSource,
} from "@/domain/estimate-evidence";

const n = (value: number | null | undefined, digits = 1) =>
  value == null
    ? "—"
    : value.toLocaleString("es-AR", { maximumFractionDigits: digits });
const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${n(value * 100, 0)}%`;
const shortDate = (value: string) =>
  new Date(value + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export const sourceMeta: Record<
  EstimateSource,
  { label: string; color: string; description: string }
> = {
  pronóstico: {
    label: "Corto plazo",
    color: "#087f77",
    description: "Ensembles meteorológicos · fechas próximas",
  },
  subestacional: {
    label: "EC46",
    color: "#4b78b0",
    description: "Proyección subestacional",
  },
  estacional: {
    label: "SEAS5",
    color: "#8980ac",
    description: "Proyección estacional",
  },
  histórico: {
    label: "Histórico",
    color: "#b9813d",
    description: "Frecuencia histórica · referencia ERA5",
  },
};

export function SourceLegend() {
  return (
    <div className="analytics-legend">
      {estimateSources.map((source) => (
        <span key={source}>
          <i style={{ background: sourceMeta[source].color }} />
          {sourceMeta[source].label}
        </span>
      ))}
      <span>
        <i className="legend-missing" />
        Sin datos
      </span>
    </div>
  );
}

export function EstimateStats({
  items,
  dates,
  count,
}: {
  items: PlanningZone[];
  dates: string[];
  count: number;
}) {
  const evidence = useMemo(
    () => estimateEvidence(items, dates),
    [items, dates],
  );
  return (
    <div className="analytics-stats">
      <div>
        <span>Días aptos estimados</span>
        <strong>
          {n(evidence.expected)}
          <small> / ubicación</small>
        </strong>
        <em>Promedio del período</em>
      </div>
      <div>
        <span>Probabilidad diaria media</span>
        <strong>{pct(evidence.probability)}</strong>
        <em>Sobre fechas con datos</em>
      </div>
      <div>
        <span>Cobertura de datos</span>
        <strong>
          {pct(evidence.total ? evidence.covered / evidence.total : null)}
        </strong>
        <em>
          {n(evidence.covered, 0)} de {n(evidence.total, 0)} ubicación-días
        </em>
      </div>
      <div>
        <span>Equipos en análisis</span>
        <strong>{n(count, 0)}</strong>
        <em>{n(evidence.locations, 0)} ubicaciones únicas</em>
      </div>
    </div>
  );
}

export function TemporalEstimate({
  items,
  dates,
  compact = false,
  stale = false,
  onDetail,
}: {
  items: PlanningZone[];
  dates: string[];
  compact?: boolean;
  stale?: boolean;
  onDetail?: (key: string, date: string) => void;
}) {
  const [resolution, setResolution] = useState<1 | 7>(7);
  const [cursor, setCursor] = useState(0);
  const [table, setTable] = useState(false);
  const rows = useMemo(
    () => estimateTimeline(items, dates, resolution),
    [items, dates, resolution],
  );
  const activeIndex = Math.min(cursor, Math.max(0, rows.length - 1));
  const active = rows[activeIndex];
  if (!active) return null;
  const width = 720,
    left = 40,
    right = 12,
    top = 15,
    bottom = 159;
  const x = (i: number) =>
    left +
    (rows.length === 1
      ? (width - left - right) / 2
      : (i * (width - left - right)) / (rows.length - 1));
  const y = (value: number) => bottom - value * (bottom - top);
  const ticks = [
    ...new Set([
      0,
      Math.floor((rows.length - 1) / 3),
      Math.floor((2 * (rows.length - 1)) / 3),
      rows.length - 1,
    ]),
  ];
  const dominant = (row: typeof active) =>
    [...row.sourceBreakdown].sort((a, b) => b.count - a.count)[0];
  const forecastLocation =
    resolution === 1 && active.complete && !stale
      ? items.find((z) =>
          z.outlook.some(
            (d) =>
              d.date === active.start &&
              d.source === "pronóstico" &&
              d.probability !== null,
          ),
        )
      : undefined;
  return (
    <section
      className={`analytics-panel temporal-panel ${compact ? "compact" : ""}`}
      aria-label={
        compact
          ? "Evolución temporal de la zona"
          : "Evolución temporal de las estimaciones"
      }
    >
      <div className="analytics-panel-heading">
        <div>
          <span className="analytics-kicker">
            {compact ? "EVOLUCIÓN DE LA ZONA" : "HORIZONTE DE TRABAJO"}
          </span>
          <h2>Probabilidad de un día apto</h2>
        </div>
        <div
          className="analytics-segment"
          role="group"
          aria-label="Resolución temporal"
        >
          <button
            aria-pressed={resolution === 1}
            onClick={() => {
              setResolution(1);
              setCursor(0);
            }}
          >
            Diaria
          </button>
          <button
            aria-pressed={resolution === 7}
            onClick={() => {
              setResolution(7);
              setCursor(0);
            }}
          >
            Semanal
          </button>
        </div>
      </div>
      <div className="temporal-readout" aria-live="polite">
        <strong>{pct(active.probability)}</strong>
        <span>
          {shortDate(active.start)}
          {active.end !== active.start ? ` – ${shortDate(active.end)}` : ""}
          <small>
            {active.covered
              ? `${active.complete ? "Cobertura completa" : "Cobertura parcial"} · ${n(active.covered, 0)}/${n(active.total, 0)} ubicación-días`
              : "Sin cobertura para esta fecha"}
          </small>
        </span>
        <span
          className="temporal-basis"
          style={{
            color: active.covered
              ? sourceMeta[dominant(active).source].color
              : undefined,
          }}
        >
          {active.covered
            ? active.sourceBreakdown.filter((s) => s.count).length > 1
              ? "Fuentes combinadas"
              : sourceMeta[dominant(active).source].label
            : "Sin datos"}
        </span>
      </div>
      <svg
        className="temporal-chart"
        viewBox="0 0 720 196"
        role="img"
        aria-label="Probabilidad media de día apto, de 0 a 100 por ciento. Usá el control inferior para consultar cada fecha."
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const point = ((event.clientX - rect.left) / rect.width) * width;
          setCursor(
            Math.max(
              0,
              Math.min(
                rows.length - 1,
                Math.round(
                  ((point - left) / (width - left - right)) * (rows.length - 1),
                ),
              ),
            ),
          );
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={width - right}
              y1={y(value)}
              y2={y(value)}
              className="chart-grid"
            />
            <text
              x={left - 9}
              y={y(value) + 4}
              textAnchor="end"
              className="chart-axis"
            >
              {value * 100}%
            </text>
          </g>
        ))}
        {rows.map((row, i) => {
          if (row.probability === null)
            return (
              <rect
                key={row.start}
                x={x(i) - 2}
                y={bottom - 3}
                width={4}
                height={6}
                fill="#c9cfce"
              />
            );
          const next = rows[i + 1];
          const color = sourceMeta[dominant(row).source].color;
          return (
            <g key={row.start}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={y(row.probability)}
                y2={bottom}
                stroke={color}
                strokeOpacity=".07"
                strokeWidth={Math.max(2, (width - left - right) / rows.length)}
              />
              {next?.probability != null && (
                <line
                  x1={x(i)}
                  x2={x(i + 1)}
                  y1={y(row.probability)}
                  y2={y(next.probability)}
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray={
                    dominant(row).source === "histórico" ? "4 3" : undefined
                  }
                />
              )}
              <circle
                cx={x(i)}
                cy={y(row.probability)}
                r={rows.length > 35 ? 1.8 : 3}
                fill={color}
              />
            </g>
          );
        })}
        <line
          x1={x(activeIndex)}
          x2={x(activeIndex)}
          y1={top}
          y2={bottom}
          stroke="#173b40"
          strokeDasharray="3 3"
          strokeOpacity=".45"
        />
        {active.probability !== null && (
          <circle
            cx={x(activeIndex)}
            cy={y(active.probability)}
            r="5"
            fill="white"
            stroke={sourceMeta[dominant(active).source].color}
            strokeWidth="2"
          />
        )}
        {ticks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y="184"
            textAnchor={
              i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"
            }
            className="chart-axis"
          >
            {shortDate(rows[i].start)}
          </text>
        ))}
      </svg>
      <input
        className="temporal-scrubber"
        type="range"
        min="0"
        max={rows.length - 1}
        value={activeIndex}
        onChange={(e) => setCursor(Number(e.target.value))}
        aria-label="Consultar fecha del gráfico"
        aria-valuetext={`${shortDate(active.start)}: ${pct(active.probability)}, ${active.covered} de ${active.total} ubicación-días con datos`}
      />
      <SourceLegend />
      <div className="analytics-chart-footer">
        <p>
          {resolution === 7
            ? "Media diaria por semana de lunes a domingo. "
            : "Promedio de las ubicaciones con datos en cada fecha. "}
          Color: fuente predominante. La línea histórica representa frecuencia,
          no un pronóstico diario.
        </p>
        <button onClick={() => setTable((v) => !v)} aria-expanded={table}>
          {table ? "Ocultar datos" : "Ver datos"}{" "}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      {forecastLocation && onDetail && (
        <button
          className="analytics-detail-link"
          onClick={() => onDetail(forecastLocation.key, active.start)}
        >
          Consultar pronóstico y franjas del {shortDate(active.start)} ↗
        </button>
      )}
      {forecastLocation && (
        <ForecastEvidence zone={forecastLocation} date={active.start} />
      )}
      {table && (
        <div className="analytics-table-scroll">
          <table>
            <caption>Datos usados en la curva temporal</caption>
            <thead>
              <tr>
                <th>Período</th>
                <th>Prob. media</th>
                <th>Días esperados / ubicación</th>
                <th>Cobertura</th>
                <th>Respaldo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.start}>
                  <th>
                    {shortDate(row.start)}
                    {row.start !== row.end ? ` – ${shortDate(row.end)}` : ""}
                  </th>
                  <td>{pct(row.probability)}</td>
                  <td>{n(row.expected)}</td>
                  <td>
                    {row.covered}/{row.total}
                  </td>
                  <td>
                    {row.sourceBreakdown
                      .filter((s) => s.count > 0)
                      .map((s) => sourceMeta[s.source].label)
                      .join(" + ") || "Sin datos"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function EvidencePanel({
  items,
  dates,
}: {
  items: PlanningZone[];
  dates: string[];
}) {
  const evidence = useMemo(
    () => estimateEvidence(items, dates),
    [items, dates],
  );
  return (
    <section className="analytics-panel evidence-panel">
      <div className="analytics-panel-heading">
        <div>
          <span className="analytics-kicker">TRAZABILIDAD</span>
          <h2>De dónde sale la estimación</h2>
        </div>
        <span className="evidence-status">
          {evidence.complete ? "Cobertura completa" : "Cobertura parcial"}
        </span>
      </div>
      <div
        className="evidence-stack"
        role="img"
        aria-label={`${pct(evidence.total ? evidence.covered / evidence.total : null)} de cobertura. Distribución por fuente en el detalle inferior.`}
      >
        {evidence.sourceBreakdown.map((source) =>
          source.count > 0 ? (
            <span
              key={source.source}
              style={{
                width: `${(100 * source.count) / evidence.total}%`,
                background: sourceMeta[source.source].color,
              }}
            />
          ) : null,
        )}
        {evidence.missing > 0 && (
          <span
            className="evidence-missing"
            style={{ width: `${(100 * evidence.missing) / evidence.total}%` }}
          />
        )}
      </div>
      <div className="evidence-source-list">
        {evidence.sourceBreakdown.map((source) => (
          <div key={source.source}>
            <i style={{ background: sourceMeta[source.source].color }} />
            <span>
              <strong>{sourceMeta[source.source].label}</strong>
              <small>{sourceMeta[source.source].description}</small>
            </span>
            <b>
              {n(source.count, 0)}
              <small>ubicación-días</small>
            </b>
            <b>
              {n(source.contribution)}
              <small>días estimados¹</small>
            </b>
          </div>
        ))}
        {evidence.missing > 0 && (
          <div className="evidence-missing-row">
            <i />
            <span>
              <strong>Sin cobertura</strong>
              <small>Fechas sin datos; no se reemplazan por cero</small>
            </span>
            <b>
              {n(evidence.missing, 0)}
              <small>ubicación-días</small>
            </b>
            <b>—</b>
          </div>
        )}
      </div>
      <p className="analytics-footnote">
        ¹ Aporte al promedio por ubicación:{" "}
        {evidence.sourceBreakdown
          .filter((s) => s.count)
          .map((s) => n(s.contribution))
          .join(" + ") || "sin datos"}{" "}
        = {n(evidence.expected)} días. Los valores se muestran redondeados.
        Cobertura indica disponibilidad de datos, no precisión del pronóstico.
      </p>
      <details className="evidence-audit">
        <summary>
          Ver fuentes, actualización y validación por ubicación{" "}
          <span aria-hidden="true">↗</span>
        </summary>
        <div className="analytics-table-scroll">
          <table>
            <caption>Respaldo del informe por ubicación</caption>
            <thead>
              <tr>
                <th>Equipo / ubicación</th>
                <th>Última descarga</th>
                <th>Historia</th>
                <th>Brier interno</th>
              </tr>
            </thead>
            <tbody>
              {items.map((z) => (
                <tr key={z.key}>
                  <th>
                    {z.equipment.map((e) => e.name).join(" / ")}
                    <small>{z.fields.join(" · ")}</small>
                  </th>
                  <td>
                    {[
                      ["Corto plazo", z.sources.ensembleAt],
                      ["Estacional", z.sources.seasonalAt],
                      ["Histórico", z.sources.historyAt],
                    ].map(([label, value]) => (
                      <small key={label}>
                        {label}:{" "}
                        {value
                          ? new Date(value).toLocaleString("es-AR", {
                              timeZone: "America/Argentina/Buenos_Aires",
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Sin descarga"}
                      </small>
                    ))}
                  </td>
                  <td>
                    {z.sources.historyYears
                      ? `${z.sources.historyYears} años`
                      : "Sin historia"}
                  </td>
                  <td>
                    {z.training && z.training.count > 0 ? (
                      <>
                        {n(z.training.brier, 3)}
                        <small>
                          Referencia: {n(z.training.baseline, 3)} ·{" "}
                          {n(z.training.count, 0)} casos
                        </small>
                      </>
                    ) : (
                      "Sin validación disponible"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="analytics-footnote">
          Brier interno contra ERA5: menor es mejor (0–1). Evalúa el modelo
          histórico y no certifica el acierto del pronóstico operativo. Los
          casos de distintas ubicaciones pueden compartir clima; no equivalen a
          observaciones independientes.
        </p>
      </details>
    </section>
  );
}

export function ZoneSparkline({
  items,
  dates,
}: {
  items: PlanningZone[];
  dates: string[];
}) {
  const rows = useMemo(() => estimateTimeline(items, dates, 7), [items, dates]);
  return (
    <svg className="zone-sparkline" viewBox="0 0 112 28" aria-hidden="true">
      {rows.map((row, i) => (
        <rect
          key={row.start}
          x={(i * 112) / rows.length}
          y={row.probability === null ? 24 : 26 - row.probability * 24}
          width={Math.max(1, 112 / rows.length - 3)}
          height={
            row.probability === null ? 2 : Math.max(1, row.probability * 24)
          }
          rx="1"
          fill={
            row.probability === null
              ? "#c9cfce"
              : sourceMeta[
                  [...row.sourceBreakdown].sort((a, b) => b.count - a.count)[0]
                    .source
                ].color
          }
          opacity=".8"
        />
      ))}
    </svg>
  );
}

export function CriteriaStrip({ report }: { report: PlanningReport }) {
  const r = report.rules;
  return (
    <details className="analytics-criteria">
      <summary>
        <span className="analytics-kicker">CRITERIOS DEL ENSAYO</span>
        <span>
          Viento ≤ <b>{r.wind} km/h</b>
        </span>
        <span>
          Duración <b>{r.minHours} h</b>
        </span>
        <span>
          Lluvia ≤ <b>{r.rain} mm</b>
        </span>
        <span className="criteria-more">Ver criterio completo ↗</span>
      </summary>
      <p>
        Ensayo de {r.minHours} horas consecutivas entre las {r.startHour} y{" "}
        {r.endHour} h. Lluvia durante el ensayo ≤ {r.rain} mm y del día anterior
        &lt; {r.rain24Limit} mm. Los días aptos se estiman sumando
        probabilidades por ubicación; varios equipos pueden compartir una misma
        jornada. No confirma acceso al campo ni trabajos ejecutables.
      </p>
    </details>
  );
}

function ForecastEvidence({
  zone,
  date,
}: {
  zone: PlanningZone;
  date: string;
}) {
  const groups = zone.daily.find((day) => day.date === date)?.evidence ?? [];
  if (!groups.length) return null;
  return (
    <details className="forecast-evidence">
      <summary>
        Escenarios meteorológicos del {shortDate(date)}{" "}
        <span aria-hidden="true">↗</span>
      </summary>
      <p>
        Ubicación: {zone.equipment.map((e) => e.name).join(" / ")}. Probabilidad
        de día apto en cada familia; escenarios utilizables / disponibles.
      </p>
      {groups.map((group) => (
        <div key={group.family} className="forecast-family">
          <span>{group.family}</span>
          <span className="forecast-family-track">
            <i style={{ width: `${100 * (group.probability ?? 0)}%` }} />
          </span>
          <b>{pct(group.probability)}</b>
          <small>
            {group.usable}/{group.total}
          </small>
        </div>
      ))}
      <p>
        El acuerdo entre modelos no es una garantía de acierto. La combinación
        operativa exige al menos dos familias con cobertura suficiente; no suma
        escenarios como si fueran observaciones independientes.
      </p>
    </details>
  );
}
