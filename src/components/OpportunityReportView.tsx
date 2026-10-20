"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Info,
  Printer,
  Search,
  ShieldCheck,
} from "lucide-react";
import type {
  OpportunityReport,
  ReportZone,
} from "@/domain/opportunity-report";
import type { PossibleWindow } from "@/domain/work-windows";
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
    : "Sin consulta disponible";
const number = (n: number | null) =>
  n === null
    ? "—"
    : n > 0 && n < 0.1
      ? "<0,1"
      : n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const percent = (n: number | null) =>
  n === null ? "—" : n > 0 && n < 0.01 ? "<1%" : `${Math.round(n * 100)}%`;
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const statusLabel: Record<string, string> = {
  review: "Para revisar primero",
  watch: "Seguir evolución",
  limited: "Respaldo limitado",
  missing: "Sin cobertura",
};

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
      <strong>{number(period.expectedDays)}</strong>
      <span>días aptos esperados</span>
      <small>
        {period.total
          ? `${period.covered}/${period.total} días con datos`
          : "Fuera del período de campaña"}
      </small>
      {period.expectedDays === null && period.partialExpectedDays !== null && (
        <small>
          En la parte cubierta: {number(period.partialExpectedDays)} días
          esperados.
        </small>
      )}
    </button>
  );
}

export default function OpportunityReportView() {
  const [report, setReport] = useState<OpportunityReport | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [zoneKey, setZoneKey] = useState("");
  const [horizon, setHorizon] = useState<"7" | "14" | "campaign">("7");
  const [date, setDate] = useState("");
  const [windowsOpen, setWindowsOpen] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/report", { cache: "no-store" });
    const data = await r.json();
    if (!r.ok)
      throw new Error(data.error || "No se pudo consultar el informe.");
    setReport(data);
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
        }))
      : [];
  const range =
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
              <FileText size={15} /> PLANIFICACIÓN DE UNIFORMIDADES
            </p>
            <h1>Informe de oportunidades</h1>
            <p>
              Cuándo aprovechar el buen tiempo y cuántas oportunidades podrían
              quedar en cada zona.
            </p>
          </div>
          <div className="report-update">
            <Clock3 size={17} />
            <div>
              <strong>Actualización automática</strong>
              <span>Se revisa durante el día con el servidor encendido.</span>
              <small>
                Informe calculado:{" "}
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
              <p>
                Estás viendo una copia anterior. Revisá la fecha de las fuentes
                antes de decidir.
              </p>
            )}
          </div>
        )}
        {report && !report.active && (
          <div className="report-notice">
            La campaña cerró el {dateLabel(report.deadline)}. Actualizá el
            cierre en Datos y reglas para planificar nuevas fechas.
          </div>
        )}
        <section className="report-overview" aria-label="Estado de la campaña">
          <div>
            <span>Zonas para revisar primero</span>
            <strong>
              {report?.summary.toReview ?? "—"}
              <small> / {report?.summary.zones ?? "—"}</small>
            </strong>
          </div>
          <div>
            <span>Equipos pendientes</span>
            <strong>{report?.summary.pending ?? "—"}</strong>
          </div>
          <div>
            <span>Zonas con cobertura de los próximos 7 días</span>
            <strong>
              {report?.summary.covered7 ?? "—"}
              <small> / {report?.summary.zones ?? "—"}</small>
            </strong>
          </div>
        </section>
        <p className="report-caption">
          Las zonas comparten condiciones meteorológicas: varios equipos no
          convierten un mismo día apto en varias jornadas.{" "}
          {report?.excluded
            ? `${report.excluded} equipos excluidos por coordenadas a verificar.`
            : ""}
        </p>
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
            <p className="report-eyebrow">ZONAS CON TRABAJOS PENDIENTES</p>
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
                  <span>
                    {z.pending} equipos ·{" "}
                    {z.provinces.join(" / ") ||
                      `${z.lat.toFixed(2)}, ${z.lon.toFixed(2)}`}
                  </span>
                  <small>
                    {z.nextOpportunity
                      ? `${dateLabel(z.nextOpportunity.date)} · ${percent(z.nextOpportunity.probability)} de escenarios con día apto`
                      : "Sin candidata con respaldo suficiente a 7 días"}
                  </small>
                </button>
              ))}
            </nav>
            {report && !filtered.length && (
              <p className="report-empty">
                {search
                  ? "No hay zonas que coincidan con la búsqueda."
                  : "Todavía no hay equipos pendientes con ubicación válida. La carga automática aparecerá aquí cuando termine."}
              </p>
            )}
          </aside>
          {zone && period ? (
            <article className="report-zone" key={zone.key}>
              <div className="report-zone-heading">
                <div>
                  <p className="report-eyebrow">INFORME POR ZONA</p>
                  <h2>{zone.name}</h2>
                  <p>
                    {zone.fields.join(" · ") ||
                      "Ubicaciones agrupadas por cercanía meteorológica"}
                  </p>
                  <small>
                    {zone.pending} equipos pendientes · zona {zone.key} ·{" "}
                    {zone.provinces.join(" / ")}
                  </small>
                  <small className="report-source-age">
                    Corto plazo: {timeLabel(zone.sources.ensembleAt)} ·{" "}
                    {zone.sources.ensembleFresh
                      ? "vigente"
                      : "sin datos vigentes"}
                    {!!zone.warnings.length &&
                      ` · ${zone.warnings.length} advertencias en Fuentes`}
                  </small>
                </div>
                <ShieldCheck size={32} />
              </div>
              <section
                className={`report-opportunity ${zone.nextOpportunity ? "has-opportunity" : ""}`}
              >
                <CalendarDays size={24} />
                <div>
                  <span className="report-eyebrow">
                    {zone.nextOpportunity
                      ? "MEJOR CANDIDATA EN LOS PRÓXIMOS 7 DÍAS"
                      : "PRÓXIMOS 7 DÍAS"}
                  </span>
                  <h3>
                    {zone.nextOpportunity
                      ? `${dateLabel(zone.nextOpportunity.date)} · ${percent(zone.nextOpportunity.probability)}`
                      : "Sin fecha para priorizar con respaldo suficiente"}
                  </h3>
                  <p>
                    {zone.nextOpportunity
                      ? "Conviene revisar esta fecha primero. Confirmá la franja de cada equipo y el estado del campo antes de organizar la salida."
                      : "Consultá el detalle: puede haber oportunidades con menor probabilidad o cobertura incompleta. Esto no equivale a siete días de mal tiempo."}
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
                {period.total
                  ? `${dateLabel(period.start)} — ${dateLabel(period.end)}.`
                  : "El período no contiene días futuros de campaña."}{" "}
                El total suma posibilidades diarias: 3,5 días esperados no
                significa 3 días y medio confirmados. Hoy se consulta por
                separado porque ya está transcurriendo.
              </p>
              {range && (
                <div className="report-range">
                  <strong>
                    Entre {range.range[0]} y {range.range[1]} días aptos
                  </strong>
                  <span>
                    Rango central del 80% de los escenarios con datos completos
                    · {range.samples} miembros de {range.families} familias de
                    modelos. Representa dispersión del pronóstico; no es una
                    garantía de acierto.
                  </span>
                </div>
              )}
              {horizon === "campaign" && (
                <div className="report-notice">
                  A semanas o meses de distancia, usá el total como orientación
                  de campaña. La previsión lejana es experimental y no permite
                  comprometer días ni horarios concretos.
                </div>
              )}
              <section className="report-section">
                <div className="report-section-title">
                  <h3>Fechas para evaluar</h3>
                  <span>Elegí una fecha para ver qué podría venir después</span>
                </div>
                <p className="report-caption">
                  Para revisar primero: al menos{" "}
                  {report!.rules.minimumProbability}% de escenarios favorables,
                  dentro de los próximos 7 días y con datos suficientes de
                  varios modelos.
                </p>
                <div className="report-table-scroll">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Posibilidad de día apto</th>
                        <th>Uso sugerido</th>
                        <th>Respaldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone.daily
                        .filter(
                          (d) => horizon !== "7" || d.date <= zone.next7.end,
                        )
                        .map((day) => (
                          <tr
                            key={day.date}
                            className={
                              selectedDay?.date === day.date ? "selected" : ""
                            }
                          >
                            <td>
                              <button
                                aria-label={`Analizar ${dateLabel(day.date)}`}
                                aria-pressed={selectedDay?.date === day.date}
                                onClick={() => {
                                  setDate(day.date);
                                  setWindowsOpen(false);
                                }}
                              >
                                {dateLabel(day.date)}
                              </button>
                            </td>
                            <td>
                              <div className="report-probability">
                                <span>{percent(day.probability)}</span>
                                <span className="report-probability-track">
                                  <i
                                    style={{
                                      width: `${(day.probability ?? 0) * 100}%`,
                                    }}
                                  />
                                </span>
                              </div>
                            </td>
                            <td>
                              <span className={`report-badge ${day.status}`}>
                                {statusLabel[day.status]}
                              </span>
                              {day.source !== "pronóstico" &&
                                day.probability !== null && (
                                  <small>
                                    Estimación {day.source} · tentativa
                                  </small>
                                )}
                            </td>
                            <td>
                              {day.source === "pronóstico" ? (
                                <>
                                  {day.families} familias · {day.members}{" "}
                                  miembros
                                  <small>
                                    {day.supported
                                      ? "Cobertura suficiente de escenarios"
                                      : "Faltan fuentes o miembros"}
                                  </small>
                                </>
                              ) : day.probability !== null ? (
                                "Modelo de largo plazo + históricos"
                              ) : (
                                "Faltan datos vigentes"
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!zone.daily.length && (
                  <p className="report-empty">
                    No hay fechas futuras dentro del cierre de campaña.
                  </p>
                )}
              </section>
              {selectedDay && (
                <section className="report-repeat">
                  <div className="report-section-title">
                    <h3>
                      Si aprovechamos el {dateLabel(selectedDay.date)}, ¿qué
                      podría quedar?
                    </h3>
                    <Info size={19} />
                  </div>
                  {selectedDay.following ? (
                    <>
                      <div className="report-repeat-metrics">
                        <div>
                          <strong>
                            {number(selectedDay.following.expected)}
                          </strong>
                          <span>
                            otros días aptos esperados hasta{" "}
                            {dateLabel(selectedDay.followingEnd)}
                          </span>
                        </div>
                        <div>
                          <strong>
                            {percent(selectedDay.following.noMoreDays)}
                          </strong>
                          <span>
                            de escenarios compatibles sin otro día apto en ese
                            período
                          </span>
                        </div>
                      </div>
                      <p>
                        Entre los escenarios en los que el{" "}
                        {dateLabel(selectedDay.date)} resulta apto, el rango
                        central del 80% tiene entre{" "}
                        {selectedDay.following.range[0]} y{" "}
                        {selectedDay.following.range[1]} otros días aptos en los
                        siguientes {selectedDay.followingTotal} días. Se
                        conserva la secuencia de cada escenario: varios días de
                        buen tiempo pueden venir juntos.
                      </p>
                      <small>
                        {selectedDay.following.samples} escenarios compatibles ·{" "}
                        {selectedDay.following.supportingFamilies} familias
                        representadas. Es una estimación condicionada del
                        modelo, no una frecuencia de acierto comprobada.
                      </small>
                    </>
                  ) : (
                    <p>
                      No hay suficientes escenarios completos para estimar con
                      respaldo cuántos días aptos seguirían a esta fecha. No
                      extrapolamos un día lindo al resto de la semana. Revisá
                      los totales y su cobertura.
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
                  Hoy, {dateLabel(report!.today)} · {zone.todayWindows.length}{" "}
                  equipos con una franja propuesta aún por comenzar
                </summary>
                <p>
                  Los horarios provienen del acuerdo entre modelos horarios y
                  pueden diferir del porcentaje diario del ensemble. No
                  equivalen a trabajos confirmados.
                </p>
                {zone.todayWindows.length ? (
                  <ul>
                    {zone.todayWindows.map((w) => (
                      <li key={w.id}>
                        <strong>{w.name}</strong> · {w.field} ·{" "}
                        {w.window!.start.slice(11, 16)}–
                        {w.window!.end.slice(11, 16)} · acuerdo{" "}
                        {w.window!.probability}% · camino {w.road.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No hay una franja restante respaldada por datos horarios
                    recientes. Revisá la actualización de las fuentes antes de
                    decidir.
                  </p>
                )}
              </details>
              <section className="report-section">
                <div className="report-section-title">
                  <h3>Perspectiva por semana</h3>
                  <span>
                    Las fechas lejanas se usan para organizar recursos
                  </span>
                </div>
                <div className="report-table-scroll">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th>Días aptos esperados</th>
                        <th>Cobertura</th>
                        <th>Fuentes utilizadas</th>
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
                              {number(w.expectedDays)}
                              {w.expectedDays === null &&
                                w.partialExpectedDays !== null && (
                                  <small>
                                    {number(w.partialExpectedDays)} en la parte
                                    cubierta
                                  </small>
                                )}
                            </td>
                            <td>
                              {w.covered}/{w.total} días
                            </td>
                            <td>
                              {[
                                w.shortTermDays
                                  ? `${w.shortTermDays} de corto plazo`
                                  : "",
                                w.subseasonalDays
                                  ? `${w.subseasonalDays} de EC46`
                                  : "",
                                w.seasonalDays
                                  ? `${w.seasonalDays} de SEAS5`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Sin cobertura"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <details className="report-sources">
                <summary>
                  Fuentes, vigencia y equipos de esta zona
                  {zone.warnings.length
                    ? ` · ${zone.warnings.length} advertencias`
                    : ""}
                </summary>
                <dl>
                  <dt>Consulta del ensemble</dt>
                  <dd>
                    {timeLabel(zone.sources.ensembleAt)} ·{" "}
                    {zone.sources.ensembleFresh
                      ? "vigente"
                      : "sin datos vigentes"}
                  </dd>
                  <dt>Consulta del largo plazo</dt>
                  <dd>
                    {timeLabel(zone.sources.seasonalAt)} ·{" "}
                    {zone.sources.seasonalFresh
                      ? "vigente"
                      : "sin datos vigentes"}
                  </dd>
                  <dt>Históricos disponibles</dt>
                  <dd>
                    {zone.sources.historyYears} años · usados para estimar
                    ventanas lejanas, no para inventar un pronóstico faltante.
                  </dd>
                </dl>
                {!!zone.warnings.length && (
                  <ul className="report-warnings">
                    {zone.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                <ul>
                  {zone.equipment.map((e) => (
                    <li key={e.id}>
                      {e.name} · {e.field} · camino {e.road.toLowerCase()}
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ) : (
            <div className="report-empty">
              {report
                ? "Seleccioná una zona con equipos pendientes para ver el informe."
                : "Preparando el informe…"}
            </div>
          )}
        </div>
        <section className="report-method">
          <div>
            <CheckCircle2 size={22} />
            <h2>Cómo hacemos la estimación</h2>
          </div>
          <p>
            Comparamos muchos escenarios posibles de viento y lluvia. Un día
            cuenta como apto si permite al menos {report?.rules.minHours ?? "—"}{" "}
            horas continuas para trabajar, entre las{" "}
            {report?.rules.startHour ?? "—"} y las{" "}
            {report?.rules.endHour ?? "—"}, con viento de hasta{" "}
            {report?.rules.wind ?? "—"} km/h, lluvia del día de hasta{" "}
            {report?.rules.rain ?? "—"} mm y menos de{" "}
            {report?.rules.rain24Limit ?? "—"} mm el día anterior. Se aplican
            las reglas guardadas en la app.
          </p>
          <p>
            Si 7 de cada 10 escenarios permiten trabajar, mostramos una
            posibilidad del 70%. Al sumar las posibilidades de cada fecha
            estimamos cuántos días aptos podrían quedar. Para ver qué ocurriría
            después de una fecha favorable, seguimos esos mismos escenarios
            durante los días siguientes.
          </p>
          <p>
            El corto plazo sirve para preparar salidas. A mayor distancia usamos
            otros pronósticos y años de clima histórico para estimar ventanas;
            esas fechas son orientativas. Las probabilidades todavía no tienen
            una tasa de acierto local comprobada. Antes de salir, verificá el
            viento en el lugar, los accesos y la disponibilidad real de equipos
            y cuadrillas.
          </p>
          <p>
            El servidor actualiza las fuentes automáticamente, incluso con la
            pestaña cerrada. Si la computadora o el servidor están apagados,
            actualiza al volver a iniciarse. Las fuentes vencidas dejan de
            participar y la falta de cobertura se muestra explícitamente.
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
