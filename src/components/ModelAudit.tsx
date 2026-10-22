"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlanningReport } from "@/domain/planning-report";
import type { ModelDiagnostics } from "@/ml/model-diagnostics";
import {
  combineDiagnostics,
  type DiagnosticBatch,
  type ProbabilityDiagnostics,
} from "@/domain/ml-diagnostics";
import { readJsonResponse } from "@/domain/http-json";
import "./model-audit.css";
import ModelLesson from "./ModelLesson";
import AuditCharts, { MetricRing } from "./AuditCharts";

type Remote<T> = {
  data: T | null;
  error: string;
  loading: boolean;
  url: string | null;
};
function useRemote<T>(url: string | null) {
  const [state, setState] = useState<Remote<T>>({
    data: null,
    error: "",
    loading: Boolean(url),
    url,
  });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, error: "", loading: Boolean(url), url });
    if (url)
      void fetch(url, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          const data = await readJsonResponse<T>(response);
          if (!controller.signal.aborted)
            setState({ data, error: "", loading: false, url });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({ data: null, error: error.message, loading: false, url });
        });
    return () => controller.abort();
  }, [url]);
  return state.url === url
    ? state
    : { data: null, error: "", loading: Boolean(url), url };
}
const n = (value: number | null | undefined, digits = 3) =>
  value == null
    ? "—"
    : value.toLocaleString("es-AR", { maximumFractionDigits: digits });
const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${n(value * 100, 1)}%`;
const stamp = (value: string) =>
  new Date(value).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour12: false,
  });

function Status({ loading, error }: { loading: boolean; error: string }) {
  return loading ? (
    <p role="status">Consultando evidencia…</p>
  ) : error ? (
    <p className="audit-notice" role="alert">
      {error}
    </p>
  ) : null;
}

function Hint({ label, children }: { label: string; children: string }) {
  const id = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 280)),
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 160)),
    });
  };
  return (
    <span
      className="audit-hint"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setPosition(null)}
    >
      <button
        type="button"
        aria-label={`Ayuda: ${label}`}
        aria-describedby={id}
        aria-expanded={Boolean(position)}
        onFocus={(e) => show(e.currentTarget)}
        onClick={(e) => show(e.currentTarget)}
        onBlur={() => setPosition(null)}
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        style={position ?? undefined}
        className={position ? "is-open" : ""}
      >
        {children}
      </span>
    </span>
  );
}

function useGlobalDiagnostics(threshold: number, reload: number) {
  const id = `${threshold}:${reload}`;
  const cache = useRef(new Map<string, DiagnosticBatch>());
  const [state, setState] = useState<{
    id: string;
    data: DiagnosticBatch | null;
    error: string;
    progress: string;
  }>({ id, data: null, error: "", progress: "Preparando resumen global…" });
  useEffect(() => {
    const controller = new AbortController();
    const cached = cache.current.get(id);
    if (cached) {
      setState({ id, data: cached, error: "", progress: "" });
      return () => controller.abort();
    }
    setState({
      id,
      data: null,
      error: "",
      progress: "Preparando resumen global…",
    });
    void (async () => {
      let offset: number | null = 0;
      let combined: DiagnosticBatch | null = null;
      while (offset !== null) {
        const response: Response = await fetch(
          `/api/ml-diagnostics?scope=all&offset=${offset}&threshold=${threshold}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const batch: DiagnosticBatch =
          await readJsonResponse<DiagnosticBatch>(response);
        if (controller.signal.aborted) return;
        if (combined && combined.cohort !== batch.cohort)
          throw new Error(
            "Cambiaron las ubicaciones o criterios durante el cálculo. Actualizá el resumen.",
          );
        combined = combined
          ? {
              ...batch,
              included: combined.included + batch.included,
              excluded: combined.excluded + batch.excluded,
              years: [...new Set([...combined.years, ...batch.years])].sort(
                (a, b) => a - b,
              ),
              weather: {
                model: combineDiagnostics([
                  combined.weather.model,
                  batch.weather.model,
                ]),
                baseline: combineDiagnostics([
                  combined.weather.baseline,
                  batch.weather.baseline,
                ]),
              },
              calendar: {
                model: combineDiagnostics([
                  combined.calendar.model,
                  batch.calendar.model,
                ]),
                baseline: combineDiagnostics([
                  combined.calendar.baseline,
                  batch.calendar.baseline,
                ]),
              },
            }
          : batch;
        setState({
          id,
          data: null,
          error: "",
          progress: `Revisando ${batch.processed} de ${batch.total} ubicaciones…`,
        });
        offset = batch.next;
      }
      if (combined) {
        cache.current.set(id, combined);
        setState({ id, data: combined, error: "", progress: "" });
      }
    })().catch((error) => {
      if (!controller.signal.aborted)
        setState({ id, data: null, error: error.message, progress: "" });
    });
    return () => controller.abort();
  }, [id, threshold]);
  return state.id === id
    ? state
    : { id, data: null, error: "", progress: "Preparando resumen global…" };
}

function Matrix({
  data,
  threshold,
  title,
}: {
  data: Pick<
    ProbabilityDiagnostics,
    | "tp"
    | "fp"
    | "tn"
    | "fn"
    | "count"
    | "accuracy"
    | "precision"
    | "recall"
    | "specificity"
    | "brier"
    | "bins"
  >;
  threshold: number;
  title: string;
}) {
  if (!data.count)
    return (
      <div className="audit-notice">
        <strong>{title}: sin casos verificables.</strong>
        <p>
          No se pueden medir aciertos ni calibración. La ausencia de evidencia
          no equivale a un error de cero.
        </p>
      </div>
    );
  return (
    <article className="audit-matrix-card">
      <div className="audit-results-heading">
        <span className="audit-card-kicker">EVIDENCIA · DATOS REALES</span>
        <h3>{title}</h3>
      </div>
      <dl className="audit-metrics">
        {[
          [
            "Precisión",
            pct(data.precision),
            "De todos los días anunciados aptos, qué porcentaje lo fue. VP / (VP + FP).",
          ],
          [
            "Recall",
            pct(data.recall),
            "De todos los días que fueron aptos, qué porcentaje detectó el modelo. VP / (VP + FN).",
          ],
          [
            "F1",
            pct(
              2 * data.tp + data.fp + data.fn
                ? (2 * data.tp) / (2 * data.tp + data.fp + data.fn)
                : null,
            ),
            "Combina precisión y recall: es alto solo si ambos son altos. 2VP / (2VP + FP + FN).",
          ],
        ].map(([label, value, hint], index) => (
          <div key={label}>
            <dt>
              {label} <Hint label={label}>{hint}</Hint>
            </dt>
            <dd>{value}</dd>
            <MetricRing
              label={label}
              value={
                [
                  data.precision,
                  data.recall,
                  2 * data.tp + data.fp + data.fn
                    ? (2 * data.tp) / (2 * data.tp + data.fp + data.fn)
                    : null,
                ][index]
              }
            />
          </div>
        ))}
      </dl>
      <AuditCharts data={data} />
      <div className="audit-scroll">
        <table className="audit-matrix">
          <caption>
            {n(data.count, 0)} casos · clasificación a {pct(threshold)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Clasificación</th>
              <th scope="col">
                ERA5: apto{" "}
                <Hint label="Apto en ERA5">
                  El clima histórico reconstruido permitió al menos un ensayo
                  completo con los criterios configurados.
                </Hint>
              </th>
              <th scope="col">ERA5: no apto</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Probabilidad ≥ {pct(threshold)}</th>
              <td className="audit-correct">
                <strong>{data.tp}</strong>Verdaderos positivos{" "}
                <Hint label="Verdaderos positivos">
                  Se clasificó apto y el día fue apto según ERA5.
                </Hint>
              </td>
              <td className="audit-wrong">
                <strong>{data.fp}</strong>Falsos positivos{" "}
                <Hint label="Falsos positivos">
                  Se clasificó apto, pero el día no fue apto: falsa alarma.
                </Hint>
              </td>
            </tr>
            <tr>
              <th scope="row">Probabilidad &lt; {pct(threshold)}</th>
              <td className="audit-wrong">
                <strong>{data.fn}</strong>Falsos negativos{" "}
                <Hint label="Falsos negativos">
                  Se clasificó no apto, pero el día fue apto: oportunidad no
                  detectada.
                </Hint>
              </td>
              <td className="audit-correct">
                <strong>{data.tn}</strong>Verdaderos negativos{" "}
                <Hint label="Verdaderos negativos">
                  Se clasificó no apto y el día tampoco fue apto según ERA5.
                </Hint>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4>
        Calibración{" "}
        <Hint label="Calibración">
          Compara las probabilidades anunciadas con lo que ocurrió. Si el modelo
          anuncia 80% para muchos días, aproximadamente 8 de cada 10 deberían
          ser aptos.
        </Hint>
      </h4>
      <CalibrationChart data={data.bins} />
      <details className="audit-calibration-detail">
        <summary>Ver valores por intervalo</summary>
        <div className="audit-scroll">
          <table>
            <thead>
              <tr>
                <th>Probabilidad</th>
                <th>
                  Casos{" "}
                  <Hint label="Casos">
                    Cantidad de pares ubicación y día evaluados en ese
                    intervalo. Ubicaciones cercanas pueden compartir clima.
                  </Hint>
                </th>
                <th>
                  Media predicha{" "}
                  <Hint label="Media predicha">
                    Promedio de las probabilidades del modelo en este intervalo.
                  </Hint>
                </th>
                <th>
                  Frecuencia apta{" "}
                  <Hint label="Frecuencia apta">
                    Porcentaje de casos del intervalo que resultaron aptos según
                    ERA5. Debería acercarse a la media predicha.
                  </Hint>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.bins.map((b) => (
                <tr key={b.lower}>
                  <td>
                    {pct(b.lower)}–{pct(b.upper)}
                  </td>
                  <td>{b.count}</td>
                  <td>{pct(b.predicted)}</td>
                  <td>{pct(b.observed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

function CalibrationChart({ data }: { data: ProbabilityDiagnostics["bins"] }) {
  const id = useId();
  const points = data.filter(
    (b) => b.count && b.predicted !== null && b.observed !== null,
  );
  return (
    <div className="audit-calibration-chart">
      <svg viewBox="0 0 340 230" role="img" aria-labelledby={id}>
        <title id={id}>
          Calibración: probabilidad anunciada frente a frecuencia apta
          observada. Cuanto más cerca de la diagonal, mejor.
        </title>
        {[0, 0.5, 1].map((value) => (
          <g key={value}>
            <line
              x1="48"
              x2="300"
              y1={188 - value * 152}
              y2={188 - value * 152}
              stroke="#e0e7df"
            />
            <text x="38" y={192 - value * 152} textAnchor="end">
              {value * 100}%
            </text>
            <text x={48 + value * 252} y="205" textAnchor="middle">
              {value * 100}%
            </text>
          </g>
        ))}
        <line
          x1="48"
          y1="188"
          x2="300"
          y2="36"
          stroke="#8b9e91"
          strokeDasharray="5 4"
        />
        <line x1="48" y1="36" x2="48" y2="188" stroke="#8b9e91" />
        <line x1="48" y1="188" x2="300" y2="188" stroke="#8b9e91" />
        <text x="48" y="18">
          Días realmente aptos
        </text>
        <text x="174" y="225" textAnchor="middle">
          Probabilidad anunciada
        </text>
        {points.map((b) => (
          <circle
            key={b.lower}
            cx={48 + b.predicted! * 252}
            cy={188 - b.observed! * 152}
            r="5"
            fill="#28664e"
          >
            <title>
              {n(b.count, 0)} casos: predicho {pct(b.predicted)}, aptos{" "}
              {pct(b.observed)}
            </title>
          </circle>
        ))}
      </svg>
      <p>
        <span className="audit-chart-dot" /> Cada punto reúne días con
        probabilidades parecidas.{" "}
        <strong>
          Más cerca de la diagonal = probabilidades más ajustadas a lo ocurrido.
        </strong>
      </p>
    </div>
  );
}

export default function ModelAudit() {
  const [reload, setReload] = useState(0);
  const report = useRemote<PlanningReport>(`/api/planning?audit=${reload}`);
  const [key, setKey] = useState("");
  const model = "weather" as const;
  const threshold = 0.7;
  const [expanded, setExpanded] = useState(false);
  const global = useGlobalDiagnostics(threshold, reload);
  const zones = useMemo(
    () => [
      ...new Map(
        (report.data?.zones ?? []).map((z) => [z.locationKey ?? z.key, z]),
      ).values(),
    ],
    [report.data],
  );
  const location =
    zones.find((z) => (z.locationKey ?? z.key) === key) ?? zones[0];
  const selectedKey = location?.locationKey ?? location?.key;
  const trained =
    location?.machineLearning?.status === "trained"
      ? location.machineLearning
      : null;
  const historical = useRemote<ModelDiagnostics>(
    expanded && selectedKey && trained
      ? `/api/ml-diagnostics?key=${encodeURIComponent(selectedKey)}&threshold=${threshold}&audit=${reload}`
      : null,
  );
  const details = historical.data?.[model];
  const compatible =
    historical.data?.key === selectedKey &&
    historical.data?.trainedAt === trained?.trainedAt &&
    details?.matchesSavedCount &&
    details?.matchesSavedMetrics;
  const reference = "análogos meteorológicos";
  const total = global.data?.[model];
  const testYears =
    global.data?.years ??
    [
      ...new Set(
        zones.flatMap((z) =>
          z.machineLearning?.status === "trained"
            ? z.machineLearning.splits.test
            : [],
        ),
      ),
    ].sort((a, b) => a - b);

  return (
    <main className="model-audit" id="main-content">
      <section className="audit-hero">
        <p className="audit-eyebrow">CÓMO SE CALCULA LA DISPONIBILIDAD</p>
        <h1>Qué hace el modelo y cómo ayuda a planificar los ensayos</h1>
        <p className="audit-model-description">
          El modelo aprende qué condiciones de viento y lluvia estuvieron
          asociadas a días aptos en el histórico. Después, con las condiciones
          de cada escenario meteorológico, estima la probabilidad de poder
          realizar un ensayo. La estimación final combina los pronósticos, los
          modelos seleccionados y la referencia histórica donde hace falta.
        </p>
        <div className="audit-estimate-example">
          <p className="audit-card-kicker">
            CÓMO PASAMOS DE PROBABILIDADES A DÍAS · EJEMPLO ILUSTRATIVO
          </p>
          <div
            className="audit-estimate-sum"
            role="img"
            aria-label="Ejemplo ilustrativo: probabilidades de 80, 60, 40, 70 y 50 por ciento en cinco días suman tres días aptos esperados."
          >
            <div className="audit-example-days">
              {[80, 60, 40, 70, 50].map((probability, index) => (
                <div key={index}>
                  <span>Día {index + 1}</span>
                  <strong>{probability}%</strong>
                  <i style={{ height: `${probability}%` }} aria-hidden="true" />
                </div>
              ))}
            </div>
            <span className="audit-example-equals" aria-hidden="true">
              →
            </span>
            <div className="audit-example-total">
              <strong>3 días</strong>
              <span>aptos esperados en 5 días</span>
            </div>
          </div>
          <p>
            Sumamos las probabilidades: 0,8 + 0,6 + 0,4 + 0,7 + 0,5 = 3. Es una
            expectativa para planificar; no identifica tres fechas seguras.
          </p>
        </div>
        <ModelLesson />
        <div className="audit-learning">
          <div
            className="audit-timebar"
            role="img"
            aria-label="Primero se aprende con años anteriores. Después se evalúa con años reservados."
          >
            <span>
              Aprender y ajustar
              <br />
              <strong>Años anteriores</strong>
            </span>
            <span>
              Medir los resultados
              <br />
              <strong>
                {testYears.length
                  ? `${testYears[0]}–${testYears.at(-1)}`
                  : "Años reservados"}
              </strong>
            </span>
          </div>
          <p className="audit-muted">
            {testYears.length
              ? `${testYears[0]}–${testYears.at(-1)} son los años históricos usados para comprobar el modelo, separados del entrenamiento.`
              : "La evaluación usa años históricos separados del entrenamiento."}{" "}
            No son fechas del pronóstico. La prueba también ayudó a decidir qué
            modelos usar.
          </p>
        </div>
        <button
          className="audit-refresh"
          onClick={() => setReload((v) => v + 1)}
        >
          Actualizar resultados
        </button>
        {global.progress && (
          <p role="status" className="audit-loading">
            <span aria-hidden="true" />
            {global.progress}
          </p>
        )}
        <Status loading={false} error={global.error} />
      </section>
      {total && global.data && (
        <>
          <p className="audit-coverage">
            {global.data.included} de {global.data.total} ubicaciones ·{" "}
            {n(total.model.count, 0)} evaluaciones históricas en total.
            {global.data.excluded > 0
              ? ` ${global.data.excluded} ubicaciones sin diagnóstico compatible, excluidas del total.`
              : ""}
          </p>
          <Matrix
            data={total.model}
            threshold={threshold}
            title="Resultado global"
          />
          <p className="audit-muted">
            Incluye los candidatos ML entrenados, tanto seleccionados como
            rechazados. Cada ubicación-día cuenta una vez; las métricas se
            calculan sumando casos, sin promediar porcentajes por equipo.
          </p>
          <details className="audit-comparison">
            <summary>Comparar el total con la referencia: {reference}</summary>
            <Matrix
              data={total.baseline}
              threshold={threshold}
              title={`Referencia global: ${reference}`}
            />
          </details>
        </>
      )}
      <details
        className="audit-section audit-breakdown"
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>Desglosar por ubicación</summary>
        {expanded && (
          <>
            <label>
              Ubicación
              <select
                value={selectedKey ?? ""}
                disabled={!zones.length}
                onChange={(e) => setKey(e.target.value)}
              >
                {zones.map((z) => (
                  <option
                    key={z.locationKey ?? z.key}
                    value={z.locationKey ?? z.key}
                  >
                    {z.name} · {z.equipment.map((e) => e.name).join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <Status
              loading={report.loading || historical.loading}
              error={report.error || historical.error}
            />
            {location && !trained && (
              <p>No hay modelo entrenado compatible para esta ubicación.</p>
            )}
            {details && !compatible && (
              <p role="alert">
                Los datos no coinciden con la corrida publicada. Actualizá la
                consulta.
              </p>
            )}
            {details && compatible && (
              <>
                <Matrix
                  data={details.model}
                  threshold={threshold}
                  title={`Detalle: ${location?.name}`}
                />
                <p className="audit-muted">
                  {trained?.[model].accepted
                    ? "ML seleccionado"
                    : `Se conserva la referencia de ${reference}`}
                  . {trained && `Entrenado ${stamp(trained.trainedAt)}.`}
                </p>
              </>
            )}
          </>
        )}
      </details>
      <p className="audit-notice">
        La prueba usa meteorología conocida del día. Evalúa aptitud histórica;
        no demuestra el acierto de un pronóstico futuro ni resultados de campo.
      </p>
    </main>
  );
}
