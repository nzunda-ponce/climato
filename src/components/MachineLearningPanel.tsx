"use client";
import { useState } from "react";
import type { PlanningZone } from "@/domain/planning-report";
const number = (value: number | null | undefined, digits = 3) =>
  value == null
    ? "—"
    : value.toLocaleString("es-AR", { maximumFractionDigits: digits });
const years = (values: number[]) =>
  values.length
    ? `${values[0]}–${values.at(-1)} · ${values.length} años`
    : "Sin muestra";

export default function MachineLearningPanel({
  items,
}: {
  items: PlanningZone[];
}) {
  const [key, setKey] = useState("");
  const locations = [
    ...new Map(
      items.map((item) => [item.locationKey ?? item.key, item]),
    ).values(),
  ];
  const location = locations.find((item) => item.key === key) ?? locations[0];
  const summary = location?.machineLearning;
  if (!location) return null;
  return (
    <section
      className="analytics-panel ml-panel"
      aria-label="Modelo de machine learning y validación temporal"
    >
      <div className="analytics-panel-heading">
        <div>
          <span className="analytics-kicker">MODELO Y VALIDACIÓN</span>
          <h2>Machine learning · árboles potenciados</h2>
        </div>
        <span className="evidence-status">
          {summary?.status === "trained"
            ? "Modelo entrenado"
            : "Entrenamiento pendiente"}
        </span>
      </div>
      {locations.length > 1 && (
        <label className="ml-location">
          Ubicación del modelo
          <select
            aria-label="Ubicación del modelo ML"
            value={location.key}
            onChange={(event) => setKey(event.target.value)}
          >
            {locations.map((item) => (
              <option key={item.key} value={item.key}>
                {item.equipment.map((e) => e.name).join(" / ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {summary?.status !== "trained" ? (
        <div className="ml-pending">
          <p>
            El entrenamiento se ejecuta fuera de la web con los históricos
            guardados. Requiere al menos 21 años con etiquetas y variables
            meteorológicas suficientes.
          </p>
          <code>node --import tsx scripts/train-ml.ts --limit=1</code>
          <small>
            La referencia actual sigue disponible hasta que haya un modelo
            entrenado y validado para esta ubicación. Años disponibles:{" "}
            {summary?.availableYears ?? 0}.
          </small>
        </div>
      ) : (
        <>
          <div className="ml-selection">
            <span>
              <i className={summary.calendar.accepted ? "ml-active" : ""} />
              {summary.calendar.accepted
                ? "ML climático seleccionado"
                : "Referencia semanal conservada"}
            </span>
            <span>
              <i className={summary.weather.accepted ? "ml-active" : ""} />
              {summary.weather.accepted
                ? "ML meteorológico habilitado para escenarios"
                : "Análogos conservados para escenarios"}
            </span>
          </div>
          {summary.weather.accepted && (
            <p className="analytics-footnote">
              {summary.weatherApplied
                ? "Los escenarios estacionales guardados se procesaron con este modelo ML."
                : "El modelo meteorológico está preparado; faltan escenarios estacionales procesados con esta versión. La estimación visible usa las fuentes disponibles."}
            </p>
          )}
          <div className="ml-temporal-split">
            {(
              [
                ["train", "Entrenamiento"],
                ["tune", "Selección"],
                ["calibration", "Calibración"],
                ["test", "Prueba final"],
              ] as const
            ).map(([part, label]) => (
              <div key={part}>
                <span>{label}</span>
                <strong>{years(summary.splits[part])}</strong>
              </div>
            ))}
          </div>
          <div className="analytics-table-scroll">
            <table>
              <caption>
                Comparación temporal sobre las mismas fechas · Brier menor es
                mejor
              </caption>
              <thead>
                <tr>
                  <th>Estimador</th>
                  <th>Brier ML · prueba</th>
                  <th>Referencia · prueba</th>
                  <th>Casos de prueba</th>
                  <th>Decisión</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["weather", "Meteorología", "Análogos"],
                    ["calendar", "Referencia climática", "Frecuencia semanal"],
                  ] as const
                ).map(([name, label, baseline]) => {
                  const estimator = summary[name];
                  return (
                    <tr key={name}>
                      <th>
                        {label}
                        <small>
                          {estimator.trees} árboles ·{" "}
                          {estimator.features.length} variables + indicadores de
                          faltantes
                        </small>
                      </th>
                      <td>{number(estimator.test.brier)}</td>
                      <td>
                        {number(estimator.test.baselineBrier)}
                        <small>{baseline}</small>
                      </td>
                      <td>{number(estimator.test.count, 0)}</td>
                      <td>
                        {estimator.accepted
                          ? "ML seleccionado"
                          : "Referencia conservada"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details className="ml-feature-detail">
            <summary>Variables y resultados de selección/calibración ↗</summary>
            {(
              [
                ["weather", "Modelo meteorológico"],
                ["calendar", "Modelo climático"],
              ] as const
            ).map(([name, label]) => (
              <div key={name} className="ml-feature-model">
                <h3>{label}</h3>
                <p>
                  Selección: Brier {number(summary[name].tune.brier)} frente a{" "}
                  {number(summary[name].tune.baselineBrier)}. Calibración:{" "}
                  {number(summary[name].calibration.brier)} frente a{" "}
                  {number(summary[name].calibration.baselineBrier)}.
                </p>
                <ul className="ml-feature-list">
                  {summary[name].importance.map((feature) => (
                    <li key={feature.feature}>
                      <span>{feature.feature}</span>
                      <span className="ml-feature-track">
                        <i style={{ width: `${100 * feature.gain}%` }} />
                      </span>
                      <b>{number(feature.gain * 100, 1)}%</b>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="analytics-footnote">
              Importancia por ganancia en los árboles. Las variables
              correlacionadas pueden compartir importancia; no demuestra
              causalidad. Los faltantes usan estadísticas aprendidas solo en
              entrenamiento y conservan un indicador explícito.
            </p>
          </details>
          <p className="analytics-footnote ml-validation-note">
            {summary.label} Las últimas cinco temporadas no entrenan ni calibran
            el modelo: se usan una vez para decidir si supera la referencia. Se
            exige una mejora Brier de al menos 0,002 en esa prueba. Entrenado{" "}
            {new Date(summary.trainedAt).toLocaleDateString("es-AR", {
              timeZone: "America/Argentina/Buenos_Aires",
            })}
            .
          </p>
        </>
      )}
    </section>
  );
}
