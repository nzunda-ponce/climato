"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanningReport, PlanningZone } from "@/domain/planning-report";
import type { confusionReport } from "@/domain/forecast-validation";
import type { Rules } from "@/domain/types";
import {
  globalDailyEstimates,
  globalWeeklyEstimates,
  locationDayEstimate,
  missingForecastLabel,
} from "@/domain/planning-summary";
import WorkOverview from "./WorkOverview";
import DataScienceView from "./DataScienceView";
import {
  availabilityRegion,
  availabilityBacking,
  availabilityCell,
} from "@/domain/availability-matrix";
import { matchesLocation, nearbyReference } from "@/domain/location-label";
import StorageStatus from "./StorageStatus";
import AutoSyncStatus from "./AutoSyncStatus";
import "./planning.css";
import "./availability.css";
import "./ux-refinement.css";

type Verification = ReturnType<typeof confusionReport>;
const number = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("es-AR", { maximumFractionDigits: digits });
const percent = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${number(v * 100, 0)}%`;
const date = (v: string) =>
  new Date(v + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const group = availabilityRegion;
const selectionKey = "climato-planning-locations-v1";

type View =
  "resumen" | "zonas" | "detalle" | "validacion" | "datos" | "ciencia";
const viewLabels: Record<View, string> = {
  resumen: "Resumen",
  zonas: "Zonas",
  detalle: "Detalle por ubicación",
  validacion: "Validación",
  datos: "Datos y criterios",
  ciencia: "Ciencia de datos",
};
export default function PlanningWorkspace({
  initialView = "resumen",
  windyEnabled = false,
}: {
  initialView?: View;
  windyEnabled?: boolean;
}) {
  const [view, setView] = useState<View>(initialView);
  useEffect(() => {
    const update = () => {
      const hash = window.location.hash.slice(1),
        alias =
          hash === "analysis"
            ? "detalle"
            : hash === "verification"
              ? "validacion"
              : hash;
      setView(Object.hasOwn(viewLabels, alias) ? (alias as View) : initialView);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, [initialView]);
  const navigate = (target: View) => {
    setView(target);
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [report, setReport] = useState<PlanningReport | null>(null),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null),
    [search, setSearch] = useState("");
  const [undoSelection, setUndoSelection] = useState<string[] | null>(null);
  const [showWholeZone, setShowWholeZone] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const [horizon, setHorizon] = useState<7 | 14>(7),
    [threshold, setThreshold] = useState(70),
    [lead, setLead] = useState(1);
  const [focused, setFocused] = useState(""),
    [selectedDate, setSelectedDate] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null),
    [verifyError, setVerifyError] = useState("");
  const [settings, setSettings] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/planning", { cache: "no-store" }),
      data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setReport(data);
    setError("");
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const t = setInterval(
      () => void load().catch((e) => setError(e.message)),
      60000,
    );
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!report) return;
    setSelected((current) => {
      if (current !== null) return current;
      try {
        const saved = JSON.parse(localStorage.getItem(selectionKey) ?? "null");
        if (Array.isArray(saved) && saved.every((k) => typeof k === "string"))
          return saved;
      } catch {}
      return report.zones.map((z) => z.key);
    });
  }, [report]);
  useEffect(() => {
    if (selected !== null)
      try {
        localStorage.setItem(selectionKey, JSON.stringify(selected));
      } catch {}
  }, [selected]);
  const keys = useMemo(
    () =>
      selected === null
        ? []
        : (report?.zones
            .filter((z) => selected.includes(z.key))
            .map((z) => z.key) ?? []),
    [report, selected],
  );
  const keyQuery = JSON.stringify(keys);
  useEffect(() => {
    if (view !== "validacion") return;
    const controller = new AbortController();
    setVerification(null);
    setVerifyError("");
    const params = new URLSearchParams({
      lead: String(lead),
      threshold: String(threshold / 100),
    });
    (JSON.parse(keyQuery) as string[]).forEach((k) => params.append("key", k));
    void fetch("/api/validation?" + params, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setVerification(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setVerifyError(e.message);
      });
    return () => controller.abort();
  }, [keyQuery, lead, threshold, report?.computedAt, view]);
  const zones = report?.zones.filter((z) => keys.includes(z.key)) ?? [];
  const groups = useMemo(() => {
    const result = new Map<string, PlanningZone[]>();
    for (const z of report?.zones ?? [])
      result.set(group(z), [...(result.get(group(z)) ?? []), z]);
    return [...result].sort(([a], [b]) => a.localeCompare(b));
  }, [report]);
  const dates = zones[0]?.daily.slice(0, horizon).map((d) => d.date) ?? [];
  const focus = zones.find((z) => z.key === focused) ?? zones[0];
  const detailZones = focus
    ? showWholeZone
      ? zones.filter((z) => group(z) === group(focus))
      : [focus]
    : [];
  useEffect(() => {
    if (view !== "detalle" || !focus) return;
    const frame = requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, focused, selectedDate, focus?.key]);
  const weatherDates = zones
    .flatMap((z) => (z.sources.ensembleAt ? [z.sources.ensembleAt] : []))
    .sort();
  const selectedOutlook = focus?.outlook.find((d) => d.date === selectedDate);
  const detailDay =
    focus?.daily.find((d) => d.date === selectedDate) ??
    (selectedOutlook
      ? {
          ...focus!.daily[0],
          ...selectedOutlook,
          supported: selectedOutlook.probability !== null,
          windows: [],
          evidence: [],
          following: null,
          followingConsecutive: null,
        }
      : focus?.daily[0]);
  const sourceAt = !focus
    ? null
    : detailDay?.source === "histórico"
      ? focus.sources.historyAt
      : detailDay?.source === "subestacional" ||
          detailDay?.source === "estacional"
        ? focus.sources.seasonalAt
        : focus.sources.ensembleAt;
  const summaryField = horizon === 7 ? "next7" : "next14";
  const analysisZones = view === "detalle" ? detailZones : zones;
  const estimates = analysisZones
    .map((z) => locationDayEstimate(z, dates))
    .filter((e) => e.covered > 0);
  const globalDays = globalDailyEstimates(analysisZones, dates);
  const globalWeeks = globalWeeklyEstimates(analysisZones);
  const average = estimates.length
    ? estimates.reduce((sum, e) => sum + e.expected!, 0) / estimates.length
    : null;
  const coverageDays = estimates.length
    ? estimates.reduce((sum, e) => sum + e.covered, 0) / estimates.length
    : 0;
  const daysAbove = analysisZones.reduce(
    (s, z) =>
      s +
      z.daily
        .slice(0, horizon)
        .filter(
          (d) =>
            d.supported &&
            d.probability !== null &&
            d.probability >= threshold / 100,
        ).length,
    0,
  );
  const visibleKeys = (report?.zones ?? [])
    .filter((z) => matchesLocation(z, search, group(z)))
    .map((z) => z.key);
  const toggle = (ids: string[], enabled: boolean) => {
    setUndoSelection(selected);
    setSelected((current) =>
      enabled
        ? [...new Set([...(current ?? []), ...ids])]
        : (current ?? []).filter((k) => !ids.includes(k)),
    );
  };
  return (
    <div className={`planning-app ${view === "resumen" ? "work-home" : ""}`}>
      <a className="planning-skip" href="#main-content">
        Saltar al contenido
      </a>
      <header className="planning-header">
        <a href="/" className="planning-brand">
          climato
        </a>
        <nav aria-label="Apartados de Climato">
          {(Object.entries(viewLabels) as [View, string][])
            .filter(
              ([key]) =>
                view !== "resumen" ||
                ["resumen", "zonas", "datos"].includes(key),
            )
            .map(([key, label]) => (
              <a
                key={key}
                href={
                  key === "ciencia"
                    ? "/ciencia-de-datos"
                    : initialView === "ciencia"
                      ? `/#${key}`
                      : `#${key}`
                }
                aria-current={view === key ? "page" : undefined}
                onClick={() => setView(key)}
              >
                {view === "resumen"
                  ? (
                      {
                        resumen: "Inicio",
                        zonas: "Equipos",
                        datos: "Datos y criterios",
                      } as Partial<Record<View, string>>
                    )[key]
                  : label}
              </a>
            ))}
        </nav>
      </header>
      <main className="planning-main" id="main-content" tabIndex={-1}>
        {view !== "resumen" && (
          <section className="planning-intro">
            <div>
              <p className="planning-eyebrow">
                INFORME DE DISPONIBILIDAD CLIMÁTICA
              </p>
              <h1>{viewLabels[view]}</h1>
            </div>
            <div className="planning-updated">
              Informe publicado
              <br />
              <strong>
                {report
                  ? new Date(
                      report.publication?.at ?? report.computedAt,
                    ).toLocaleString("es-AR", {
                      timeZone: "America/Argentina/Buenos_Aires",
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : error
                    ? "Sin publicación disponible"
                    : "Cargando…"}
              </strong>
              <span>Hora de Argentina</span>
              {weatherDates.length > 0 && (
                <span className="planning-data-age">
                  Pronósticos descargados:{" "}
                  {new Date(weatherDates[0]).toLocaleString("es-AR", {
                    timeZone: "America/Argentina/Buenos_Aires",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {weatherDates[0] !== weatherDates.at(-1)
                    ? `–${new Date(weatherDates.at(-1)!).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })}`
                    : ""}
                </span>
              )}
              <span>Actualizaciones previstas: 07:17 y 19:17 · Argentina</span>
              {view === "datos" && <StorageStatus />}
            </div>
          </section>
        )}
        {error && view !== "resumen" && (
          <div className="planning-alert" role="alert">
            {error}{" "}
            <button
              onClick={() => void load().catch((e) => setError(e.message))}
            >
              Reintentar
            </button>
          </div>
        )}
        {view !== "resumen" && report?.publication?.stale && (
          <div className="planning-alert" role="alert">
            Este informe corresponde al{" "}
            {new Date(report.computedAt).toLocaleDateString("es-AR", {
              timeZone: "America/Argentina/Buenos_Aires",
            })}
            . La actualización programada está atrasada; los resultados no deben
            tomarse como un pronóstico vigente.
          </div>
        )}
        {view !== "resumen" && report?.publication?.pendingChanges && (
          <div className="planning-alert" role="status">
            Hay datos nuevos pendientes de publicar. Se muestra el último
            informe completo.
          </div>
        )}
        {view === "datos" && (
          <section className="planning-data-tools">
            <h2>Actualización y almacenamiento</h2>
            <AutoSyncStatus inline onReload={load} />
            <div>
              {!report?.publication?.readOnly && (
                <button onClick={() => setSettings((v) => !v)}>
                  {settings
                    ? "Cerrar criterios"
                    : "Editar criterios del ensayo"}
                </button>
              )}
              {report?.publication?.readOnly && (
                <p className="planning-muted">
                  Informe de consulta. Los criterios y las descargas se
                  administran fuera de este enlace.
                </p>
              )}
              <button onClick={() => window.print()}>Imprimir informe</button>
            </div>
          </section>
        )}
        {view === "datos" &&
          settings &&
          report &&
          !report.publication?.readOnly && (
            <RulesEditor
              rules={report.rules}
              onSaved={async () => {
                await load();
                setSettings(false);
              }}
            />
          )}
        {view === "datos" && report && (
          <div className="planning-criteria">
            <strong>Ensayo apto:</strong> {report.rules.minHours} h consecutivas
            entre las {report.rules.startHour} y {report.rules.endHour} h ·
            viento ≤ {report.rules.wind} km/h · lluvia durante el ensayo ≤{" "}
            {report.rules.rain} mm · lluvia del día anterior &lt;{" "}
            {report.rules.rain24Limit} mm.
            <span>
              Evalúa clima. No certifica acceso ni condiciones reales del campo.
            </span>
          </div>
        )}
        <div className="planning-layout single-view">
          {view === "zonas" && (
            <aside
              className="planning-selection"
              aria-label="Selección de zonas"
            >
              <div className="planning-panel-title">
                <h2>Zonas de trabajo</h2>
                <span>{zones.length} ubicaciones</span>
              </div>
              <label className="planning-search">
                Buscar zona o equipo
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Necochea, campo, equipo…"
                />
              </label>
              <div className="planning-selection-actions">
                <button onClick={() => toggle(visibleKeys, true)}>
                  {search ? "Seleccionar resultados" : "Seleccionar todas"}
                </button>
                <button onClick={() => toggle(visibleKeys, false)}>
                  {search ? "Quitar resultados" : "Quitar todas"}
                </button>
                {undoSelection && (
                  <button
                    onClick={() => {
                      setSelected(undoSelection);
                      setUndoSelection(null);
                    }}
                  >
                    Deshacer selección
                  </button>
                )}
              </div>
              <p className="planning-selection-scope">
                La zona se obtiene de la segunda letra del nombre: BE1187 → Zona
                E. {zones.length} ubicaciones incluidas en el análisis. Las
                casillas de grupo afectan sólo los resultados visibles cuando
                buscás.
              </p>
              {search &&
                !groups.some(([name, items]) =>
                  items.some((z) => matchesLocation(z, search, name)),
                ) && (
                  <div className="planning-empty" role="status">
                    <strong>No encontramos ubicaciones para «{search}»</strong>
                    <p>
                      Probá con un equipo, campo, provincia o referencia
                      cercana.
                    </p>
                    <button onClick={() => setSearch("")}>
                      Limpiar búsqueda
                    </button>
                  </div>
                )}
              {!report ? (
                <p>Cargando ubicaciones…</p>
              ) : !report.zones.length ? (
                <p>
                  La importación automática de equipos aún no terminó. Las
                  ubicaciones aparecerán aquí.
                </p>
              ) : (
                groups.map(([name, items]) => {
                  const visible = items.filter((z) =>
                    matchesLocation(z, search, name),
                  );
                  if (!visible.length) return null;
                  const count = visible.filter((z) =>
                    keys.includes(z.key),
                  ).length;
                  return (
                    <details
                      key={`${name}-${Boolean(search)}`}
                      open={search ? true : undefined}
                    >
                      <summary>
                        <input
                          type="checkbox"
                          aria-label={`Incluir zona ${name}${search ? " · resultados visibles" : ""}`}
                          checked={count === visible.length}
                          ref={(el) => {
                            if (el)
                              el.indeterminate =
                                count > 0 && count < visible.length;
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            toggle(
                              visible.map((z) => z.key),
                              e.target.checked,
                            )
                          }
                        />
                        <span>
                          {name}
                          <small>
                            {count}/{visible.length}{" "}
                            {search ? "resultados visibles" : "ubicaciones"} ·{" "}
                            {visible.reduce((s, z) => s + z.pending, 0)} equipos
                          </small>
                        </span>
                      </summary>
                      <div>
                        {visible.map((z) => (
                          <label key={z.key}>
                            <input
                              type="checkbox"
                              checked={keys.includes(z.key)}
                              onChange={(e) =>
                                toggle([z.key], e.target.checked)
                              }
                            />
                            <span>
                              {z.equipment.map((e) => e.name).join(" / ")}
                              <small>
                                {z.fields.join(" / ")} ·{" "}
                                {z.provinces.join(" / ")}
                              </small>
                              {nearbyReference(z) && (
                                <small>{nearbyReference(z)}</small>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  );
                })
              )}
              {!!report?.excluded && (
                <p>
                  {report.excluded} equipos excluidos por coordenadas que
                  requieren revisión.
                </p>
              )}
              <p className="planning-muted">
                Desmarcar una zona la excluye de todas las estadísticas y
                tablas. Se conserva tu selección en este navegador.
              </p>
              <button
                className="planning-selection-done"
                onClick={() => navigate("resumen")}
              >
                Ver análisis · {zones.length} ubicaciones
              </button>
            </aside>
          )}
          <div className="planning-content">
            {view === "ciencia" && (
              <DataScienceView report={report} zones={zones} />
            )}
            {view === "resumen" && (
              <WorkOverview
                windyEnabled={windyEnabled}
                report={report}
                zones={report?.zones ?? []}
                error={error}
                onRetry={() => void load().catch((e) => setError(e.message))}
                onDetail={(key, date) => {
                  setSelected((current) => [
                    ...new Set([...(current ?? []), key]),
                  ]);
                  setFocused(key);
                  setSelectedDate(date);
                  setShowWholeZone(false);
                  navigate("detalle");
                }}
              />
            )}
            {view === "detalle" && (
              <section id="analysis" className="planning-analysis">
                <div className="planning-panel-title">
                  <div>
                    <p className="planning-eyebrow">
                      DISPONIBILIDAD POR UBICACIÓN
                    </p>
                    <h2>Disponibilidad para la campaña</h2>
                  </div>
                  <div className="planning-controls">
                    <label>
                      Período
                      <select
                        aria-label="Período"
                        value={horizon}
                        onChange={(e) =>
                          setHorizon(Number(e.target.value) as 7 | 14)
                        }
                      >
                        <option value="7">7 días</option>
                        <option value="14">14 días</option>
                      </select>
                    </label>
                    <label>
                      Probabilidad mínima
                      <select
                        aria-label="Probabilidad mínima"
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                      >
                        {[50, 60, 70, 80, 90, 95].map((v) => (
                          <option key={v} value={v}>
                            {v}%
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="planning-location-toolbar">
                  <label>
                    Fecha
                    <input
                      aria-label="Fecha del detalle"
                      type="date"
                      value={selectedDate || focus?.daily[0]?.date || ""}
                      min={report?.start}
                      max={report?.deadline}
                      onChange={(e) => setSelectedDate(e.target.value)}
                    />
                  </label>
                  <button onClick={() => navigate("resumen")}>
                    ← Volver a disponibilidad
                  </button>
                  <label>
                    Ubicación
                    <select
                      aria-label="Ubicación del detalle"
                      value={focus?.key ?? ""}
                      onChange={(e) => {
                        setFocused(e.target.value);
                        setShowWholeZone(false);
                      }}
                    >
                      {zones.map((z) => (
                        <option key={z.key} value={z.key}>
                          {group(z)} · {z.fields.join(" / ")} ·{" "}
                          {z.equipment.map((e) => e.name).join(" / ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    aria-pressed={showWholeZone}
                    onClick={() => setShowWholeZone((v) => !v)}
                  >
                    {showWholeZone
                      ? "Ver sólo esta ubicación"
                      : "Comparar ubicaciones de esta zona"}
                  </button>
                </div>
                {!zones.length ? (
                  <div className="planning-empty">
                    Seleccioná al menos una zona para generar el análisis.
                  </div>
                ) : (
                  <>
                    <div className="planning-stats">
                      <Stat
                        label="Equipos seleccionados"
                        value={String(
                          analysisZones.reduce((s, z) => s + z.pending, 0),
                        )}
                        note={`${analysisZones.length} ubicaciones analizadas individualmente`}
                      />
                      <Stat
                        label="Días previstos por ubicación · fechas analizadas"
                        value={number(average)}
                        note={`${estimates.length}/${analysisZones.length} ubicaciones con datos · ${number(coverageDays)}/${dates.length} fechas analizadas en promedio. No extrapola los días pendientes.`}
                      />
                      <Stat
                        label={`Ubicación-días con probabilidad ≥ ${threshold}%`}
                        value={String(daysAbove)}
                        note="No equivale a días distintos ni a trabajos ejecutables"
                      />
                    </div>
                    <section
                      className="planning-weekly-summary"
                      aria-label="Estimación semanal hasta fin de campaña"
                    >
                      <h3>
                        Ventanas semanales hasta{" "}
                        {report ? date(report.deadline) : "fin de campaña"}
                      </h3>
                      <p>
                        Días aptos estimados por ubicación seleccionada. Cuando
                        falta pronóstico se utiliza el historial de estas mismas
                        fechas, con al menos diez años. La base histórica
                        orienta la planificación; no anticipa el tiempo de una
                        semana concreta.
                      </p>
                      <div className="planning-global-days">
                        {globalWeeks.map((w) => (
                          <div key={w.start}>
                            <span>
                              {date(w.start)}–{date(w.end)}
                            </span>
                            <strong>
                              {w.expected === null
                                ? "Cargando"
                                : `${number(w.expected)} días`}
                            </strong>
                            <small>
                              {availabilityBacking(
                                availabilityCell(
                                  analysisZones,
                                  analysisZones[0]?.outlook
                                    .filter(
                                      (d) =>
                                        d.date >= w.start && d.date <= w.end,
                                    )
                                    .map((d) => d.date) ?? [],
                                ),
                              )}
                            </small>
                            <small>
                              {w.covered}/{w.total} ubicaciones
                              {!w.complete && w.covered > 0
                                ? " · fechas parciales"
                                : ""}
                            </small>
                          </div>
                        ))}
                      </div>
                      <details>
                        <summary>
                          Ver semanas por ubicación y referencia histórica
                        </summary>
                        <div className="planning-table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Ubicación / equipos</th>
                                {globalWeeks.map((w) => (
                                  <th key={w.start}>
                                    {date(w.start)}–{date(w.end)}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {detailZones.map((z) => (
                                <tr key={z.key}>
                                  <th>
                                    {group(z)}
                                    <small>
                                      {z.equipment
                                        .map((e) => e.name)
                                        .join(" / ")}
                                    </small>
                                  </th>
                                  {z.weekly.map((w) => (
                                    <td key={w.start}>
                                      <strong>
                                        {w.partialExpectedDays === null
                                          ? `Cargando históricos (${z.sources.historyYears}/10 años mínimos)`
                                          : `${number(w.expectedDays ?? w.partialExpectedDays)} días`}
                                      </strong>
                                      <small>
                                        {availabilityBacking(
                                          availabilityCell(
                                            [z],
                                            z.outlook
                                              .filter(
                                                (d) =>
                                                  d.date >= w.start &&
                                                  d.date <= w.end,
                                              )
                                              .map((d) => d.date),
                                          ),
                                        )}{" "}
                                        · {w.covered}/{w.total} fechas
                                      </small>
                                      {w.historicalReference && (
                                        <small>
                                          Referencia histórica:{" "}
                                          {w.historicalReference.range[0]}–
                                          {w.historicalReference.range[1]} días
                                          en el 80% central de{" "}
                                          {w.historicalReference.years} años
                                        </small>
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </section>
                    <h3>Detalle diario · próximos {horizon} días</h3>
                    <p className="planning-evidence-note">
                      Una sola estimación combina el pronóstico y, cuando falta,
                      la referencia histórica. Las celdas «Base histórica»
                      muestran la frecuencia pasada de días aptos en esas
                      fechas; no confirman el tiempo de ese día. Los datos
                      pendientes no se cuentan como días no aptos.
                    </p>
                    <section
                      className="planning-global-summary"
                      aria-label="Estimación global"
                    >
                      <h3>Estimación global de las zonas seleccionadas</h3>
                      <p>
                        Disponibilidad media entre ubicaciones con datos. Por
                        ejemplo, 80% equivale a 8 de cada 10 ubicaciones aptas
                        en promedio; no garantiza cuáles lo estarán.
                      </p>
                      <div className="planning-global-days">
                        {globalDays.map((d) => (
                          <div key={d.date}>
                            <span>{date(d.date)}</span>
                            <strong>
                              {d.probability === null
                                ? "Cargando"
                                : percent(d.probability)}
                            </strong>
                            <small>
                              {d.covered}/{d.total} ubicaciones analizadas
                            </small>
                            <small>
                              {availabilityBacking(
                                availabilityCell(analysisZones, [d.date]),
                              )}
                            </small>
                          </div>
                        ))}
                      </div>
                    </section>
                    <div className="planning-table-scroll">
                      <table className="planning-calendar">
                        <caption>
                          Probabilidad diaria por ubicación. Elegí una celda
                          para ver horarios y el resultado combinado.
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Ubicación / equipos</th>
                            <th scope="col">
                              Días esperados
                              <br />
                              <small>rango central 80% de escenarios</small>
                            </th>
                            {dates.map((d) => (
                              <th key={d} scope="col">
                                {date(d)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detailZones.map((z) => {
                            const distribution = z[summaryField].scenarios;
                            const estimate = locationDayEstimate(z, dates);
                            return (
                              <tr key={z.key}>
                                <th scope="row">
                                  <button
                                    className="planning-location-button"
                                    onClick={() => {
                                      setFocused(z.key);
                                      setSelectedDate(z.daily[0]?.date ?? "");
                                    }}
                                  >
                                    {group(z)}
                                    <small>
                                      {z.equipment
                                        .map((e) => e.name)
                                        .join(" / ")}{" "}
                                      · {z.fields.join(" / ")}
                                    </small>
                                  </button>
                                </th>
                                <td>
                                  <strong>
                                    {estimate.expected === null
                                      ? missingForecastLabel(z)
                                      : number(
                                          distribution?.expected ??
                                            estimate.expected,
                                        )}
                                  </strong>
                                  <small>
                                    {distribution
                                      ? `${distribution.range[0]}–${distribution.range[1]} días`
                                      : estimate.covered
                                        ? `Sobre ${estimate.covered} de ${estimate.total} días`
                                        : "Reintento automático"}
                                  </small>
                                  {distribution && (
                                    <small>
                                      Racha más larga:{" "}
                                      {z[
                                        horizon === 7
                                          ? "consecutive7"
                                          : "consecutive14"
                                      ]
                                        ? `${z[horizon === 7 ? "consecutive7" : "consecutive14"]!.range[0]}–${z[horizon === 7 ? "consecutive7" : "consecutive14"]!.range[1]} días seguidos`
                                        : "Sin racha definida"}
                                    </small>
                                  )}
                                </td>
                                {dates.map((day) => {
                                  const d = z.daily.find((d) => d.date === day),
                                    strong =
                                      d?.supported &&
                                      d.source !== "histórico" &&
                                      d.probability !== null &&
                                      d.probability !== undefined &&
                                      d.probability >= threshold / 100;
                                  return (
                                    <td key={day}>
                                      <button
                                        className={`planning-day ${strong ? "above" : "below"} ${focus?.key === z.key && detailDay?.date === day ? "selected" : ""}`}
                                        aria-label={`${z.equipment.map((e) => e.name).join(", ")}, ${date(day)}: ${percent(d?.probability)}`}
                                        onClick={() => {
                                          setFocused(z.key);
                                          setSelectedDate(day);
                                        }}
                                      >
                                        {d?.probability === null ||
                                        d?.probability === undefined
                                          ? "Pendiente"
                                          : percent(d.probability)}
                                        <small>
                                          {d?.source === "histórico"
                                            ? "Base histórica"
                                            : d?.source === "subestacional" ||
                                                d?.source === "estacional"
                                              ? "Proyección"
                                              : d?.supported
                                                ? strong
                                                  ? "Cumple el mínimo"
                                                  : "Bajo el mínimo"
                                                : missingForecastLabel(z)}
                                        </small>
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {focus && detailDay && (
                      <section
                        className="planning-detail"
                        ref={detailRef}
                        tabIndex={-1}
                        aria-label="Detalle de la ubicación seleccionada"
                      >
                        <div className="planning-panel-title">
                          <div>
                            <h3>
                              {group(focus)} · {date(detailDay.date)}
                            </h3>
                            <p>
                              {[
                                focus.equipment.map((e) => e.name).join(" / "),
                                focus.fields.join(" / "),
                                nearbyReference(focus),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <strong className="planning-probability">
                            {percent(detailDay.probability)}
                          </strong>
                        </div>
                        <div className="planning-detail-grid">
                          <div>
                            <h4>Estimación combinada para esta ubicación</h4>
                            <p>
                              {detailDay.source === "histórico"
                                ? `Base histórica de ${detailDay.historyYears} años: ${percent(detailDay.probability)} de días aptos en estas fechas. Para decidir la salida, consultá el pronóstico cuando esté disponible.`
                                : detailDay.source === "subestacional" ||
                                    detailDay.source === "estacional"
                                  ? `Proyección meteorológica: ${percent(detailDay.probability)} de disponibilidad diaria estimada. Usala para comparar períodos; el horario aún no está definido.`
                                  : detailDay.supported
                                    ? `Probabilidad de disponer de al menos ${report?.rules.minHours ?? 4} horas seguidas aptas: ${percent(detailDay.probability)}. Se combinan los pronósticos que cubren esta fecha.`
                                    : missingForecastLabel(focus) +
                                      ". La aplicación reintentará las descargas automáticamente."}
                            </p>
                            <details className="planning-technical">
                              <summary>Detalle técnico de las fuentes</summary>
                              <p>
                                Para combinar pronósticos meteorológicos se
                                exigen al menos dos fuentes con suficientes
                                simulaciones y cobertura. Una fuente sin
                                cobertura en esta fecha no anula las otras.
                              </p>
                              <ul>
                                {detailDay.evidence.map((e) => (
                                  <li key={e.family}>
                                    {e.family}: {e.usable}/{e.total} miembros ·{" "}
                                    {percent(e.probability)}
                                  </li>
                                ))}
                              </ul>
                              {focus.dataErrors?.map((e, i) => (
                                <p key={i}>{e}</p>
                              ))}
                            </details>
                            <p>
                              {detailDay.source === "histórico"
                                ? "Históricos actualizados"
                                : "Pronóstico descargado"}
                              :{" "}
                              {sourceAt
                                ? new Date(sourceAt).toLocaleString("es-AR", {
                                    timeZone: "America/Argentina/Buenos_Aires",
                                  })
                                : "sin datos"}
                              .
                            </p>
                          </div>
                          <div>
                            <h4>
                              {detailDay.source === "histórico"
                                ? "Horarios del ensayo"
                                : `Franjas con probabilidad ≥ ${threshold}%`}
                            </h4>
                            {detailDay.windows.filter(
                              (w) =>
                                w.supported &&
                                w.basis === "ensemble" &&
                                w.probability >= threshold &&
                                w.families >= 2 &&
                                (w.coverage ?? 0) >= 0.8,
                            ).length ? (
                              <ul>
                                {detailDay.windows
                                  .filter(
                                    (w) =>
                                      w.supported &&
                                      w.basis === "ensemble" &&
                                      w.probability >= threshold &&
                                      w.families >= 2 &&
                                      (w.coverage ?? 0) >= 0.8,
                                  )
                                  .map((w) => (
                                    <li key={w.start}>
                                      {w.start.slice(11, 16)}–
                                      {w.end.slice(11, 16)} h · {w.hours} h ·{" "}
                                      {number(w.probability, 0)}% de escenarios
                                    </li>
                                  ))}
                              </ul>
                            ) : (
                              <p>
                                {detailDay.source === "histórico"
                                  ? "El historial permite estimar días disponibles por semana, pero no un horario para esta fecha. La franja se precisará cuando haya pronóstico."
                                  : "No hay una franja común con evidencia suficiente que supere el umbral. La probabilidad diaria puede reunir ensayos en horarios distintos."}
                              </p>
                            )}
                            {detailDay.following && (
                              <p>
                                Si este día resulta apto, se esperan{" "}
                                <strong>
                                  {number(detailDay.following.expected)} días
                                  adicionales
                                </strong>{" "}
                                hasta el {date(detailDay.followingEnd)}; rango
                                de escenarios {detailDay.following.range[0]}–
                                {detailDay.following.range[1]} días.
                                Probabilidad de no tener otro día apto:{" "}
                                {percent(detailDay.following.noMoreDays)}.
                              </p>
                            )}
                            {detailDay.followingConsecutive && (
                              <p>
                                Continuidad después de este día apto:{" "}
                                <strong>
                                  {number(
                                    detailDay.followingConsecutive.expected,
                                  )}{" "}
                                  días seguidos adicionales
                                </strong>
                                ; rango de escenarios{" "}
                                {detailDay.followingConsecutive.range[0]}–
                                {detailDay.followingConsecutive.range[1]}.
                                Probabilidad de que la racha termine ese mismo
                                día:{" "}
                                {percent(
                                  detailDay.followingConsecutive.noMoreDays,
                                )}
                                .
                              </p>
                            )}
                          </div>
                        </div>
                        {focus.equipment.some((e) => e.road !== "APTO") && (
                          <p className="planning-access">
                            Acceso al campo: hay equipos con acceso desconocido
                            o no apto. El resultado climático no resuelve esa
                            restricción.
                          </p>
                        )}
                      </section>
                    )}
                  </>
                )}
              </section>
            )}
            {view === "validacion" && (
              <section id="verification" className="planning-validation">
                <div className="planning-panel-title">
                  <div>
                    <p className="planning-eyebrow">AUDITORÍA DE RESULTADOS</p>
                    <h2>Matriz de confusión · últimos 30 días</h2>
                  </div>
                  <label>
                    Anticipación del pronóstico
                    <select
                      aria-label="Anticipación del pronóstico"
                      value={lead}
                      onChange={(e) => setLead(Number(e.target.value))}
                    >
                      {[1, 3, 7, 14].map((v) => (
                        <option value={v} key={v}>
                          {v} {v === 1 ? "día" : "días"} antes
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p>
                  Compara la primera estimación guardada con esa anticipación
                  contra el clima reconstruido por ERA5. Usa las mismas zonas,
                  criterios y umbral ({threshold}%) del análisis. ERA5 es una
                  referencia meteorológica, no una medición del ensayo en campo.
                </p>
                <label className="planning-validation-threshold">
                  Umbral de clasificación
                  <select
                    aria-label="Umbral de validación"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                  >
                    {[50, 60, 70, 80, 90, 95].map((v) => (
                      <option key={v} value={v}>
                        {v}%
                      </option>
                    ))}
                  </select>
                </label>
                {verifyError && <p role="alert">{verifyError}</p>}
                {!verification && !verifyError ? (
                  <p>Consultando registros…</p>
                ) : (
                  verification && (
                    <>
                      <p className="planning-validation-coverage">
                        {date(verification.start)}–{date(verification.end)} ·{" "}
                        <strong>{verification.count} casos verificados</strong>{" "}
                        de {verification.expected} ubicación-días ·{" "}
                        {verification.days} fechas · {verification.locations}{" "}
                        ubicaciones. {verification.captured} pronósticos
                        archivados; {verification.pending} sin referencia
                        completa.
                      </p>
                      {verification.count === 0 && (
                        <div className="planning-empty">
                          <strong>
                            Aún no hay pares de pronóstico y resultado para
                            medir aciertos.
                          </strong>
                          <p>
                            La herramienta ya conserva las nuevas estimaciones
                            antes de cada fecha. Los resultados se incorporarán
                            automáticamente cuando ERA5 publique los datos;
                            suelen tener varios días de demora. Los días sin
                            registro previo no se reconstruyen como si hubieran
                            sido pronosticados.
                          </p>
                        </div>
                      )}
                      {verification.count > 0 && (
                        <div className="planning-validation-grid">
                          <table className="planning-confusion">
                            <caption>
                              Pronóstico frente a referencia meteorológica
                            </caption>
                            <thead>
                              <tr>
                                <th></th>
                                <th scope="col">Referencia: apto</th>
                                <th scope="col">Referencia: no apto</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <th scope="row">Pronóstico ≥ {threshold}%</th>
                                <td className="correct">
                                  {verification.count ? verification.tp : "—"}
                                  <small>Aciertos aptos</small>
                                </td>
                                <td className="wrong">
                                  {verification.count ? verification.fp : "—"}
                                  <small>Falsas alarmas</small>
                                </td>
                              </tr>
                              <tr>
                                <th scope="row">
                                  Pronóstico &lt; {threshold}%
                                </th>
                                <td className="wrong">
                                  {verification.count ? verification.fn : "—"}
                                  <small>Días aptos no detectados</small>
                                </td>
                                <td className="correct">
                                  {verification.count ? verification.tn : "—"}
                                  <small>Aciertos no aptos</small>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <div className="planning-metrics">
                            <Stat
                              label="Acierto global"
                              value={percent(verification.accuracy)}
                              note="Proporción de clasificaciones correctas"
                            />
                            <Stat
                              label="Precisión de los días clasificados aptos"
                              value={percent(verification.precision)}
                              note="De los anunciados aptos, cuántos lo fueron"
                            />
                            <Stat
                              label="Detección de días aptos"
                              value={percent(verification.recall)}
                              note="De los días aptos, cuántos detectamos"
                            />
                            <Stat
                              label="Error probabilístico · Brier"
                              value={number(verification.brier, 3)}
                              note="0 es perfecto; 1 es el error máximo"
                            />
                          </div>
                        </div>
                      )}
                      {verification.count > 0 && (
                        <details>
                          <summary>
                            Calibración: probabilidad anunciada frente a
                            frecuencia observada
                          </summary>
                          <div className="planning-table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Intervalo</th>
                                  <th>Casos</th>
                                  <th>Probabilidad media</th>
                                  <th>Frecuencia apta en ERA5</th>
                                </tr>
                              </thead>
                              <tbody>
                                {verification.bins.map((b) => (
                                  <tr key={b.lower}>
                                    <td>
                                      {percent(b.lower)}–{percent(b.upper)}
                                    </td>
                                    <td>{b.count}</td>
                                    <td>{percent(b.predicted)}</td>
                                    <td>{percent(b.observed)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )}
                      <p className="planning-muted">
                        Una ubicación y fecha cuentan una sola vez por
                        anticipación. Vecinos y días consecutivos comparten
                        clima: el número de casos no equivale a observaciones
                        independientes. Cambiar el umbral modifica la
                        clasificación, no los registros. Sin casos de una clase,
                        su métrica queda sin valor.
                      </p>
                    </>
                  )
                )}
                <details className="planning-training">
                  <summary>
                    Validación del entrenamiento histórico · separada del
                    pronóstico operativo
                  </summary>
                  <p>
                    El modelo de análogos se entrenó con ERA5 hasta 2015 y se
                    probó en fechas desde 2016. Esta prueba interna usa clima
                    del día reconstruido; mide la relación entre condiciones y
                    aptitud, no la capacidad de anticipar el tiempo. No
                    sustituye la matriz de los últimos 30 días ni certifica el
                    pronóstico estacional.
                  </p>
                  <div className="planning-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Ubicación</th>
                          <th>Casos de prueba</th>
                          <th>Brier del modelo</th>
                          <th>Brier de referencia mensual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zones.map((z) => (
                          <tr key={z.key}>
                            <th>
                              {group(z)} ·{" "}
                              {z.equipment.map((e) => e.name).join(" / ")}
                            </th>
                            <td>{z.training?.count ?? "—"}</td>
                            <td>{number(z.training?.brier, 3)}</td>
                            <td>{number(z.training?.baseline, 3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            )}
            {view === "detalle" && (
              <section className="planning-longrange">
                <h2>Perspectiva hasta fin de campaña</h2>
                <p>
                  El total suma el pronóstico disponible y, para las fechas
                  restantes, la frecuencia histórica de días aptos en cada
                  ubicación. Es una estimación de disponibilidad para planificar
                  la campaña, no un calendario de días confirmados. Se indica la
                  cobertura cuando la descarga aún está incompleta.
                </p>
                <div className="planning-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Ubicación</th>
                        <th>
                          Días esperados hasta{" "}
                          {report ? date(report.deadline) : "fin de campaña"}
                        </th>
                        <th>Cobertura de fechas</th>
                        <th>Historia de entrenamiento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailZones.map((z) => (
                        <tr key={z.key}>
                          <th>
                            {group(z)} ·{" "}
                            {z.equipment.map((e) => e.name).join(" / ")}
                          </th>
                          <td>
                            {z.remaining.partialExpectedDays === null
                              ? `Cargando históricos (${z.sources.historyYears}/10 años mínimos)`
                              : number(
                                  z.remaining.expectedDays ??
                                    z.remaining.partialExpectedDays,
                                )}
                            <small>
                              {z.remaining.historicalDays > 0
                                ? `${z.remaining.historicalDays} fechas con base histórica`
                                : "Pronóstico disponible"}
                              {z.remaining.covered < z.remaining.total
                                ? " · estimación parcial"
                                : " · período completo"}
                            </small>
                          </td>
                          <td>
                            {z.remaining.covered}/{z.remaining.total}
                          </td>
                          <td>{z.sources.historyYears} años</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {view !== "resumen" && report?.publication?.stale && (
              <div className="planning-alert" role="alert">
                Este informe corresponde al{" "}
                {new Date(report.computedAt).toLocaleDateString("es-AR", {
                  timeZone: "America/Argentina/Buenos_Aires",
                })}
                . La actualización programada está atrasada; los resultados no
                deben tomarse como un pronóstico vigente.
              </div>
            )}
            {view !== "resumen" && report?.publication?.pendingChanges && (
              <div className="planning-alert" role="status">
                Hay datos nuevos pendientes de publicar. Se muestra el último
                informe completo.
              </div>
            )}
            {view === "datos" && (
              <section className="planning-method">
                <h2>Cómo se estima la disponibilidad</h2>
                <ol>
                  <li>
                    Se consulta el pronóstico en las coordenadas de cada equipo.
                    No se interpola una probabilidad a partir del mapa de
                    colores.
                  </li>
                  <li>
                    En cada escenario se buscan ensayos completos que cumplan
                    viento, lluvia y duración. La lluvia fuera del ensayo no
                    descarta el día; la del día anterior se verifica por
                    separado.
                  </li>
                  <li>
                    La probabilidad diaria es la proporción de escenarios con al
                    menos un ensayo. Se combinan las fuentes que tienen datos
                    suficientes para esa fecha, con igual peso entre ellas. Si
                    falta información, se indica y se reintenta la descarga.
                  </li>
                  <li>
                    Si no hay pronóstico suficiente para una fecha, se usa la
                    frecuencia histórica de días aptos en esa misma ubicación y
                    época del año, con al menos diez años de datos. La matriz
                    reúne estas referencias y los pronósticos disponibles; en
                    cada celda se pueden consultar las fuentes y los faltantes.
                  </li>
                  <li>
                    Los días esperados y su rango se calculan recorriendo
                    escenarios completos: se conserva la relación entre días
                    consecutivos. El rango central del 80% describe escenarios
                    del modelo; no es un intervalo de confianza validado en
                    campo.
                  </li>
                  <li>
                    Se guardan las estimaciones antes del día evaluado y después
                    se contrastan con ERA5. La matriz y el Brier permiten medir
                    aciertos y calibración sin usar el resultado futuro para
                    reconstruir el pronóstico.
                  </li>
                </ol>
                <p>
                  Un día climático apto no implica que se puedan ejecutar todos
                  los equipos: desplazamientos, personal, acceso y estado del
                  suelo necesitan planificación aparte.
                </p>
              </section>
            )}
          </div>
        </div>
      </main>
      {view !== "resumen" && (
        <footer className="planning-footer">
          Climato · Informe de planificación de uniformidades ·{" "}
          <a
            href="https://www.windy.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Windy
          </a>{" "}
          · Meteorología: Open-Meteo / pronósticos y ERA5.{" "}
          {report?.publication?.readOnly
            ? "Informe de consulta: los datos se preparan en un proceso independiente."
            : "Actualización local: mantener el proceso de datos en ejecución."}
        </footer>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="planning-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function RulesEditor({
  rules,
  onSaved,
}: {
  rules: Rules;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(rules),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fields: {
    key: keyof Rules;
    label: string;
    step: number;
    min: number;
    max: number;
  }[] = [
    { key: "wind", label: "Viento máximo · km/h", step: 1, min: 1, max: 100 },
    {
      key: "minHours",
      label: "Duración consecutiva · horas",
      step: 1,
      min: 1,
      max: 12,
    },
    {
      key: "rain",
      label: "Lluvia durante el ensayo · mm",
      step: 0.1,
      min: 0,
      max: 20,
    },
    {
      key: "rain24Limit",
      label: "Lluvia del día anterior: menor a · mm",
      step: 0.1,
      min: 0.1,
      max: 300,
    },
    {
      key: "startHour",
      label: "Inicio de jornada · hora",
      step: 1,
      min: 0,
      max: 23,
    },
    {
      key: "endHour",
      label: "Fin de jornada · hora",
      step: 1,
      min: 1,
      max: 24,
    },
  ];
  return (
    <form
      className="planning-rules"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const r = await fetch("/api/campaign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "rules", rules: draft }),
          });
          if (!r.ok)
            throw new Error(
              "Revisá los valores: la jornada debe permitir al menos un ensayo completo.",
            );
          await onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "No se pudo guardar");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Criterios del ensayo</h2>
      <div>
        {fields.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              type="number"
              required
              min={f.min}
              max={f.max}
              step={f.step}
              value={draft[f.key]}
              onChange={(e) =>
                setDraft({ ...draft, [f.key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <label>
          Fin de campaña
          <input
            type="date"
            required
            value={draft.deadline}
            onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
          />
        </label>
      </div>
      <p>
        Al cambiar criterios se recalculan los resultados. La validación usa
        únicamente registros emitidos con esos mismos criterios.
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Guardando…" : "Guardar y recalcular"}
      </button>
    </form>
  );
}
