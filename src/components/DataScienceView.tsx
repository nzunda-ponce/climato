"use client";
import { useMemo, useState } from "react";
import type { PlanningReport, PlanningZone } from "@/domain/planning-report";
import {
  availabilityGroups,
  availabilityCell,
  availabilityBacking,
  availabilityColor,
} from "@/domain/availability-matrix";
import { scienceSummary } from "@/domain/science-summary";
import "./science.css";
const number = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined
    ? "Sin validación suficiente"
    : n.toLocaleString("es-AR", { maximumFractionDigits: digits });
const date = (d: string) =>
  new Date(d + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export default function DataScienceView({
  report,
  zones,
}: {
  report: PlanningReport | null;
  zones: PlanningZone[];
}) {
  const [region, setRegion] = useState("");
  const groups = useMemo(() => availabilityGroups(zones), [zones]);
  const selected = groups.find(([name]) => name === region)?.[1] ?? zones;
  const dates = report?.zones[0]?.outlook.map((d) => d.date) ?? [];
  const summary = useMemo(
    () => scienceSummary(selected, dates),
    [selected, report],
  );
  if (!report)
    return (
      <section className="planning-empty" role="status">
        Consultando la publicación científica…
      </section>
    );
  if (!zones.length)
    return (
      <section className="planning-empty">
        Seleccioná zonas en el apartado Zonas para analizar la campaña.
      </section>
    );
  const weeks = report.zones[0]?.weekly ?? [];
  const maxDays = Math.max(1, ...summary.annual.map((a) => a.days));
  return (
    <div className="science-view">
      <section className="science-hero">
        <div>
          <p className="planning-eyebrow">
            CIENCIA DE DATOS · CAMPAÑA {report.deadline.slice(0, 4)}
          </p>
          <h2>Qué disponibilidad estimamos hasta fin de año</h2>
          <p>
            {date(report.start)}–{date(report.deadline)} · resultados por
            ubicación, agrupados por la segunda letra del equipo.
          </p>
        </div>
        <label>
          Zona del análisis
          <select
            aria-label="Zona del análisis científico"
            value={groups.some(([name]) => name === region) ? region : ""}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="">Todas las zonas seleccionadas</option>
            {groups.map(([name]) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      </section>
      <div className="science-stats">
        <article>
          <span>Días aptos estimados hasta {date(report.deadline)}</span>
          <strong>
            {summary.expected.expected === null
              ? "Sin cobertura"
              : number(summary.expected.expected)}
          </strong>
          <p>
            promedio por ubicación · estimación integrada de pronósticos,
            proyecciones e historia.{" "}
            {summary.expected.complete
              ? "Período con datos completos."
              : "Cobertura parcial; no se extrapolan fechas faltantes."}
          </p>
        </article>
        <article>
          <span>Ventanas consecutivas · referencia histórica</span>
          <strong>
            {summary.windows
              ? `${number(summary.windows.low)}–${number(summary.windows.high)}`
              : "Muestra insuficiente"}
          </strong>
          <p>
            ventanas por ubicación en el 80% central de los años comparables.
            Una ventana reúne días aptos consecutivos; no confirma fechas
            futuras.
          </p>
        </article>
        <article>
          <span>Racha más larga · referencia histórica</span>
          <strong>
            {summary.longestRun
              ? `${number(summary.longestRun.low)}–${number(summary.longestRun.high)} días`
              : "Muestra insuficiente"}
          </strong>
          <p>
            promedio de la racha máxima por ubicación en esos escenarios
            históricos. No es una racha simultánea garantizada en toda la zona.
          </p>
        </article>
      </div>
      <p className="science-notice">
        La estimación integrada es un valor esperado, no un cupo de trabajos ni
        un calendario confirmado. Los rangos históricos describen años
        anteriores; no son intervalos validados del resultado integrado. El
        acceso, los traslados y el personal se planifican por separado.
      </p>
      {summary.referenceLocations < summary.locations && (
        <p className="planning-alert">
          Referencia histórica disponible en {summary.referenceLocations}/
          {summary.locations} ubicaciones. Los rangos no representan las
          ubicaciones sin muestra suficiente.
        </p>
      )}
      <section className="science-panel">
        <h2>Resultado final por zona</h2>
        <p>
          BE1187 y BE4577 pertenecen a <strong>Zona E</strong>. No se usa la
          carpeta geográfica del mapa para clasificar los equipos.
        </p>
        <div className="planning-table-scroll">
          <table className="science-results">
            <thead>
              <tr>
                <th>Zona</th>
                <th>Equipos / ubicaciones</th>
                <th>Días estimados integrados</th>
                <th>Ventanas históricas · 80% central</th>
                <th>Racha máxima histórica · 80% central</th>
                <th>Cobertura integrada</th>
              </tr>
            </thead>
            <tbody>
              {(region ? groups.filter(([n]) => n === region) : groups).map(
                ([name, items]) => {
                  const s = scienceSummary(items, dates);
                  return (
                    <tr key={name}>
                      <th>{name}</th>
                      <td>
                        {items.reduce((n, z) => n + z.pending, 0)} /{" "}
                        {s.locations}
                      </td>
                      <td>
                        <strong>
                          {s.expected.expected === null
                            ? "Sin cobertura"
                            : number(s.expected.expected)}{" "}
                          días / ubicación
                        </strong>
                      </td>
                      <td>
                        {s.windows
                          ? `${number(s.windows.low)}–${number(s.windows.high)}`
                          : "Muestra insuficiente"}
                        <small>
                          {s.annual.length} años comunes ·{" "}
                          {s.referenceLocations}/{s.locations} ubicaciones
                        </small>
                      </td>
                      <td>
                        {s.longestRun
                          ? `${number(s.longestRun.low)}–${number(s.longestRun.high)} días`
                          : "Muestra insuficiente"}
                      </td>
                      <td>
                        {s.expected.covered}/{s.expected.total} ubicación-fechas
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="science-panel">
        <h2>Cómo se distribuyen los días hasta diciembre</h2>
        <p>
          Una estimación integrada por semana y ubicación. Las etiquetas indican
          el respaldo disponible; la historia no se presenta como pronóstico de
          una fecha exacta.
        </p>
        <div className="planning-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Zona</th>
                {weeks.map((w) => (
                  <th key={w.start}>
                    {date(w.start)}–{date(w.end)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(region ? groups.filter(([n]) => n === region) : groups).map(
                ([name, items]) => (
                  <tr key={name}>
                    <th>{name}</th>
                    {weeks.map((w) => {
                      const cell = availabilityCell(
                        items,
                        dates.filter((d) => d >= w.start && d <= w.end),
                      );
                      return (
                        <td
                          key={w.start}
                          style={availabilityColor(cell.probability)}
                        >
                          <strong>
                            {cell.expected === null
                              ? "Sin datos"
                              : `${number(cell.expected)} días`}
                          </strong>
                          <small style={{ color: "inherit" }}>
                            {availabilityBacking(cell)}
                            {!cell.complete ? " · parcial" : ""}
                          </small>
                        </td>
                      );
                    })}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="science-panel">
        <h2>Años históricos comparables</h2>
        <p>
          Se conserva cada temporada completa y se combina el mismo año entre
          ubicaciones. Así no se trata a días lluviosos consecutivos ni a campos
          vecinos como muestras independientes.
        </p>
        {summary.annual.length >= 10 ? (
          <>
            <div
              className="science-years"
              role="img"
              aria-label={`Días aptos por año histórico. ${summary.annual.length} años comunes; valores en la tabla siguiente.`}
            >
              {summary.annual.map((y) => (
                <div key={y.year}>
                  <span>{y.year}</span>
                  <i style={{ width: `${(y.days / maxDays) * 100}%` }} />
                  <strong>{number(y.days)} días</strong>
                </div>
              ))}
            </div>
            <details>
              <summary>Ver valores y ventanas de cada año</summary>
              <table>
                <thead>
                  <tr>
                    <th>Año</th>
                    <th>Días aptos / ubicación</th>
                    <th>Ventanas / ubicación</th>
                    <th>Racha máxima media</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.annual.map((y) => (
                    <tr key={y.year}>
                      <th>{y.year}</th>
                      <td>{number(y.days)}</td>
                      <td>{number(y.windows)}</td>
                      <td>{number(y.longestRun)} días</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <p>
            Se necesitan al menos diez temporadas completas comunes para mostrar
            una distribución regional. Los datos parciales no se convierten en
            escenarios completos.
          </p>
        )}
        <p className="planning-muted">
          {summary.annual.length} años comunes en {summary.referenceLocations}{" "}
          ubicaciones. El 80% central es el rango entre los percentiles 10 y 90
          de estas temporadas; su cobertura se comprueba por separado.
        </p>
      </section>
      <section className="science-panel">
        <h2>¿Qué error tuvo la estimación histórica?</h2>
        <p>
          Prueba cronológica: se reservan las cinco temporadas más recientes
          para evaluación. La elección del modelo usa sólo años anteriores a esa
          reserva. Cada año se estima con datos que ya habrían estado
          disponibles entonces.
        </p>
        <div className="science-stats">
          <article>
            <span>Error medio de días hasta diciembre</span>
            <strong>
              {summary.maeDays === null
                ? "En preparación"
                : `${number(summary.maeDays)} días`}
            </strong>
            <p>
              Error absoluto medio por ubicación, para el mismo período de
              campaña. No valida las proyecciones meteorológicas futuras.
            </p>
          </article>
          <article>
            <span>Error probabilístico · Brier</span>
            <strong>{number(summary.brier, 3)}</strong>
            <p>
              Menor es mejor. Referencia mensual: {number(summary.baseline, 3)}.
            </p>
          </article>
          <article>
            <span>Mejora frente a la referencia mensual</span>
            <strong>
              {summary.skill === null
                ? "Sin evaluación"
                : `${number(summary.skill * 100)}%`}
            </strong>
            <p>
              Un valor negativo significa que el modelo fue peor que la
              referencia. No se ocultan resultados desfavorables.
            </p>
          </article>
        </div>
        <p>
          {summary.verifiedLocations}/{summary.locations} ubicaciones evaluadas
          · {summary.count.toLocaleString("es-AR")} pares diarios. Los casos
          comparten clima y no equivalen a observaciones independientes.
        </p>
        <details>
          <summary>Resultados, muestra y cobertura por ubicación</summary>
          <div className="planning-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Equipo / campo</th>
                  <th>Años disponibles / usados</th>
                  <th>Selección del modelo</th>
                  <th>Brier / referencia</th>
                  <th>Error de días</th>
                  <th>Cobertura del rango histórico 80%</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((z) => (
                  <tr key={z.key}>
                    <th>
                      {z.equipment.map((e) => e.name).join(" / ")}
                      <small>{z.fields.join(" / ")}</small>
                    </th>
                    <td>
                      {z.science
                        ? `${z.science.years.length} / ${z.science.trainingYears.length}`
                        : `${z.sources.historyYears} / pendiente`}
                    </td>
                    <td>
                      {z.science
                        ? `${z.science.model.method === "weekly" ? `Referencia semanal · ${z.science.model.window} años` : z.science.model.method === "monthly" ? "Referencia mensual" : `${z.science.model.window} años · ${z.science.model.prior ? "suavizado" : "frecuencia directa"}`} · ${z.science.selected ? "elegido en prueba previa" : "base sin selección validada"}`
                        : "La próxima publicación calculará el diagnóstico"}
                    </td>
                    <td>
                      {number(z.science?.validation.brier, 3)} /{" "}
                      {number(z.science?.validation.baselineBrier, 3)}
                    </td>
                    <td>{number(z.science?.periodValidation.maeDays)} días</td>
                    <td>
                      {z.science?.periodValidation.rangeCoverage === null ||
                      z.science?.periodValidation.rangeCoverage === undefined
                        ? "Sin muestra"
                        : `${number(z.science.periodValidation.rangeCoverage * 100)}% en ${z.science.periodValidation.seasons} temporadas`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <section className="science-panel">
        <h2>Modelo y datos que se utilizan</h2>
        <ol>
          <li>
            <strong>Próximos días:</strong> se buscan ensayos completos en los
            escenarios meteorológicos de cada coordenada. Se exige cobertura
            suficiente y se da igual peso a las fuentes utilizables.
          </li>
          <li>
            <strong>Mediano plazo:</strong> cuando existen, se incorporan las
            proyecciones subestacionales y estacionales. Su ajuste usa análogos
            de viento y lluvia; no se declara calibración operativa sin
            comprobarla.
          </li>
          <li>
            <strong>Fechas sin pronóstico:</strong> se estima la frecuencia de
            días aptos en esa época y ubicación. Se comparan ventanas de 10, 20,
            30 y 45 años, con o sin suavizado, además de una referencia mensual.
            Si esta referencia obtiene mejor resultado previo, se utiliza como
            modelo. La selección se hace por Brier en años previos, sin mirar
            los cinco años reservados.
          </li>
          <li>
            <strong>Hasta fin de año:</strong> se suman las probabilidades
            diarias para obtener días esperados. Para estudiar rachas y ventanas
            históricas se recorren temporadas enteras, respetando la continuidad
            entre días.
          </li>
        </ol>
        <p>
          El ajuste y la publicación se ejecutan fuera de esta página. Las dos
          tareas diarias completan los históricos pendientes en lotes limitados,
          reutilizando lo ya descargado y respetando las pausas del proveedor.
        </p>
        <p>
          {summary.dailyLabels.toLocaleString("es-AR")} etiquetas diarias
          históricas disponibles en las ubicaciones seleccionadas. Más años
          aportan información para comprobar errores; no se presupone que usar
          siempre los 45 años sea la opción más precisa.
        </p>
        <ul>
          {summary.models.map((m) => (
            <li key={m.name}>
              {m.name}: {m.locations} ubicaciones.
            </li>
          ))}
        </ul>
      </section>
      <section className="science-panel">
        <h2>Qué falta para afirmar mayor confiabilidad</h2>
        <ul>
          <li>
            La validación operativa compara pronósticos guardados antes de cada
            fecha con ERA5. Se consulta en <a href="/#validacion">Validación</a>
            ; esta prueba histórica no la reemplaza.
          </li>
          <li>
            ERA5 es una reconstrucción meteorológica. Para medir el desempeño en
            campo se necesitan registros reales de ensayos, horarios, viento,
            lluvia, acceso y cancelaciones, vinculados a cada equipo y fecha.
          </li>
          <li>
            El desempeño de los análogos con clima reconstruido no valida el
            pronóstico estacional. Se necesitan predicciones estacionales
            archivadas y sus resultados posteriores.
          </li>
          <li>
            Los rangos actuales no son un intervalo validado de la estimación
            integrada hasta diciembre. La cobertura empírica de los rangos
            históricos se muestra aunque no llegue al 80%.
          </li>
        </ul>
      </section>
    </div>
  );
}
