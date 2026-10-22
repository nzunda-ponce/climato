"use client";
import { useMemo, useState } from "react";
import type { PlanningZone } from "@/domain/planning-report";
import { workInsights } from "@/domain/work-insights";
import "./work-insights.css";

const n = (value: number | null | undefined, digits = 1) =>
  value == null
    ? "—"
    : value.toLocaleString("es-AR", { maximumFractionDigits: digits });
const date = (value: string) =>
  new Date(value + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export default function WorkInsights({
  items,
  dates,
  stale,
  onDetail,
}: {
  items: PlanningZone[];
  dates: string[];
  stale: boolean;
  onDetail: (key: string, date: string) => void;
}) {
  const [threshold, setThreshold] = useState(70);
  const [selectedDate, setSelectedDate] = useState("");
  const data = useMemo(
    () => workInsights(items, dates, threshold / 100),
    [items, dates, threshold],
  );
  const active =
    data.daily.find((day) => day.date === selectedDate) ??
    data.bestDay ??
    data.daily[0];
  const max = Math.max(1, ...data.ranking.map((row) => row.expected));
  const total = data.curve.at(-1)?.expected;
  const path = data.curve
    .map((point, index) =>
      point.expected === null
        ? ""
        : `${index === 0 ? "M" : "L"}${50 + (index / Math.max(1, dates.length - 1)) * 640},${155 - (point.expected / Math.max(1, total ?? dates.length)) * 125}`,
    )
    .join(" ");
  return (
    <section
      className="insights"
      aria-label="Estadísticas para planificar trabajos"
    >
      <header className="insights-heading">
        <div>
          <span className="analytics-kicker">EXPLORÁ TUS POSIBILIDADES</span>
          <h2>Tu margen para trabajar</h2>
          <p>
            Compará fechas y zonas. Todos los gráficos siguen los filtros del
            panel.
          </p>
        </div>
        <span className="insights-badge">
          {stale
            ? "Informe pendiente de actualizar"
            : "Planificación del período"}
        </span>
      </header>
      <div className="insights-threshold">
        <label htmlFor="work-probability">
          Probabilidad mínima para destacar oportunidades{" "}
          <strong>{threshold}%</strong>
        </label>
        <input
          id="work-probability"
          type="range"
          min="50"
          max="90"
          step="5"
          value={threshold}
          onChange={(event) => setThreshold(Number(event.target.value))}
        />
        <div>
          <span>Más alternativas · 50%</span>
          <span>Mayor exigencia · 90%</span>
        </div>
      </div>
      <div className="insights-numbers" aria-live="polite">
        <article>
          <span>Mejor bloque de 7 días</span>
          <strong>
            {n(data.bestWindow?.expected)} <small>días aptos esperados</small>
          </strong>
          <p>
            {data.bestWindow
              ? `${date(data.bestWindow.start)} – ${date(data.bestWindow.end)}`
              : "Elegí al menos siete fechas con estimaciones"}
          </p>
          {data.bestWindow?.historical && (
            <span className="insights-reference">
              Incluye frecuencia histórica
            </span>
          )}
        </article>
        <article>
          <span>Fechas sobre tu umbral</span>
          <strong>
            {n(data.favorable, 0)} <small>días</small>
          </strong>
          <p>Probabilidad media de al menos {threshold}%</p>
        </article>
        <article>
          <span>Día con más alternativas</span>
          <strong>
            {n(data.bestDay?.qualifying, 0)} <small>ubicaciones</small>
          </strong>
          <p>
            {data.bestDay
              ? `${date(data.bestDay.date)} · cada una con ≥ ${threshold}%`
              : "Sin estimaciones para comparar"}
          </p>
          {data.bestDay?.historical && (
            <span className="insights-reference">
              Incluye frecuencia histórica
            </span>
          )}
        </article>
      </div>
      <div className="insights-grid">
        <section className="insights-card">
          <div className="insights-card-title">
            <span className="analytics-kicker">01 / ELEGIR FECHAS</span>
            <h3>Calendario de oportunidades</h3>
          </div>
          <p>
            Probabilidad media de un día apto. Seleccioná una fecha para
            explorarla.
          </p>
          <p className="insights-note">
            ◌ Las fechas con referencia histórica orientan la planificación; no
            son un pronóstico diario.
          </p>
          <div className="opportunity-calendar">
            {data.daily.map((day) => (
              <button
                key={day.date}
                type="button"
                aria-pressed={active?.date === day.date}
                onClick={() => setSelectedDate(day.date)}
                className={`${day.probability === null ? "unknown" : day.probability >= threshold / 100 ? "favorable" : "moderate"} ${day.historical ? "historical" : ""}`}
                title={`${date(day.date)}: ${day.probability === null ? "sin estimación" : `${n(day.probability * 100, 0)}%`}${day.historical ? " · incluye referencia histórica" : ""}`}
              >
                <span>{date(day.date)}</span>
                <strong>
                  {day.probability === null
                    ? "—"
                    : `${n(day.probability * 100, 0)}%`}
                </strong>
              </button>
            ))}
          </div>
          <div className="insights-calendar-legend">
            <span>
              <i />
              Sobre el umbral
            </span>
            <span>
              <i className="moderate" />
              Bajo el umbral
            </span>
            <span>◌ Incluye histórico</span>
          </div>
          {active && (
            <div className="insights-date-readout" aria-live="polite">
              <div>
                <strong>{date(active.date)}</strong>
                <span>
                  {n(active.qualifying, 0)} ubicaciones con probabilidad ≥{" "}
                  {threshold}%
                </span>
              </div>
              {active.bestKey && (
                <button
                  type="button"
                  onClick={() => onDetail(active.bestKey!, active.date)}
                >
                  Explorar fecha ↗
                </button>
              )}
            </div>
          )}
        </section>
        <section className="insights-card">
          <div className="insights-card-title">
            <span className="analytics-kicker">02 / COMPARAR DESTINOS</span>
            <h3>Dónde hay más margen</h3>
          </div>
          <p>
            Días aptos esperados por ubicación en el período elegido. Cada zona
            se compara en la misma escala.
          </p>
          <div className="insights-ranking">
            {data.ranking.map((row, index) => (
              <button
                type="button"
                key={row.name}
                onClick={() =>
                  onDetail(row.key, data.bestWindow?.start ?? dates[0])
                }
              >
                <span className="insights-rank">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="insights-rank-main">
                  <span>{row.name}</span>
                  <span className="insights-bar">
                    <i style={{ width: `${(row.expected / max) * 100}%` }} />
                  </span>
                </span>
                <strong>
                  {n(row.expected)}
                  <small>días</small>
                </strong>
              </button>
            ))}
          </div>
          {!data.ranking.length && (
            <p>
              No hay estimaciones completas del período para comparar zonas.
            </p>
          )}
          <p className="insights-note">
            El promedio por ubicación evita que una zona parezca mejor solo por
            tener más equipos. No representa trabajos terminados.
          </p>
        </section>
      </div>
      <section className="insights-card insights-accumulation">
        <div className="insights-card-title">
          <span className="analytics-kicker">03 / DIMENSIONAR EL PERÍODO</span>
          <h3>Cómo se acumulan las oportunidades</h3>
        </div>
        <div className="insights-curve-heading">
          <p>
            Suma progresiva de las probabilidades diarias, en días aptos
            esperados por ubicación.
          </p>
          <strong>
            {n(total)} <small>días al cierre</small>
          </strong>
        </div>
        <svg
          viewBox="0 0 720 185"
          role="img"
          aria-label="Días aptos esperados acumulados por ubicación"
        >
          <defs>
            <linearGradient id="work-insight-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#138a7b" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#138a7b" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1="50"
                x2="690"
                y1={155 - fraction * 125}
                y2={155 - fraction * 125}
                stroke="#dce5df"
                strokeDasharray="3 5"
              />
              <text x="40" y={160 - fraction * 125} textAnchor="end">
                {n(fraction * Math.max(1, total ?? dates.length), 0)}
              </text>
            </g>
          ))}
          {!data.incomplete && path && (
            <path
              d={`${path} L690,155 L50,155 Z`}
              fill="url(#work-insight-fill)"
            />
          )}
          <path
            d={path}
            fill="none"
            stroke="#087f77"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <text x="50" y="180">
            {dates[0] ? date(dates[0]) : ""}
          </text>
          <text x="690" y="180" textAnchor="end">
            {dates.at(-1) ? date(dates.at(-1)!) : ""}
          </text>
        </svg>
        <p className="insights-note">
          Una subida más rápida indica más días aptos esperados. La curva
          expresa una expectativa, no una garantía ni días consecutivos. Las
          fechas con histórico muestran frecuencia climática; no anticipan el
          tiempo de una fecha concreta.
        </p>
      </section>
      {data.incomplete && (
        <p className="insights-note" role="status">
          Algunas estimaciones no están disponibles. Se muestran como “—” y se
          omiten las comparaciones incompletas, sin reemplazarlas por cero.
        </p>
      )}
    </section>
  );
}
