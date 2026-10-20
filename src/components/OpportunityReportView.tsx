"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  FileText,
  Printer,
  Search,
} from "lucide-react";
import type {
  OpportunityReport,
  ReportZone,
} from "@/domain/opportunity-report";
import { estimatedDaysText, workDayLabel } from "@/domain/work-windows";
import type { PossibleWindow } from "@/domain/work-windows";
import { addDays } from "@/domain/types";
import AutoSyncStatus from "./AutoSyncStatus";
import PossibleWindows from "./PossibleWindows";
import "./climate.css";
import "./opportunity-report.css";

const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const timeLabel = (date: string | null) =>
  date
    ? new Date(date).toLocaleString("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Argentina/Buenos_Aires",
      })
    : "Todavía no se descargó";
const percent = (n: number | null) =>
  n === null
    ? "Sin datos"
    : n > 0 && n < 0.01
      ? "<1%"
      : `${Math.round(n * 100)}%`;
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function dayReading(day: ReportZone["daily"][number], today: string) {
  if (day.probability === null)
    return {
      label: "Faltan datos",
      action: "Esperar la actualización del pronóstico.",
    };
  if (day.source !== "pronóstico" || day.date > addDays(today, 7))
    return {
      label: "Todavía es orientativo",
      action: "Volver a mirar cuando se acerque la fecha.",
    };
  if (!day.supported)
    return {
      label: "Necesita otra revisión",
      action: "Faltan pronósticos para comparar. No confirma mal tiempo.",
    };
  return {
    label: workDayLabel(day.probability),
    action:
      day.probability >= 0.4
        ? "Consultar el horario del equipo antes de organizar la salida."
        : "Seguir la actualización; por ahora no conviene contar con este día.",
  };
}
function PeriodCard({
  label,
  period,
  selected,
  onSelect,
}: {
  label: string;
  period: ReportZone["remaining"];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`report-period ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span>{label}</span>
      <strong>
        {period.expectedDays === null
          ? "—"
          : `≈ ${estimatedDaysText(period.expectedDays)}`}
      </strong>
      <span>días estimados para trabajar</span>
      <small>
        {period.expectedDays === null
          ? period.total
            ? `Falta el pronóstico de ${period.total - period.covered} días`
            : "Fuera de la campaña"
          : "Las fechas se confirman al acercarse"}
      </small>
    </button>
  );
}
export default function OpportunityReportView() {
  const [report, setReport] = useState<OpportunityReport | null>(null),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [zoneKey, setZoneKey] = useState(""),
    [date, setDate] = useState("");
  const [horizon, setHorizon] = useState<"7" | "14" | "campaign">("7"),
    [windowsOpen, setWindowsOpen] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/report", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw new Error(d.error || "No se pudo actualizar el informe.");
    setReport(d);
    setError("");
  }, []);
  useEffect(() => {
    const refresh = () => {
      void load().catch((e) =>
        setError(e instanceof Error ? e.message : "Error de actualización"),
      );
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const filtered = useMemo(
    () =>
      (report?.zones ?? []).filter((z) =>
        normalize(
          [
            z.name,
            ...z.fields,
            ...z.provinces,
            ...z.equipment.map((e) => e.name),
          ].join(" "),
        ).includes(normalize(search)),
      ),
    [report, search],
  );
  const zone = filtered.find((z) => z.key === zoneKey) ?? filtered[0];
  const period = zone
    ? horizon === "7"
      ? zone.next7
      : horizon === "14"
        ? zone.next14
        : zone.remaining
    : null;
  const selectedDay =
    zone?.daily.find(
      (d) => d.date === date && (horizon !== "7" || d.date <= zone.next7.end),
    ) ??
    zone?.nextOpportunity ??
    zone?.daily[0];
  const rows: PossibleWindow[] =
    zone &&
    selectedDay &&
    selectedDay.probability !== null &&
    selectedDay.probability > 0 &&
    (selectedDay.slots ?? 0) > 0
      ? zone.equipment.map((e) => ({
          id: `${e.id}/${selectedDay.date}`,
          pivotId: e.id,
          equipment: e.name,
          field: e.field,
          date: selectedDay.date,
          expectedWindows: selectedDay.slots!,
          probability: selectedDay.probability! * 100,
          source: selectedDay.source,
        }))
      : [];
  const scenarios =
    horizon === "7"
      ? zone?.next7.scenarios
      : horizon === "14"
        ? zone?.next14.scenarios
        : null;
  return (
    <div className="report-app">
      <header className="report-header">
        <Link className="climate-logo" href="/">
          climato
        </Link>
        <Link className="report-back" href="/">
          <ArrowLeft size={15} /> Volver al mapa
        </Link>
        <button className="report-print" onClick={() => window.print()}>
          <Printer size={16} /> Imprimir informe
        </button>
      </header>
      <main className="report-content">
        <div className="report-intro">
          <div>
            <p className="report-eyebrow">
              <FileText size={15} /> UNIFORMIDADES
            </p>
            <h1>Cuándo podemos trabajar</h1>
            <p>
              Elegí una zona para ver qué días conviene revisar y cuántas
              oportunidades podrían quedar.
            </p>
          </div>
          <div className="report-update">
            <Clock3 size={17} />
            <div>
              <strong>Se actualiza automáticamente</strong>
              <span>
                Con el servidor encendido, incluso si cerrás la pestaña.
              </span>
              <small>
                Última revisión:{" "}
                {report ? timeLabel(report.computedAt) : "Cargando…"} · hora
                argentina
              </small>
            </div>
          </div>
        </div>
        <AutoSyncStatus onReload={load} inline />
        {error && (
          <div className="report-notice error" role="alert">
            {error}{" "}
            <button
              onClick={() => void load().catch((e) => setError(e.message))}
            >
              Reintentar
            </button>
            {report && (
              <p>Los datos visibles corresponden a la revisión anterior.</p>
            )}
          </div>
        )}
        {report && !report.active && (
          <div className="report-notice">
            La campaña cerró el {dateLabel(report.deadline)}. Cambiá el cierre
            en Datos y reglas para planificar nuevas fechas.
          </div>
        )}
        <div className="report-layout">
          <aside className="report-zones">
            <label className="report-search">
              <Search size={17} />
              <input
                aria-label="Buscar zona, campo o equipo"
                placeholder="Zona, campo o equipo…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <p className="report-eyebrow">ELEGÍ UNA ZONA</p>
            <nav aria-label="Elegir zona del informe">
              {filtered.map((z) => (
                <button
                  key={z.key}
                  aria-current={zone?.key === z.key ? "true" : undefined}
                  className={zone?.key === z.key ? "selected" : ""}
                  onClick={() => {
                    setZoneKey(z.key);
                    setDate("");
                    setWindowsOpen(false);
                  }}
                >
                  <strong>{z.name}</strong>
                  <span>{z.pending} equipos pendientes</span>
                  <small>
                    {z.nextOpportunity
                      ? `Revisar ${dateLabel(z.nextOpportunity.date)}`
                      : "Ver qué falta confirmar"}
                  </small>
                </button>
              ))}
            </nav>
            {report && !filtered.length && (
              <p className="report-empty">
                {search
                  ? "No hay zonas que coincidan con la búsqueda."
                  : "Todavía no hay equipos pendientes con ubicación válida. Aparecerán al terminar la carga automática."}
              </p>
            )}
          </aside>
          {zone && period ? (
            <article className="report-zone" key={zone.key}>
              <div className="report-zone-heading">
                <div>
                  <p className="report-eyebrow">PLAN DE TRABAJO</p>
                  <h2>{zone.name}</h2>
                  <p>{zone.fields.join(" · ")}</p>
                  <small>
                    {zone.pending} equipos pendientes ·{" "}
                    {zone.provinces.join(" / ")}
                  </small>
                  <small className="report-source-age">
                    Pronóstico cercano:{" "}
                    {zone.sources.ensembleFresh
                      ? timeLabel(zone.sources.ensembleAt)
                      : "pendiente de actualización"}
                  </small>
                </div>
              </div>
              <section
                className={`report-opportunity ${zone.nextOpportunity ? "has-opportunity" : ""}`}
              >
                <CalendarDays size={24} />
                <div>
                  <span className="report-eyebrow">
                    PRÓXIMA FECHA PARA REVISAR
                  </span>
                  <h3>
                    {zone.nextOpportunity
                      ? dateLabel(zone.nextOpportunity.date)
                      : "Todavía no hay una fecha clara"}
                  </h3>
                  <p>
                    {zone.nextOpportunity
                      ? "Podría servir para trabajar. Consultá el horario de cada equipo y el acceso al campo antes de organizar la salida."
                      : "Mirá el detalle de abajo: puede haber días que sirvan, pero falta confirmar el tiempo o completar las descargas."}
                  </p>
                </div>
              </section>
              <section className="report-periods" aria-label="Elegir período">
                <PeriodCard
                  label="Próximos 7 días"
                  period={zone.next7}
                  selected={horizon === "7"}
                  onSelect={() => setHorizon("7")}
                />
                <PeriodCard
                  label="Próximos 14 días"
                  period={zone.next14}
                  selected={horizon === "14"}
                  onSelect={() => setHorizon("14")}
                />
                <PeriodCard
                  label={`Hasta ${dateLabel(report!.deadline)}`}
                  period={zone.remaining}
                  selected={horizon === "campaign"}
                  onSelect={() => setHorizon("campaign")}
                />
              </section>
              <p className="report-caption">
                Es una cantidad aproximada de días, no de trabajos confirmados.
                Varios equipos pueden aprovechar el mismo día. Hoy se consulta
                por separado porque ya está transcurriendo.
              </p>
              {scenarios && (
                <div className="report-range">
                  <strong>
                    El pronóstico puede variar: entre {scenarios.range[0]} y{" "}
                    {scenarios.range[1]} días aptos.
                  </strong>
                  <span>
                    Volvé a mirar las fechas antes de preparar una salida.
                  </span>
                </div>
              )}
              {horizon === "campaign" && (
                <div className="report-notice">
                  Lo que está lejos sirve para organizar la campaña. Todavía no
                  permite decidir una fecha de salida.
                </div>
              )}
              <section className="report-section">
                <div className="report-section-title">
                  <h3>Qué hacer con cada fecha</h3>
                  <span>Elegí un día para ver qué podría venir después</span>
                </div>
                <div className="report-table-scroll">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Cómo se ve</th>
                        <th>Próximo paso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone.daily
                        .filter(
                          (d) => horizon !== "7" || d.date <= zone.next7.end,
                        )
                        .map((d) => {
                          const reading = dayReading(d, report!.today);
                          return (
                            <tr
                              key={d.date}
                              className={
                                selectedDay?.date === d.date ? "selected" : ""
                              }
                            >
                              <td>
                                <button
                                  aria-label={`Analizar ${dateLabel(d.date)}`}
                                  aria-pressed={selectedDay?.date === d.date}
                                  onClick={() => {
                                    setDate(d.date);
                                    setWindowsOpen(false);
                                  }}
                                >
                                  {dateLabel(d.date)}
                                </button>
                              </td>
                              <td>
                                <span className={`report-badge ${d.status}`}>
                                  {reading.label}
                                </span>
                              </td>
                              <td>{reading.action}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                {!zone.daily.length && (
                  <p className="report-empty">
                    No hay fechas futuras dentro de la campaña.
                  </p>
                )}
              </section>
              {selectedDay && (
                <section className="report-repeat">
                  <div className="report-section-title">
                    <h3>
                      Si trabajamos el {dateLabel(selectedDay.date)}, ¿qué
                      podría venir después?
                    </h3>
                  </div>
                  {selectedDay.following ? (
                    <>
                      <div className="report-repeat-metrics">
                        <div>
                          <strong>
                            ≈{" "}
                            {estimatedDaysText(selectedDay.following.expected)}
                          </strong>
                          <span>
                            otros días que podrían servir hasta el{" "}
                            {dateLabel(selectedDay.followingEnd)}
                          </span>
                        </div>
                      </div>
                      <p>
                        {selectedDay.following.noMoreDays > 0.5
                          ? "Podría ser una oportunidad aislada. Vale la pena revisar el horario con atención."
                          : "Podrían aparecer más días útiles, pero conviene volver a confirmarlos al acercarse."}
                      </p>
                    </>
                  ) : (
                    <p>
                      Todavía no podemos estimar bien qué vendría después de
                      esta fecha. El total de arriba resume lo que sabemos por
                      ahora.
                    </p>
                  )}
                  {!!rows.length && selectedDay.source === "pronóstico" && (
                    <button
                      className="report-primary"
                      onClick={() => setWindowsOpen(true)}
                    >
                      Consultar horarios por equipo ·{" "}
                      {dateLabel(selectedDay.date)}
                    </button>
                  )}
                </section>
              )}
              <details className="report-today">
                <summary>
                  Hoy, {dateLabel(report!.today)} · horarios que todavía podrían
                  aprovecharse
                </summary>
                <p>
                  Son horarios propuestos, no trabajos confirmados. Revisá el
                  viento y el acceso antes de salir.
                </p>
                {zone.todayWindows.length ? (
                  <ul>
                    {zone.todayWindows.map((w) => (
                      <li key={w.id}>
                        <strong>{w.name}</strong> · {w.field} ·{" "}
                        {w.window!.start.slice(11, 16)}–
                        {w.window!.end.slice(11, 16)} · camino{" "}
                        {w.road.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Todavía no tenemos un horario para proponer. Puede faltar un
                    pronóstico reciente; no significa necesariamente que hoy no
                    se pueda trabajar.
                  </p>
                )}
              </details>
              <details className="report-sources" open={horizon === "campaign"}>
                <summary>Ver las próximas semanas</summary>
                <div className="report-table-scroll">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Semana</th>
                        <th>Días estimados</th>
                        <th>Qué falta confirmar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone.weekly
                        .filter((w) => w.start <= period.end)
                        .map((w) => (
                          <tr key={w.start}>
                            <td>
                              {dateLabel(w.start)} — {dateLabel(w.end)}
                            </td>
                            <td>
                              {w.expectedDays === null
                                ? "Sin cálculo completo"
                                : `≈ ${estimatedDaysText(w.expectedDays)} días`}
                            </td>
                            <td>
                              {w.covered < w.total
                                ? `Faltan ${w.total - w.covered} días de pronóstico`
                                : "Volver a mirar las fechas al acercarse"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <details className="report-sources">
                <summary>
                  Ver porcentajes y datos del cálculo (opcional)
                </summary>
                <p>
                  Estos datos explican la estimación. No cambian los requisitos
                  para que el ensayo sea apto.
                </p>
                <p>
                  Zona meteorológica: {zone.key}. Corto plazo consultado:{" "}
                  {timeLabel(zone.sources.ensembleAt)}. Largo plazo:{" "}
                  {timeLabel(zone.sources.seasonalAt)}. Históricos:{" "}
                  {zone.sources.historyYears} años.
                </p>
                <p>
                  Para marcar una fecha como candidata pedimos varios
                  pronósticos para comparar y el umbral guardado en Reglas (
                  {report!.rules.minimumProbability}%). Si faltan fuentes,
                  mostramos «Necesita otra revisión»; eso habla de los datos
                  disponibles, no del mal tiempo.
                </p>
                <ul>
                  {zone.daily.map((d) => (
                    <li key={d.date}>
                      {dateLabel(d.date)}: {percent(d.probability)} de
                      escenarios con un día apto · {d.source} · {d.families}{" "}
                      grupos de modelos y {d.members} escenarios.
                    </li>
                  ))}
                </ul>
                {scenarios && (
                  <p>
                    El rango mostrado contiene el 80% central de los escenarios
                    con días completos. No es una garantía de acierto.
                  </p>
                )}
                {selectedDay?.following && (
                  <p>
                    Después de la fecha elegida: media{" "}
                    {selectedDay.following.expected.toFixed(2)} otros días;{" "}
                    {percent(selectedDay.following.noMoreDays)} de los
                    escenarios compatibles no muestran otro día apto.
                    Conservamos la secuencia de cada escenario, sin suponer que
                    los días sean independientes.
                  </p>
                )}
                {!!zone.warnings.length && (
                  <ul className="report-warnings">
                    {zone.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </details>
            </article>
          ) : (
            <div className="report-empty">
              {report
                ? "Elegí una zona con equipos pendientes."
                : "Preparando el informe…"}
            </div>
          )}
        </div>
        <section className="report-method">
          <h2>Cómo leer este informe</h2>
          <p>
            Buscamos al menos {report?.rules.minHours ?? "—"} horas seguidas con
            viento de hasta {report?.rules.wind ?? "—"} km/h y sin lluvia
            durante el ensayo. Puede llover antes o después y aun así quedar un
            horario útil. Sigue vigente el límite de{" "}
            {report?.rules.rain24Limit ?? "—"} mm de lluvia el día anterior para
            evaluar el acceso.
          </p>
          <p>
            Comparamos varios pronósticos para estimar cuántos días podrían
            servir. «Buen día para evaluar» invita a revisar horarios; «Necesita
            otra revisión» significa que faltan pronósticos para comparar.
            Ninguna etiqueta confirma una salida por sí sola.
          </p>
          <p>
            Las fechas lejanas son orientativas. Si el servidor está encendido,
            los resultados se actualizan solos. Antes de salir confirmá el
            viento en el lugar, los caminos y la disponibilidad del equipo.
          </p>
        </section>
      </main>
      {windowsOpen && selectedDay && (
        <PossibleWindows
          key={`${zone?.key}/${selectedDay.date}`}
          rows={rows}
          start={selectedDay.date}
          end={selectedDay.date}
          minHours={report!.rules.minHours}
          onClose={() => setWindowsOpen(false)}
        />
      )}
    </div>
  );
}
