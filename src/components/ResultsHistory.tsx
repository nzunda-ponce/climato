"use client";

import { useId, useMemo, useState } from "react";
import type { PlanningZone } from "@/domain/planning-report";
import { historyComparison } from "@/domain/history-comparison";
import { smoothPath } from "@/domain/chart-path";
import HistoricalYearsChart from "./HistoricalYearsChart";

const number = (v: number | null | undefined) =>
  v == null
    ? "Sin datos"
    : v.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const label = (date: string) =>
  new Date(date + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export default function ResultsHistory({
  items,
  dates,
}: {
  items: PlanningZone[];
  dates: string[];
}) {
  const data = useMemo(() => historyComparison(items, dates), [items, dates]);
  const [year, setYear] = useState("");
  const [cursor, setCursor] = useState(0);
  const id = useId();
  const current = Math.min(cursor, Math.max(0, dates.length - 1));
  const selected = data.curves.find((curve) => String(curve.year) === year);
  const left = 46,
    right = 870,
    top = 22,
    bottom = 225;
  const x = (index: number) =>
    left +
    (dates.length > 1 ? index / (dates.length - 1) : 0.5) * (right - left);
  const y = (value: number) =>
    bottom - (value / Math.max(1, dates.length)) * (bottom - top);
  const path = (values: (number | null)[]) =>
    smoothPath(
      values.map((value, index) =>
        value === null ? null : { x: x(index), y: y(value) },
      ),
    );
  const valid = data.curves.filter((curve) => curve.locations > 0);
  if (!dates.length) return null;
  return (
    <div className="results-history">
      <HistoricalYearsChart items={items} dates={dates} />
      <section className="results-chart-card" aria-labelledby={id}>
        <div className="results-chart-heading">
          <div>
            <span className="results-kicker">
              MISMAS FECHAS · TODAS LAS TEMPORADAS
            </span>
            <h2 id={id}>Días aptos acumulados frente a la historia</h2>
          </div>
          <label>
            Resaltar temporada
            <select
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              <option value="">Todas las temporadas</option>
              {data.curves.map((curve) => (
                <option key={curve.year} value={curve.year}>
                  {curve.year}
                  {!curve.locations ? " · sin período completo" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="results-line-reading">
          <div>
            <span>Hasta el {label(dates[current])}</span>
            <strong>
              {number(data.cumulative[current])}
              <small> días estimados</small>
            </strong>
          </div>
          <div>
            <span>Promedio de históricos completos</span>
            <strong>
              {number(data.referenceCumulative[current])}
              <small> días aptos</small>
            </strong>
          </div>
          {selected && (
            <div>
              <span>
                Temporada {selected.year} · {selected.locations} ubicaciones
              </span>
              <strong>
                {number(selected.cumulative[current])}
                <small> días aptos</small>
              </strong>
            </div>
          )}
        </div>
        {!valid.length && (
          <p className="results-note">
            No hay temporadas con datos completos para todo el período
            seleccionado. Las series faltantes no se extrapolan.
          </p>
        )}
        <div className="results-line-scroll">
          <svg
            className="results-line-chart"
            viewBox="0 0 900 264"
            role="img"
            aria-label={`Acumulado de días aptos: ${valid.length} series históricas completas y estimación actual. La escala llega a ${dates.length} días.`}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setCursor(
                Math.max(
                  0,
                  Math.min(
                    dates.length - 1,
                    Math.round(
                      ((((event.clientX - rect.left) / rect.width) * 900 -
                        left) /
                        (right - left)) *
                        (dates.length - 1),
                    ),
                  ),
                ),
              );
            }}
          >
            <defs>
              <filter id={`${id}-glow`}>
                <feGaussianBlur stdDeviation="2.5" />
              </filter>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(t * dates.length)}
                  y2={y(t * dates.length)}
                  className="results-grid-line"
                />
                <text
                  x={left - 10}
                  y={y(t * dates.length) + 4}
                  textAnchor="end"
                >
                  {number(t * dates.length)}
                </text>
              </g>
            ))}
            {data.curves.map((curve, index) => (
              <path
                key={curve.year}
                d={path(curve.cumulative)}
                fill="none"
                stroke={`hsl(${195 + index * 3.1} 55% 60%)`}
                strokeOpacity={
                  selected ? (selected.year === curve.year ? 1 : 0.08) : 0.28
                }
                strokeWidth={selected?.year === curve.year ? 2.4 : 1.1}
                vectorEffect="non-scaling-stroke"
              >
                <title>
                  {curve.year}: {curve.locations} ubicaciones con datos
                  completos
                </title>
              </path>
            ))}
            <path
              d={path(data.referenceCumulative)}
              fill="none"
              stroke="#8090a4"
              strokeWidth="2"
              strokeDasharray="5 5"
            />
            <path
              d={path(data.cumulative)}
              fill="none"
              stroke="#007aff"
              strokeWidth="6"
              opacity=".2"
              filter={`url(#${id}-glow)`}
            />
            <path
              d={path(data.cumulative)}
              fill="none"
              stroke="#007aff"
              strokeWidth="2.8"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={x(current)}
              x2={x(current)}
              y1={top}
              y2={bottom}
              stroke="#007aff"
              strokeOpacity=".25"
              strokeDasharray="3 4"
            />
            {data.cumulative[current] !== null && (
              <circle
                cx={x(current)}
                cy={y(data.cumulative[current])}
                r="4.5"
                fill="#007aff"
                stroke="white"
                strokeWidth="2"
              />
            )}
            {[
              ...new Set([
                0,
                Math.floor((dates.length - 1) / 3),
                Math.floor(((dates.length - 1) * 2) / 3),
                dates.length - 1,
              ]),
            ].map((index) => (
              <text
                key={index}
                x={x(index)}
                y="251"
                textAnchor={
                  index === 0
                    ? "start"
                    : index === dates.length - 1
                      ? "end"
                      : "middle"
                }
              >
                {label(dates[index])}
              </text>
            ))}
          </svg>
        </div>
        <input
          className="results-chart-scrubber"
          type="range"
          min="0"
          max={Math.max(0, dates.length - 1)}
          value={current}
          onChange={(event) => setCursor(Number(event.target.value))}
          aria-label="Consultar fecha del acumulado"
          aria-valuetext={`${label(dates[current])}: ${number(data.cumulative[current])} días estimados`}
        />
        <div className="results-chart-legend">
          <span>
            <i className="current" />
            Estimación actual
          </span>
          <span>
            <i className="history" />
            {valid.length} temporadas históricas
          </span>
          <span>
            <i className="reference" />
            Promedio histórico
          </span>
        </div>
        <p className="results-note">
          Promedio por coordenada, contando cada ubicación una vez. Cada curva
          histórica conserva las mismas ubicaciones durante todo el período; se
          excluyen períodos incompletos. El acumulado actual se detiene si
          faltan datos. Las curvas se redondean visualmente sin cambiar sus
          valores.
        </p>
      </section>
    </div>
  );
}
