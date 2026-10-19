"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CloudSun,
  Compass,
  Flag,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sprout,
  Target,
  Tractor,
  Upload,
  Users,
  Wind,
  X,
} from "lucide-react";
import {
  addDays,
  DayDecision,
  defaultRules,
  PivotPlan,
  Rules,
} from "@/domain/types";
import { projectCampaign, recommendCrewAssignments } from "@/domain/planning";
const PivotMap = dynamic(() => import("./PivotMap"), {
  ssr: false,
  loading: () => (
    <div className="map-canvas map-loading">Cargando cartografía…</div>
  ),
});
type Data = {
  plans: PivotPlan[];
  rules: Rules;
  campaign: ReturnType<typeof projectCampaign>;
  today: string;
  updatedAt?: string;
  storage: string;
};
type Tab =
  "Operaciones" | "Planificador" | "Campaña" | "Equipos" | "Configuración";
const fmt = (n: number) => new Intl.NumberFormat("es-AR").format(n);
const dayLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) =>
  new Intl.DateTimeFormat("es-AR", { ...options, timeZone: "UTC" }).format(
    new Date(date + "T12:00:00Z"),
  );
const tone = (condition?: string) =>
  condition === "APTO"
    ? "green"
    : condition === "RIESGO"
      ? "amber"
      : condition === "NO APTO"
        ? "red"
        : "gray";
export default function Dashboard({
  initialTab = "Operaciones",
}: { initialTab?: Tab } = {}) {
  const [data, setData] = useState<Data | null>(null),
    [tab, setTab] = useState<Tab>(initialTab),
    [date, setDate] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("Todos"),
    [selected, setSelected] = useState<PivotPlan | null>(null),
    [modal, setModal] = useState(false),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [rules, setRules] = useState<Rules>(defaultRules),
    [mapUrl, setMapUrl] = useState(
      "https://www.google.com/maps/d/viewer?mid=1XjGPX2pxGOVbN53k-B6TIUnDzWAA_P4",
    );
  const load = useCallback(async () => {
    const res = await fetch("/api/campaign");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    setData(json);
    setRules(json.rules);
    setDate((d) => d || addDays(json.today, 1));
    setSelected((old) =>
      old
        ? (json.plans.find((p: PivotPlan) => p.pivot.id === old.pivot.id) ??
          null)
        : null,
    );
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const action = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ocurrió un error.");
    } finally {
      setBusy("");
    }
  };
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return json;
  };
  const refresh = () =>
    action("Actualizando pronósticos", async () => {
      if (!data?.plans.length)
        throw new Error("Importá equipos para consultar el clima.");
      let failures = 0;
      const warnings: string[] = [];
      for (let i = 0; i < data.plans.length; i += 15) {
        const batch = data.plans.slice(i, i + 15);
        setBusy(
          `Consultando clima ${Math.min(i + 15, data.plans.length)}/${data.plans.length}`,
        );
        try {
          const result = await post("/api/weather", {
            pivotIds: batch.map((p) => p.pivot.id),
          });
          if (result.warnings?.length) warnings.push(...result.warnings);
        } catch (e) {
          failures += batch.length;
          if (warnings.length < 3)
            warnings.push(e instanceof Error ? e.message : "Error");
        }
      }
      setNotice(
        `Consulta terminada · ${data.plans.length - failures} equipos con datos · ${failures} fallas.${warnings.length ? " Hay modelos no disponibles. Revisá el detalle de cada equipo." : ""}`,
      );
    });
  const importFile = (file: File) =>
    action("Importando equipos", async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setNotice(
        `${json.added} equipos incorporados; los duplicados conservaron sus estados.`,
      );
      setModal(false);
    });
  const patchPivot = (p: PivotPlan, patch: Partial<PivotPlan["pivot"]>) =>
    action("Guardando equipo", async () => {
      await post("/api/campaign", {
        action: "pivot",
        pivot: { ...p.pivot, ...patch },
      });
      setNotice("Equipo actualizado.");
    });
  const c = data?.campaign;
  const locationIssues = data?.plans.filter((p) => p.locationWarning) ?? [];
  const plans = (data?.plans ?? [])
    .filter(
      (p) =>
        `${p.pivot.name} ${p.pivot.field} ${p.cluster}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "Todos" ||
          (filter === "Pendientes" && p.pivot.status === "PENDIENTE") ||
          (filter === "Programados" && p.pivot.status === "PROGRAMADO") ||
          (filter === "Terminados" && p.pivot.status === "TERMINADO")),
    )
    .sort(
      (a, b) =>
        (b.days.find((d) => d.date === date)?.priority ?? 0) -
        (a.days.find((d) => d.date === date)?.priority ?? 0),
    );
  const recommendations = plans
    .filter(
      (p) =>
        p.pivot.status !== "TERMINADO" &&
        (p.days.find((d) => d.date === date)?.priority ?? 0) > 0,
    )
    .slice(0, 4);
  const best = recommendations[0];
  const bestDay = best?.days.find((d) => d.date === date);
  const operable = plans.filter(
    (p) => p.days.find((d) => d.date === date)?.condition === "APTO",
  ).length;
  const atRisk = plans.filter(
    (p) =>
      p.pivot.status !== "TERMINADO" &&
      p.days.filter((d) => d.window && d.window.probability >= 50).length < 2,
  ).length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Sprout size={24} />
          </span>
          climato<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">ESPACIO DE TRABAJO</div>
        <div className="workspace">
          <span className="workspace-icon">
            <Tractor size={19} />
          </span>
          <div>
            Campaña de uniformidad<small>Operaciones de campo</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-caption">PLANIFICACIÓN</div>
        <nav>
          {(
            [
              { name: "Operaciones", icon: LayoutDashboard },
              { name: "Planificador", icon: CalendarDays },
              { name: "Campaña", icon: Flag },
              { name: "Equipos", icon: MapPin },
            ] as const
          ).map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={tab === name ? "nav-item active" : "nav-item"}
              onClick={() => setTab(name)}
            >
              <Icon size={18} />
              {name}
              {name === "Equipos" && (
                <span className="nav-count">{c?.total ?? 0}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="deadline-card">
            <span>
              <Flag size={15} /> OBJETIVO DE CAMPAÑA
            </span>
            <strong>
              {dayLabel(rules.deadline, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </strong>
            <div>
              <i
                style={{
                  width: `${c?.total ? (c.completed / c.total) * 100 : 0}%`,
                }}
              />
            </div>
            <small>
              {c?.completed ?? 0} de {c?.total ?? 0} equipos completados
            </small>
          </div>
          <button
            className={tab === "Configuración" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("Configuración")}
          >
            <Settings2 size={18} />
            Configuración
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setTab("Campaña");
              setNotice(
                "Las proyecciones usan escenarios configurables. Revisá los supuestos y la cobertura antes de asignar cuadrillas.",
              );
            }}
          >
            <CircleHelp size={18} />
            Acerca de los cálculos
          </button>
          <div className="profile">
            <div className="avatar">TL</div>
            <div>
              Territory Leader<small>Gestión de campaña</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Campaña 2026 <ChevronRight size={14} />
            <strong>{tab}</strong>
          </div>
          <div className="topbar-right">
            <span className="source-status">
              <i />
              {data?.updatedAt
                ? "Pronóstico consultado"
                : "Sin pronóstico consultado"}
            </span>
            <span className="top-date">
              {data?.today
                ? dayLabel(data.today, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "2026"}
            </span>
            <div className="avatar small">TL</div>
          </div>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div className="eyebrow">OPERACIONES INTERNAS</div>
            <div className="heading-row">
              <div>
                <h1>
                  {tab === "Operaciones"
                    ? "Operaciones"
                    : tab === "Planificador"
                      ? "Planificador"
                      : tab === "Campaña"
                        ? "Campaña"
                        : tab === "Equipos"
                          ? "Equipos"
                          : "Reglas operativas"}
                </h1>
                <p>
                  {tab === "Operaciones"
                    ? "Disponibilidad y programación de equipos."
                    : tab === "Configuración"
                      ? "Ajustá capacidad, condiciones de ensayo y supuestos de proyección."
                      : "Planificá con el clima disponible y la capacidad real de tus cuadrillas."}
                </p>
              </div>
              <div className="heading-actions">
                <button
                  className="button secondary"
                  onClick={() => setModal(true)}
                >
                  <Upload size={16} />
                  Importar equipos
                </button>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={refresh}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Actualizar clima
                </button>
              </div>
            </div>
          </div>
          {(error || notice || busy) && (
            <div
              role="status"
              className={`notice ${error ? "notice-error" : ""}`}
            >
              {busy ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  {busy}
                </>
              ) : (
                error || notice
              )}
              <button
                aria-label="Cerrar mensaje"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!data && !error && (
            <div className="loading">
              <LoaderCircle className="spin" /> Preparando campaña…
            </div>
          )}
          {data && c && (
            <>
              <div className="campaign-strip">
                <div className="campaign-strip-title">
                  <span className="mini-icon">
                    <Flag size={17} />
                  </span>
                  <strong>
                    Campaña de uniformidad <span>2026</span>
                  </strong>
                  <span
                    className={`badge ${c.status === "EN TIEMPO" ? "green" : c.status === "CRÍTICO" ? "red" : c.status === "SIN DATOS" ? "gray" : "amber"}`}
                  >
                    <i />
                    {c.status}
                  </span>
                </div>
                <span className="deadline-text">
                  Objetivo:{" "}
                  {dayLabel(rules.deadline, { day: "numeric", month: "long" })}
                  <span className="vertical-line" />
                  {c.remaining} días restantes
                </span>
              </div>
              <div className="metrics">
                <Metric
                  label="AVANCE DE CAMPAÑA"
                  icon={<Target size={17} />}
                  value={`${c.total ? Math.round((c.completed / c.total) * 100) : 0}%`}
                  sub={`${fmt(c.completed)} terminados de ${fmt(c.total)} pivots`}
                  progress={c.total ? (c.completed / c.total) * 100 : 0}
                />
                <Metric
                  label="TRABAJOS PENDIENTES"
                  icon={<Layers size={17} />}
                  value={fmt(c.pending)}
                  sub={`${c.capacity} trabajos / día · ${rules.crews} cuadrillas`}
                />
                <Metric
                  label="JORNADAS NECESARIAS"
                  icon={<CalendarDays size={17} />}
                  value={String(c.required)}
                  suffix="días"
                  sub={`${c.scenarios[1].effective} jornadas esperadas hasta el objetivo`}
                  hint="Estimación con supuestos"
                />
                <Metric
                  label="CUMPLIMIENTO ESTIMADO"
                  icon={<Activity size={17} />}
                  value={c.probability === null ? "—" : `${c.probability}%`}
                  sub={
                    c.scenarios[1].finish
                      ? `Finalización base: ${dayLabel(c.scenarios[1].finish)}`
                      : "Finalización fuera del horizonte"
                  }
                  hint="Estimación anterior deshabilitada; ver simulación"
                />
              </div>
              {tab === "Operaciones" && (
                <>
                  {!!locationIssues.length && (
                    <div className="notice notice-error">
                      <ShieldAlert size={16} />
                      <span>
                        {locationIssues.length} ubicación requiere revisión:{" "}
                        {locationIssues.map((p) => p.pivot.name).join(", ")}.
                        Excluida de recomendaciones.
                      </span>
                      <button onClick={() => setSelected(locationIssues[0])}>
                        Revisar <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  <div className="recommendation-banner">
                    <div className="banner-icon">
                      <Compass size={23} />
                    </div>
                    <div>
                      <span className="eyebrow">RECOMENDACIÓN OPERATIVA</span>
                      <h3>
                        {best
                          ? `Aprovechá la ventana en ${best.cluster}`
                          : c.total
                            ? "Actualizá el clima para encontrar la próxima oportunidad"
                            : "Importar equipos para empezar a planificar"}
                      </h3>
                      <p>
                        {best
                          ? `${best.nearby} equipos pendientes en el grupo · ${bestDay?.window?.start.slice(11, 16)}–${bestDay?.window?.end.slice(11, 16)} · Confirmá acceso y capacidad antes de salir.`
                          : c.total
                            ? "Las recomendaciones aparecen cuando hay ventanas horarias y cobertura suficiente."
                            : "Importá las ubicaciones de Google My Maps o un archivo geográfico."}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        best
                          ? setSelected(best)
                          : c.total
                            ? refresh()
                            : setModal(true)
                      }
                    >
                      {best
                        ? "Ver recomendación"
                        : c.total
                          ? "Consultar pronósticos"
                          : "Cargar equipos"}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <section
                    className="crew-assignments"
                    aria-label="Propuesta por cuadrilla"
                  >
                    {recommendCrewAssignments(data.plans, date, rules).map(
                      (assignment) => (
                        <article
                          className="crew-assignment"
                          key={assignment.crew}
                        >
                          <span className="crew-avatar">
                            <Users size={17} />
                          </span>
                          <div>
                            <span className="eyebrow">
                              CUADRILLA {assignment.crew} · {dayLabel(date)}
                            </span>
                            <h3>
                              {assignment.cluster ?? "Sin ventana recomendada"}
                            </h3>
                            <p>
                              {assignment.jobs.length
                                ? `${assignment.jobs.length} trabajos sugeridos · ${assignment.hasBlockedBooking ? "Revisar asignación: condiciones no aptas" : assignment.needsAccessCheck ? "Validar acceso antes de salir" : "Acceso apto estimado"}`
                                : "Revisá otra fecha o actualizá la cobertura."}
                            </p>
                            <div className="crew-jobs">
                              {assignment.jobs.map((p) => (
                                <button
                                  key={p.pivot.id}
                                  onClick={() => setSelected(p)}
                                >
                                  {p.pivot.name}
                                  <ArrowRight size={11} />
                                </button>
                              ))}
                            </div>
                          </div>
                        </article>
                      ),
                    )}
                  </section>
                  <div className="operations-grid">
                    <section className="panel map-panel">
                      <div className="panel-header">
                        <div>
                          <h2>Panorama operativo</h2>
                          <p>
                            Condiciones por equipo para la jornada seleccionada
                          </p>
                        </div>
                        <div className="date-selector">
                          <button
                            aria-label="Día anterior"
                            onClick={() => setDate(addDays(date, -1))}
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <input
                            aria-label="Fecha del mapa"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                          />
                          <button
                            aria-label="Día siguiente"
                            onClick={() => setDate(addDays(date, 1))}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="map-wrap">
                        <PivotMap
                          plans={plans}
                          date={date}
                          onSelect={setSelected}
                        />
                        <div className="map-overlay">
                          <span className="pulse-dot" /> {fmt(plans.length)}{" "}
                          equipos en el territorio
                        </div>
                        {!plans.length && (
                          <div className="map-empty">
                            <MapPin size={26} />
                            <strong>Tu próxima campaña empieza acá</strong>
                            <span>
                              Cargá las ubicaciones reales de tus pivots.
                            </span>
                            <button
                              className="button primary"
                              onClick={() => setModal(true)}
                            >
                              Importar equipos <Plus size={15} />
                            </button>
                          </div>
                        )}
                        <div className="map-key">
                          <span>
                            <i className="dot green" />
                            Apto
                          </span>
                          <span>
                            <i className="dot amber" />
                            Con riesgo
                          </span>
                          <span>
                            <i className="dot red" />
                            No apto
                          </span>
                          <span>
                            <i className="dot gray" />
                            Sin datos
                          </span>
                          <span>
                            <i className="dot blue" />
                            Programado
                          </span>
                        </div>
                      </div>
                      <div className="map-footer">
                        <span>
                          <ShieldAlert size={14} />
                          El acceso requiere validación en campo.
                        </span>
                        <span>
                          {operable} equipos aptos <ArrowRight size={13} />
                        </span>
                      </div>
                    </section>
                    <section className="panel priorities">
                      <div className="panel-header">
                        <div>
                          <h2>Prioridad de trabajo</h2>
                          <p>Ventanas que conviene aprovechar</p>
                        </div>
                        <span className="round-count">
                          {recommendations.length}
                        </span>
                      </div>
                      <div className="priority-list">
                        {recommendations.length ? (
                          recommendations.map((p, i) => {
                            const d = p.days.find((d) => d.date === date)!;
                            return (
                              <button
                                className="priority-card"
                                key={p.pivot.id}
                                onClick={() => setSelected(p)}
                              >
                                <div className="priority-card-top">
                                  <span className="rank">0{i + 1}</span>
                                  <span
                                    className={`badge ${tone(d.condition)}`}
                                  >
                                    {d.condition}
                                  </span>
                                  <span className="priority-score">
                                    {d.priority}
                                    <small>/100</small>
                                  </span>
                                </div>
                                <strong>{p.pivot.name}</strong>
                                <span className="field-name">
                                  <MapPin size={12} />
                                  {p.pivot.field || p.cluster}
                                </span>
                                <div className="window-summary">
                                  <CloudSun size={16} />
                                  {d.window?.start.slice(11, 16)}–
                                  {d.window?.end.slice(11, 16)}
                                  <b>{d.window?.probability}%</b>
                                </div>
                                <p>
                                  {d.futureWindows < 3
                                    ? "Pocas ventanas futuras. Conviene aprovechar esta oportunidad."
                                    : `${p.nearby} equipos pendientes en esta zona.`}
                                </p>
                              </button>
                            );
                          })
                        ) : (
                          <div className="empty-priority">
                            <Compass size={30} />
                            <h3>La próxima decisión, con datos.</h3>
                            <p>
                              {c.total
                                ? "Consultá el pronóstico. Si no hay condiciones aptas, revisá otras jornadas."
                                : "Al cargar equipos y consultar el clima, encontrarás aquí las prioridades."}
                            </p>
                            <span>CALIDAD × ESCASEZ × URGENCIA</span>
                          </div>
                        )}
                      </div>
                      <button
                        className="panel-link"
                        onClick={() => setTab("Planificador")}
                      >
                        Abrir planificador de 14 días <ArrowRight size={15} />
                      </button>
                    </section>
                  </div>
                  <div className="lower-grid">
                    <section className="panel weekly-panel">
                      <div className="panel-header">
                        <div>
                          <h2>Próximos 7 días</h2>
                          <p>Oportunidades dentro del pronóstico disponible</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setTab("Planificador")}
                        >
                          Ver planificador <ArrowRight size={14} />
                        </button>
                      </div>
                      <div className="week-cards">
                        {Array.from({ length: 7 }, (_, i) => {
                          const dt = addDays(data.today, i);
                          const ds = data.plans.map((p) =>
                            p.days.find((d) => d.date === dt),
                          );
                          const windows = ds.filter(
                            (d) => d?.window && d.road.condition !== "NO APTO",
                          );
                          const covered = ds.some((d) => d?.coverage);
                          return (
                            <button
                              className={
                                date === dt ? "week-card selected" : "week-card"
                              }
                              key={dt}
                              onClick={() => setDate(dt)}
                            >
                              <span>
                                {i === 0
                                  ? "HOY"
                                  : dayLabel(dt, {
                                      weekday: "short",
                                    }).toUpperCase()}
                              </span>
                              <strong>
                                {dayLabel(dt, { day: "numeric" })}
                              </strong>
                              <CloudSun
                                size={23}
                                className={
                                  windows.length
                                    ? "weather-gold"
                                    : "weather-muted"
                                }
                              />
                              <b>
                                {covered ? windows.length : "—"}
                                <small>
                                  {" "}
                                  {covered ? "ventanas" : "sin datos"}
                                </small>
                              </b>
                              <div className="day-bar">
                                <i
                                  style={{
                                    width: `${data.plans.length ? (windows.length / data.plans.length) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                    <section className="panel alerts-panel">
                      <div className="panel-header">
                        <div>
                          <h2>En el radar</h2>
                          <p>Lo que necesita tu atención</p>
                        </div>
                        <ShieldAlert size={18} />
                      </div>
                      <div className="alert-item">
                        <span className="alert-dot amber" />
                        <div>
                          <strong>{atRisk} equipos con pocas ventanas</strong>
                          <p>
                            {data.updatedAt
                              ? "Menos de 2 oportunidades en el horizonte consultado."
                              : "Aún no hay cobertura meteorológica para evaluarlos."}
                          </p>
                        </div>
                      </div>
                      <div className="alert-item">
                        <span className="alert-dot green" />
                        <div>
                          <strong>
                            Capacidad: {c.capacity} trabajos por día
                          </strong>
                          <p>
                            {c.requiredCapacity === null
                              ? "Configurá tus supuestos de disponibilidad."
                              : `Se necesitan ${c.requiredCapacity} trabajos por jornada esperada.`}
                          </p>
                        </div>
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === "Planificador" && (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2>Planificador operativo · {rules.horizon} días</h2>
                      <p>
                        Ordenado por prioridad para {dayLabel(date)}. Más allá
                        de 7 días disminuye la confianza; las fechas sin datos
                        quedan vacías.
                      </p>
                    </div>
                    <input
                      type="date"
                      aria-label="Fecha de prioridad"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div className="table-scroll">
                    <table className="planner">
                      <thead>
                        <tr>
                          <th>Equipo / zona</th>
                          {Array.from({ length: rules.horizon }, (_, i) => (
                            <th key={i}>
                              {dayLabel(addDays(data.today, i), {
                                weekday: "short",
                              })}
                              <strong>
                                {dayLabel(addDays(data.today, i))}
                              </strong>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {plans.map((p) => (
                          <tr key={p.pivot.id}>
                            <th>
                              <button
                                className="table-name"
                                onClick={() => setSelected(p)}
                              >
                                {p.pivot.name}
                              </button>
                              <small>
                                {p.cluster} · {p.pivot.status}
                              </small>
                            </th>
                            {p.days.map((d) => (
                              <td key={d.date}>
                                <button
                                  onClick={() => {
                                    setDate(d.date);
                                    setSelected(p);
                                  }}
                                  className={`planner-cell ${tone(d.condition)}`}
                                >
                                  <b>
                                    {p.pivot.status === "TERMINADO"
                                      ? "✓ TERMINADO"
                                      : d.condition}
                                  </b>
                                  {d.window ? (
                                    <>
                                      <span>
                                        {d.window.start.slice(11, 16)}–
                                        {d.window.end.slice(11, 16)}
                                      </span>
                                      <strong>
                                        {d.window.probability}%{" "}
                                        <small>C {d.window.confidence}%</small>
                                      </strong>
                                    </>
                                  ) : (
                                    <span>
                                      {d.coverage
                                        ? "Sin ventana"
                                        : "Sin cobertura"}
                                    </span>
                                  )}
                                </button>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!plans.length && <Empty onImport={() => setModal(true)} />}
                  </div>
                </section>
              )}
              {tab === "Equipos" && (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2>Equipos de la campaña</h2>
                      <p>
                        Ubicaciones importadas · estados y acceso registrados
                        por el Territory Leader
                      </p>
                    </div>
                    <a className="button secondary" href="/api/export">
                      <ArrowDownToLine size={15} />
                      Exportar respaldo
                    </a>
                  </div>
                  <div className="table-toolbar">
                    <div className="search">
                      <Search size={16} />
                      <input
                        placeholder="Buscar equipo, establecimiento o zona…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <div className="filter-tabs">
                      {["Todos", "Pendientes", "Programados", "Terminados"].map(
                        (f) => (
                          <button
                            className={filter === f ? "selected" : ""}
                            key={f}
                            onClick={() => setFilter(f)}
                          >
                            {f}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="equipment-table">
                      <thead>
                        <tr>
                          <th>Equipo / establecimiento</th>
                          <th>Ubicación</th>
                          <th>Zona</th>
                          <th>Estado</th>
                          <th>Acceso manual</th>
                          <th>Prioridad</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {plans.map((p) => (
                          <tr key={p.pivot.id}>
                            <td>
                              <strong>{p.pivot.name}</strong>
                              <small>
                                {p.pivot.field || "Sin establecimiento"}
                              </small>
                            </td>
                            <td>
                              {p.pivot.lat.toFixed(4)}, {p.pivot.lon.toFixed(4)}
                            </td>
                            <td>{p.cluster}</td>
                            <td>
                              <span
                                className={`badge ${p.pivot.status === "TERMINADO" ? "green" : p.pivot.status === "PROGRAMADO" ? "blue" : "gray"}`}
                              >
                                {p.pivot.status}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`badge ${p.pivot.road === "APTO" ? "green" : p.pivot.road === "NO APTO" ? "red" : "gray"}`}
                              >
                                {p.pivot.road}
                              </span>
                            </td>
                            <td>
                              {p.days.find((d) => d.date === date)?.priority ??
                                0}
                              /100
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => setSelected(p)}
                              >
                                Ver detalle <ArrowRight size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!plans.length && <Empty onImport={() => setModal(true)} />}
                  </div>
                </section>
              )}
              {tab === "Configuración" && (
                <form
                  className="settings-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action("Guardando configuración", async () => {
                      await post("/api/campaign", { action: "rules", rules });
                      setNotice(
                        "Reglas guardadas. Ventanas y proyecciones recalculadas.",
                      );
                    });
                  }}
                >
                  <section className="panel settings-panel">
                    <div className="settings-title">
                      <Wind size={21} />
                      <div>
                        <h2>Condiciones del ensayo</h2>
                        <p>
                          Reglas para detectar intervalos horarios continuos
                        </p>
                      </div>
                    </div>
                    <div className="settings-fields">
                      <NumberField
                        label="Probabilidad mínima para recomendar (%)"
                        field="minimumProbability"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Viento máximo (km/h)"
                        field="wind"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Duración mínima (horas)"
                        field="minHours"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Precipitación máxima por día (mm)"
                        field="rain"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Inicio de jornada (hora local)"
                        field="startHour"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Fin de jornada (hora local)"
                        field="endHour"
                        rules={rules}
                        setRules={setRules}
                      />
                    </div>
                  </section>
                  <section className="panel settings-panel">
                    <div className="settings-title">
                      <Users size={21} />
                      <div>
                        <h2>Capacidad y campaña</h2>
                        <p>
                          Capacidad diaria simplificada, sin optimización de
                          rutas
                        </p>
                      </div>
                    </div>
                    <div className="settings-fields">
                      <NumberField
                        label="Cantidad de cuadrillas"
                        field="crews"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Trabajos por cuadrilla / día"
                        field="jobsPerCrew"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Horizonte del planificador (1–35 días)"
                        field="horizon"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Distancia de agrupación (km)"
                        field="clusterKm"
                        rules={rules}
                        setRules={setRules}
                      />
                      <label>
                        Deadline de campaña
                        <input
                          type="date"
                          value={rules.deadline}
                          onChange={(e) =>
                            setRules({ ...rules, deadline: e.target.value })
                          }
                          required
                        />
                      </label>
                    </div>
                  </section>
                  <section className="panel settings-panel">
                    <div className="settings-title">
                      <ShieldAlert size={21} />
                      <div>
                        <h2>Acceso y escenarios</h2>
                        <p>
                          Supuestos iniciales: requieren validación con datos
                          históricos de cada región
                        </p>
                      </div>
                    </div>
                    <div className="settings-fields">
                      <NumberField
                        label="Umbral lluvia 24 h (mm)"
                        field="rain24Limit"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Umbral lluvia 72 h (mm)"
                        field="rain72Limit"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Umbral humedad suelo (m³/m³)"
                        field="soilLimit"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Disponibilidad futura supuesta (0–1)"
                        field="historicalAvailability"
                        rules={rules}
                        setRules={setRules}
                      />
                      <NumberField
                        label="Factor estacional supuesto (0–2)"
                        field="seasonalAdjustment"
                        rules={rules}
                        setRules={setRules}
                      />
                    </div>
                  </section>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={!!busy}
                  >
                    <Check size={16} />
                    Guardar y recalcular
                  </button>
                </form>
              )}
              <footer className="app-footer">
                <span>
                  <Sprout size={13} /> Climato · Decisiones de campo, con
                  perspectiva.
                </span>
                <span>
                  {data.storage} ·{" "}
                  {data.updatedAt
                    ? `Consulta: ${new Date(data.updatedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`
                    : "Sin datos meteorológicos cargados"}
                </span>
              </footer>
            </>
          )}
        </div>
      </main>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="close"
              aria-label="Cerrar importación"
              onClick={() => setModal(false)}
            >
              <X />
            </button>
            <span className="modal-icon">
              <Upload size={24} />
            </span>
            <h2>Importar equipos</h2>
            <p>
              Importá ubicaciones reales. Los equipos existentes conservan su
              estado y las condiciones registradas.
            </p>
            <label className="upload-zone">
              <Upload size={27} />
              <strong>Seleccionar archivo</strong>
              <span>CSV · GeoJSON · KML · KMZ / hasta 10 MB</span>
              <input
                type="file"
                accept=".csv,.geojson,.json,.kml,.kmz"
                disabled={!!busy}
                onChange={(e) => {
                  if (e.target.files?.[0]) importFile(e.target.files[0]);
                }}
              />
            </label>
            <small className="csv-hint">
              CSV: name, field, lat, lon (o nombre, establecimiento, latitud,
              longitud).
            </small>
            <div className="import-divider">o desde Google My Maps</div>
            <label>
              Enlace del mapa
              <input
                type="url"
                value={mapUrl}
                onChange={(e) => setMapUrl(e.target.value)}
              />
            </label>
            <button
              className="button primary full"
              disabled={!!busy}
              onClick={() =>
                action("Importando mapa", async () => {
                  const result = await post("/api/import", { url: mapUrl });
                  setNotice(
                    `${result.added} equipos importados desde el mapa.`,
                  );
                  setModal(false);
                })
              }
            >
              Importar ubicaciones <ArrowRight size={16} />
            </button>
            {error && <p className="inline-error">{error}</p>}
          </section>
        </div>
      )}
      {selected && (
        <Detail
          plan={selected}
          date={date}
          busy={!!busy}
          onClose={() => setSelected(null)}
          onSave={(patch) => patchPivot(selected, patch)}
          crews={rules.crews}
        />
      )}
    </div>
  );
}
function Metric({
  label,
  icon,
  value,
  sub,
  suffix,
  progress,
  hint,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  sub: string;
  suffix?: string;
  progress?: number;
  hint?: string;
}) {
  return (
    <section className="metric">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <div className="metric-value">
        {value}
        <span>{suffix}</span>
      </div>
      {progress !== undefined && (
        <div className="progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
      <p>{sub}</p>
      {hint && <small>{hint}</small>}
    </section>
  );
}
function Empty({ onImport }: { onImport: () => void }) {
  return (
    <div className="empty-table">
      <MapPin size={28} />
      <h3>Todavía no hay equipos</h3>
      <p>Cargá las ubicaciones para iniciar la planificación real.</p>
      <button className="button primary" onClick={onImport}>
        Importar equipos
      </button>
    </div>
  );
}
function NumberField({
  label,
  field,
  rules,
  setRules,
}: {
  label: string;
  field: Exclude<keyof Rules, "deadline">;
  rules: Rules;
  setRules: (r: Rules) => void;
}) {
  return (
    <label>
      {label}
      <input
        required
        type="number"
        step={
          [
            "soilLimit",
            "historicalAvailability",
            "seasonalAdjustment",
            "rain",
          ].includes(field)
            ? "0.01"
            : "1"
        }
        min="0"
        value={rules[field]}
        onChange={(e) =>
          setRules({ ...rules, [field]: Number(e.target.value) })
        }
      />
    </label>
  );
}
export function Detail({
  plan,
  date,
  busy,
  onClose,
  onSave,
  crews,
}: {
  plan: PivotPlan;
  date: string;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: Partial<PivotPlan["pivot"]>) => void;
  crews: number;
}) {
  const p = plan.pivot;
  const d: DayDecision | undefined = plan.days.find((d) => d.date === date);
  const nextWindow = plan.days.find(
    (day) => day.date >= date && day.window && day.condition !== "NO APTO",
  )?.window;
  const [status, setStatus] = useState(p.status),
    [road, setRoad] = useState(p.road),
    [comment, setComment] = useState(p.roadComment ?? ""),
    [schedule, setSchedule] = useState(p.scheduledDate ?? date),
    [crew, setCrew] = useState(p.crew ?? 1),
    [lat, setLat] = useState(p.lat),
    [lon, setLon] = useState(p.lon);
  useEffect(() => {
    setStatus(p.status);
    setRoad(p.road);
    setComment(p.roadComment ?? "");
    setLat(p.lat);
    setLon(p.lon);
  }, [p]);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="detail-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span className="eyebrow">DETALLE OPERATIVO</span>
          <button aria-label="Cerrar detalle" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
        <h2>{p.name}</h2>
        <p>
          {p.field || plan.cluster} · {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
        </p>
        {plan.locationWarning && (
          <div className="notice notice-error">{plan.locationWarning}</div>
        )}
        <div className="detail-window">
          <span className={`badge ${tone(d?.condition)}`}>
            {d?.condition ?? "DESCONOCIDO"}
          </span>
          <h3>
            {d?.window
              ? `${d.window.start.slice(11, 16)}–${d.window.end.slice(11, 16)}`
              : "Sin ventana disponible"}
          </h3>
          <span>
            {dayLabel(date, { weekday: "long", day: "numeric", month: "long" })}
          </span>
          <p>
            {d?.window
              ? `${d.window.hours} horas · ${d.window.probability}% estimado · confianza ${d.window.confidence}%`
              : d?.coverage
                ? "No cumple las reglas actuales."
                : "No hay datos para evaluar esta jornada."}
          </p>
        </div>
        <div className="detail-stats">
          {[
            [
              "Próxima ventana posible",
              nextWindow
                ? `${dayLabel(nextWindow.start.slice(0, 10))} · ${nextWindow.start.slice(11, 16)}–${nextWindow.end.slice(11, 16)}`
                : "Sin ventana en el horizonte",
            ],
            ["Prioridad", `${d?.priority ?? 0}/100`],
            [
              "Evidencia",
              d?.window?.basis === "ensemble"
                ? `${d.window.members} miembros · ${d.window.families} familias`
                : "Modelos determinísticos",
            ],
            [
              "Acuerdo viento + lluvia",
              d?.window?.windRainAgreement !== undefined
                ? `${d.window.windRainAgreement}% (todas las fuentes)`
                : "—",
            ],
            ["Costo de oportunidad", `${d?.opportunity ?? 0}/100`],
            [
              "Viento máx. favorable",
              d?.window ? `${d.window.wind} km/h` : "—",
            ],
            [
              "Ráfaga máx. favorable",
              d?.window ? `${d.window.gust} km/h` : "—",
            ],
            [
              "Precipitación favorable",
              d?.window ? `${d.window.rain} mm/h` : "—",
            ],
            ["Acceso al campo", d?.road.condition ?? "DESCONOCIDO"],
            [
              "Lluvia previa 24 / 48 / 72 h",
              d?.road.rain24 !== null && d?.road.rain24 !== undefined
                ? `${d.road.rain24.toFixed(1)} / ${d.road.rain48?.toFixed(1)} / ${d.road.rain72?.toFixed(1)} mm`
                : "Sin historia completa",
            ],
            [
              "Humedad del suelo",
              d?.road.soil != null
                ? `${d.road.soil.toFixed(3)} m³/m³`
                : "No disponible",
            ],
            [
              "Riesgo automático de acceso",
              d?.road.score != null ? `${d.road.score}/100` : "Desconocido",
            ],
            ["Oportunidades posteriores", String(d?.futureWindows ?? 0)],
            [
              "Riesgo de atraso local",
              (d?.futureWindows ?? 0) < 2
                ? "Alto · pocas ventanas"
                : "Revisar con avance real",
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="detail-explanation">
          <Compass size={18} />
          <p>{d?.explanation ?? "Sin información para esta fecha."}</p>
        </div>
        {plan.error && (
          <p className="provider-warning">Proveedor: {plan.error}</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              lat,
              lon,
              status,
              road,
              roadComment: comment,
              ...(status === "PROGRAMADO"
                ? { scheduledDate: schedule, crew }
                : {}),
            });
          }}
        >
          <h3>Registro de campo</h3>
          <div className="schedule-fields">
            <label>
              Latitud
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                required
                value={lat}
                onChange={(e) => setLat(Number(e.target.value))}
              />
            </label>
            <label>
              Longitud
              <input
                type="number"
                step="any"
                min="-180"
                max="180"
                required
                value={lon}
                onChange={(e) => setLon(Number(e.target.value))}
              />
            </label>
          </div>
          {(lat !== p.lat || lon !== p.lon) && (
            <p className="provider-warning">
              Al guardar la ubicación, se invalida el pronóstico anterior.
              Consultá el clima nuevamente.
            </p>
          )}
          <label>
            Estado del trabajo
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option>PENDIENTE</option>
              <option>PROGRAMADO</option>
              <option>TERMINADO</option>
            </select>
          </label>
          {status === "PROGRAMADO" && (
            <div className="schedule-fields">
              <label>
                Fecha
                <input
                  type="date"
                  required
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                />
              </label>
              <label>
                Cuadrilla
                <select
                  value={crew}
                  onChange={(e) => setCrew(Number(e.target.value))}
                >
                  {Array.from({ length: crews }, (_, i) => (
                    <option key={i} value={i + 1}>
                      Cuadrilla {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label>
            Condición manual del camino
            <select
              value={road}
              onChange={(e) => setRoad(e.target.value as typeof road)}
            >
              <option>DESCONOCIDO</option>
              <option>APTO</option>
              <option>NO APTO</option>
            </select>
          </label>
          <label>
            Comentario del Territory Leader
            <textarea
              maxLength={1000}
              value={comment}
              placeholder="Validado con encargado, lluvia reciente, restricciones…"
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {p.roadUpdatedAt && (
            <small>
              Último registro:{" "}
              {new Date(p.roadUpdatedAt).toLocaleString("es-AR")}
            </small>
          )}
          <button disabled={busy} className="button primary full">
            <Check size={16} />
            Guardar registro
          </button>
        </form>
      </aside>
    </div>
  );
}
