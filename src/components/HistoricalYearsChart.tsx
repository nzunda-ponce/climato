"use client";

import { useMemo, useState } from "react";
import type { PlanningZone } from "@/domain/planning-report";
import { historicalCurves } from "@/domain/historical-curves";

const percent = (value: number | null | undefined) =>
  value == null
    ? "Sin datos"
    : `${(value * 100).toLocaleString("es-AR", { maximumFractionDigits: 0 })}%`;
const dateLabel = (date: string) =>
  new Date(date + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const palette = [
  "#507e92",
  "#a38b60",
  "#6b8b70",
  "#857ba3",
  "#9d7680",
  "#598d8a",
];

export default function HistoricalYearsChart({
  items,
  dates,
}: {
  items: PlanningZone[];
  dates: string[];
}) {
  const data = useMemo(() => historicalCurves(items, dates), [items, dates]);
  const [selectedYear, setSelectedYear] = useState("");
  const [cursor, setCursor] = useState(0);
  const [showData, setShowData] = useState(false);
  const activeIndex = Math.min(cursor, Math.max(0, data.weeks.length - 1));
  const week = data.weeks[activeIndex];
  const highlighted = data.curves.find(
    (curve) => String(curve.year) === selectedYear,
  );
  const left = 40,
    right = 708,
    top = 16,
    bottom = 177;
  const x = (index: number) =>
    data.weeks.length === 1
      ? (left + right) / 2
      : left + (index * (right - left)) / (data.weeks.length - 1);
  const y = (value: number) => bottom - value * (bottom - top);
  const path = (points: { probability: number | null }[]) =>
    points
      .map((point, i) =>
        point.probability === null
          ? ""
          : `${i === 0 || points[i - 1].probability === null ? "M" : "L"}${x(i).toFixed(1)},${y(point.probability).toFixed(1)}`,
      )
      .join(" ");
  const ticks = [
    ...new Set([
      0,
      Math.floor((data.weeks.length - 1) / 3),
      Math.floor((2 * (data.weeks.length - 1)) / 3),
      data.weeks.length - 1,
    ]),
  ];
  const yearCount = data.curves.filter(
    (curve) => curve.points[activeIndex]?.probability != null,
  ).length;
  return (
    <section
      className="analytics-panel historical-years-panel"
      aria-label="Curvas semanales de todos los años históricos usados"
    >
      <div className="analytics-panel-heading">
        <div>
          <span className="analytics-kicker">
            AÑOS QUE RESPALDAN LA REFERENCIA
          </span>
          <h2>La misma semana, año por año</h2>
        </div>
        <span className="evidence-status">
          {data.curves.length} años · {data.locations}/{data.totalLocations}{" "}
          ubicaciones
        </span>
      </div>
      {!week || !data.curves.length ? (
        <p className="historical-empty" role="status">
          Esta publicación no contiene las series históricas por año. Al
          recalcular el informe con los históricos guardados aparecerán aquí. No
          se reconstruyen curvas a partir del promedio mensual.
        </p>
      ) : (
        <>
          <div className="historical-controls">
            <span>Proporción de días aptos · semanas equivalentes</span>
            <label>
              Resaltar año
              <select
                aria-label="Resaltar año histórico"
                value={highlighted ? selectedYear : ""}
                onChange={(event) => setSelectedYear(event.target.value)}
              >
                <option value="">Todos los años</option>
                {data.curves.map((curve) => (
                  <option key={curve.year} value={curve.year}>
                    {curve.year}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="historical-readout" aria-live="polite">
            <span>
              <strong>
                {dateLabel(week.start)} – {dateLabel(week.end)}
              </strong>
              <small>
                {yearCount} años con muestra suficiente en esta semana
              </small>
            </span>
            {highlighted ? (
              <span>
                <strong>
                  {percent(highlighted.points[activeIndex]?.probability)}
                </strong>
                <small>
                  Año {highlighted.year} ·{" "}
                  {highlighted.points[activeIndex]?.locations ?? 0} ubicaciones
                </small>
              </span>
            ) : (
              <span>
                <strong>
                  {percent(data.reference[activeIndex]?.probability)}
                </strong>
                <small>Referencia semanal del modelo</small>
              </span>
            )}
            <span>
              <strong>
                {percent(data.estimate[activeIndex]?.probability)}
              </strong>
              <small>
                Estimación actual · {data.estimate[activeIndex]?.covered}/
                {data.estimate[activeIndex]?.total} ubicación-días
              </small>
            </span>
          </div>
          <svg
            className="historical-years-chart"
            viewBox="0 0 720 211"
            role="img"
            aria-label={`${data.curves.length} curvas históricas semanales, una por año. La línea oscura es la referencia histórica del modelo y la verde la estimación actual. Consultá los datos con el selector inferior.`}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const point = ((event.clientX - rect.left) / rect.width) * 720;
              setCursor(
                Math.max(
                  0,
                  Math.min(
                    data.weeks.length - 1,
                    Math.round(
                      ((point - left) / (right - left)) *
                        (data.weeks.length - 1),
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
                  x2={right}
                  y1={y(value)}
                  y2={y(value)}
                  className="chart-grid"
                />
                <text
                  x={left - 8}
                  y={y(value) + 4}
                  textAnchor="end"
                  className="chart-axis"
                >
                  {value * 100}%
                </text>
              </g>
            ))}
            {data.curves.map((curve, index) => (
              <g
                key={curve.year}
                className="historical-year-line"
                data-year={curve.year}
                opacity={
                  highlighted
                    ? highlighted.year === curve.year
                      ? 1
                      : 0.1
                    : 0.35
                }
              >
                <path
                  d={path(curve.points)}
                  fill="none"
                  stroke={palette[index % palette.length]}
                  strokeWidth={highlighted?.year === curve.year ? 2.5 : 1.1}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>
                    {curve.year}: frecuencia semanal reconstruida con ERA5
                  </title>
                </path>
                {curve.points.map((point, i) =>
                  point.probability !== null &&
                  (data.weeks.length === 1 ||
                    highlighted?.year === curve.year) ? (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(point.probability)}
                      r="2.5"
                      fill={palette[index % palette.length]}
                    />
                  ) : null,
                )}
              </g>
            ))}
            <path
              d={path(data.reference)}
              fill="none"
              stroke="#243b40"
              strokeWidth="2.2"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={path(data.estimate)}
              fill="none"
              stroke="#087f77"
              strokeWidth="2.8"
              vectorEffect="non-scaling-stroke"
            />
            {data.reference.map((point, i) =>
              data.weeks.length === 1 && point.probability !== null ? (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(point.probability)}
                  r="4"
                  fill="#243b40"
                />
              ) : null,
            )}
            {data.estimate.map((point, i) =>
              data.weeks.length === 1 && point.probability !== null ? (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(point.probability)}
                  r="3"
                  fill="#087f77"
                />
              ) : null,
            )}
            <line
              x1={x(activeIndex)}
              x2={x(activeIndex)}
              y1={top}
              y2={bottom}
              stroke="#243b40"
              strokeDasharray="3 3"
              strokeOpacity=".4"
            />
            {ticks
              .filter((i) => i >= 0)
              .map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y="200"
                  textAnchor={
                    i === 0
                      ? "start"
                      : i === data.weeks.length - 1
                        ? "end"
                        : "middle"
                  }
                  className="chart-axis"
                >
                  {dateLabel(data.weeks[i].start)}
                </text>
              ))}
          </svg>
          <input
            type="range"
            className="temporal-scrubber"
            min="0"
            max={data.weeks.length - 1}
            value={activeIndex}
            onChange={(event) => setCursor(Number(event.target.value))}
            aria-label="Consultar semana histórica"
            aria-valuetext={`${dateLabel(week.start)} a ${dateLabel(week.end)}: referencia ${percent(data.reference[activeIndex]?.probability)}, ${yearCount} años disponibles`}
          />
          <div className="analytics-legend historical-legend">
            <span>
              <i className="historical-many" />
              Una curva por año
            </span>
            <span>
              <i className="historical-reference" />
              Referencia semanal del modelo
            </span>
            <span>
              <i style={{ background: "#087f77" }} />
              Estimación actual
            </span>
          </div>
          <div
            className="historical-year-picker"
            role="group"
            aria-label="Años usados para la referencia histórica"
          >
            {data.curves.map((curve) => (
              <button
                key={curve.year}
                aria-pressed={highlighted?.year === curve.year}
                onClick={() =>
                  setSelectedYear((current) =>
                    current === String(curve.year) ? "" : String(curve.year),
                  )
                }
              >
                {curve.year}
              </button>
            ))}
          </div>
          <div className="analytics-chart-footer">
            <p>
              Datos ERA5 reconstruidos, no trabajos realizados. Se comparan las
              mismas fechas del calendario: semanas de lunes a domingo,
              recortadas al 1 oct–31 dic. Cada año requiere al menos 80% de
              datos de la semana; el modelo exige 10 años elegibles. Los huecos
              no se rellenan.
            </p>
            <button
              onClick={() => setShowData((value) => !value)}
              aria-expanded={showData}
            >
              {showData ? "Ocultar años" : "Ver datos por año"} ↗
            </button>
          </div>
          <p className="analytics-footnote historical-method-note">
            La referencia combina las ubicaciones y las ventanas de años
            elegidas por el modelo; puede incluir suavizado. Las curvas de cada
            año muestran frecuencias sin suavizar. En los extremos se muestra la
            semana histórica completa; la estimación actual usa solo fechas del
            filtro.
          </p>
          {showData && (
            <div className="analytics-table-scroll">
              <table>
                <caption>
                  Semana {dateLabel(week.start)} – {dateLabel(week.end)} ·
                  respaldo por año
                </caption>
                <thead>
                  <tr>
                    <th>Año</th>
                    <th>Días aptos / ubicación-días</th>
                    <th>Frecuencia semanal</th>
                    <th>Ubicaciones con datos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.curves.map((curve) => {
                    const point = curve.points[activeIndex];
                    return (
                      <tr key={curve.year}>
                        <th>{curve.year}</th>
                        <td>
                          {point.probability === null
                            ? "Sin muestra suficiente"
                            : `${point.coveredApt ?? "—"} / ${point.covered}`}
                        </td>
                        <td>{percent(point.probability)}</td>
                        <td>
                          {point.locations}/{data.totalLocations}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
