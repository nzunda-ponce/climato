"use client";

import { useId, useState } from "react";
import type { ProbabilityDiagnostics } from "@/domain/ml-diagnostics";

const count = (value: number) =>
  value.toLocaleString("es-AR", { maximumFractionDigits: 0 });
const percent = (value: number) =>
  `${(value * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;

export function MetricRing({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  return (
    <svg
      className="audit-metric-ring"
      viewBox="0 0 84 84"
      role="img"
      aria-label={`${label}: ${value === null ? "sin casos suficientes" : percent(value)}`}
    >
      <circle
        cx="42"
        cy="42"
        r="33"
        fill="none"
        stroke="currentColor"
        strokeOpacity=".1"
        strokeWidth="7"
      />
      {value !== null && (
        <circle
          cx="42"
          cy="42"
          r="33"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          pathLength="100"
          strokeDasharray={`${value * 100} 100`}
          strokeLinecap="round"
          transform="rotate(-90 42 42)"
        />
      )}
    </svg>
  );
}

export default function AuditCharts({
  data,
}: {
  data: Pick<
    ProbabilityDiagnostics,
    "tp" | "tn" | "fp" | "fn" | "count" | "bins"
  >;
}) {
  const id = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const [bin, setBin] = useState<number | null>(null);
  const categories = [
    { label: "Aptos acertados", value: data.tp, color: "#007aff" },
    { label: "No aptos acertados", value: data.tn, color: "#30b98a" },
    { label: "Falsas alarmas", value: data.fp, color: "#ff9f0a" },
    { label: "Aptos no detectados", value: data.fn, color: "#ef5a75" },
  ];
  let offset = 0;
  const maximum = Math.max(1, ...data.bins.map((b) => b.count));
  const activeBin = bin === null ? null : data.bins[bin];
  return (
    <div className="audit-visual-grid">
      <section className="audit-visual-card">
        <p className="audit-card-kicker">DISTRIBUCIÓN DE LOS CASOS EVALUADOS</p>
        <h4>Aciertos y errores del modelo</h4>
        <div className="audit-outcome-chart">
          <svg viewBox="0 0 200 200" role="img" aria-labelledby={id}>
            <title id={id}>
              Distribución de {count(data.count)} casos:{" "}
              {categories
                .map((c) => `${c.label}, ${count(c.value)}`)
                .join("; ")}
              .
            </title>
            {categories.map((category, index) => {
              const share = data.count
                ? (category.value / data.count) * 100
                : 0;
              const start = offset;
              offset += share;
              return (
                <circle
                  key={category.label}
                  cx="100"
                  cy="100"
                  r="76"
                  pathLength="100"
                  fill="none"
                  stroke={category.color}
                  strokeWidth={selected === index ? 22 : 17}
                  strokeDasharray={`${share} ${100 - share}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 100 100)"
                  opacity={selected !== null && selected !== index ? 0.22 : 1}
                />
              );
            })}
            <text
              x="100"
              y="99"
              textAnchor="middle"
              className="audit-donut-number"
            >
              {count(
                selected === null ? data.count : categories[selected].value,
              )}
            </text>
            <text
              x="100"
              y="119"
              textAnchor="middle"
              className="audit-donut-label"
            >
              {selected === null
                ? "casos evaluados"
                : percent(categories[selected].value / data.count)}
            </text>
          </svg>
          <div className="audit-chart-legend">
            {categories.map((category, index) => (
              <button
                key={category.label}
                type="button"
                aria-pressed={selected === index}
                onClick={() => setSelected((v) => (v === index ? null : index))}
              >
                <span style={{ background: category.color }} />
                <span>
                  {category.label}
                  <strong>{count(category.value)}</strong>
                </span>
                <small>{percent(category.value / data.count)}</small>
              </button>
            ))}
          </div>
        </div>
        <p className="audit-chart-note">
          Tocá una categoría para explorar su peso en el total.
        </p>
      </section>
      <section className="audit-visual-card">
        <p className="audit-card-kicker">PROBABILIDADES Y REALIDAD</p>
        <h4>Resultados por probabilidad estimada</h4>
        <div
          className="audit-histogram"
          role="group"
          aria-label="Casos según la probabilidad anunciada"
        >
          {data.bins.map((b, index) => (
            <button
              key={b.lower}
              type="button"
              aria-pressed={bin === index}
              onClick={() => setBin((v) => (v === index ? null : index))}
              aria-label={`${b.lower * 100} a ${b.upper * 100}% de probabilidad: ${count(b.count)} casos; ${b.observed === null ? "sin observaciones" : percent(b.observed) + " fueron aptos"}`}
            >
              <span className="audit-hist-count">{count(b.count)}</span>
              <span className="audit-hist-track">
                <span
                  className="audit-hist-bar"
                  style={{ height: `${(b.count / maximum) * 100}%` }}
                >
                  <span
                    className="audit-hist-no"
                    style={{ height: `${(1 - (b.observed ?? 0)) * 100}%` }}
                  />
                  <span
                    className="audit-hist-yes"
                    style={{ height: `${(b.observed ?? 0) * 100}%` }}
                  />
                </span>
              </span>
              <span className="audit-hist-label">
                {Math.round(b.lower * 100)}–{Math.round(b.upper * 100)}%
              </span>
            </button>
          ))}
        </div>
        <div className="audit-hist-legend">
          <span>
            <i />
            Realmente aptos
          </span>
          <span>
            <i />
            No aptos
          </span>
        </div>
        <p className="audit-chart-note" aria-live="polite">
          {activeBin
            ? `${count(activeBin.count)} casos; ${activeBin.observed === null ? "sin referencia" : percent(activeBin.observed) + " fueron aptos"}.`
            : "Cada barra agrupa días con probabilidades parecidas. Su altura indica cuántos casos hubo."}
        </p>
      </section>
    </div>
  );
}
