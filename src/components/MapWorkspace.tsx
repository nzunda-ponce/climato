"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Map,
  CalendarDays,
  Flag,
  Database,
  Settings2,
  RefreshCw,
  Search,
  Layers,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  X,
  ListFilter,
  CloudRain,
  Wind,
  Navigation,
  Activity,
  Upload,
  AlertTriangle,
  SlidersHorizontal,
} from "lucide-react";
import Dashboard, { Detail } from "./Dashboard";
import { addDays, defaultRules, PivotPlan, Rules } from "@/domain/types";
import { layers, MapLayer } from "@/domain/map-layer";
import { projectCampaign } from "@/domain/planning";
import { simulateCampaign } from "@/domain/simulation";
import {
  Calibration,
  EnsembleAssessment,
  HistoricalClimate,
} from "@/domain/evidence";
const OperationalMap = dynamic(() => import("./OperationalMap"), {
  ssr: false,
  loading: () => <div className="map-wait">Cargando mapa…</div>,
});
type View =
  "Mapa" | "Planificador" | "Campaña" | "Equipos" | "Fuentes" | "Configuración";
interface CampaignData {
  plans: PivotPlan[];
  rules: Rules;
  campaign: ReturnType<typeof projectCampaign>;
  simulation: ReturnType<typeof simulateCampaign>;
  today: string;
  updatedAt?: string;
  evidence: { ensembles: number; climate: number; calibration: Calibration };
}
interface ResearchData {
  cells: { key: string; lat: number; lon: number }[];
  ensembles: (Omit<EnsembleAssessment, "paths" | "windows"> & {
    windows: number;
  })[];
  climate: Omit<HistoricalClimate, "days">[];
  calibration: Calibration;
}
const labelDate = (
  date: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric" },
) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", ...options }).format(
    new Date(date + "T12:00Z"),
  );
const colorClass = (condition?: string) =>
  condition === "APTO"
    ? "ok"
    : condition === "RIESGO"
      ? "risk"
      : condition === "NO APTO"
        ? "blocked"
        : "unknown";
export default function MapWorkspace() {
  const [data, setData] = useState<CampaignData | null>(null),
    [view, setView] = useState<View>("Mapa"),
    [date, setDate] = useState(""),
    [selected, setSelected] = useState<PivotPlan | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("Pendientes"),
    [layer, setLayer] = useState<MapLayer>("availability"),
    [heat, setHeat] = useState(true),
    [opacity, setOpacity] = useState(0.7),
    [listOpen, setListOpen] = useState(true),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [research, setResearch] = useState<ResearchData | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/campaign");
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    setData(d);
    setDate((date) => date || addDays(d.today, 1));
    setSelected((old) =>
      old
        ? (d.plans.find((p: PivotPlan) => p.pivot.id === old.pivot.id) ?? null)
        : null,
    );
  }, []);
  const loadResearch = useCallback(async () => {
    const res = await fetch("/api/research");
    if (!res.ok) throw new Error("No se pudo consultar el estado de fuentes");
    const d = await res.json();
    setResearch(d);
    return d as ResearchData;
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    const timer = setInterval(
      () => load().catch((e) => setError(e.message)),
      300000,
    );
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (view === "Fuentes") loadResearch().catch((e) => setError(e.message));
  }, [view, loadResearch]);
  useEffect(() => {
    if (!playing || !data) return;
    const timer = setInterval(
      () =>
        setDate((current) =>
          current >= addDays(data.today, data.rules.horizon - 1)
            ? data.today
            : addDays(current, 1),
        ),
      1400,
    );
    return () => clearInterval(timer);
  }, [playing, data]);
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    return d;
  };
  const refresh = async (kind: "forecast" | "ensemble" | "history") => {
    setBusy("Consultando fuentes");
    setError("");
    setMessage("");
    try {
      let failures = 0;
      if (kind === "forecast") {
        if (!data) throw new Error("Sin equipos");
        for (let i = 0; i < data.plans.length; i += 15) {
          setBusy(
            `Pronóstico ${Math.min(i + 15, data.plans.length)}/${data.plans.length}`,
          );
          try {
            await post("/api/weather", {
              pivotIds: data.plans.slice(i, i + 15).map((p) => p.pivot.id),
            });
          } catch {
            failures += data.plans.slice(i, i + 15).length;
          }
        }
      } else {
        const inventory = await loadResearch();
        for (let i = 0; i < inventory.cells.length; i++) {
          setBusy(
            `${kind === "ensemble" ? "Ensembles" : "Históricos"} ${i + 1}/${inventory.cells.length}`,
          );
          try {
            await post("/api/research", { kind, key: inventory.cells[i].key });
          } catch {
            failures++;
          }
        }
      }
      await load();
      await loadResearch();
      setMessage(
        failures
          ? `Carga parcial: ${failures} consultas fallaron. Ver detalle en Fuentes.`
          : "Datos actualizados.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de actualización");
    } finally {
      setBusy("");
    }
  };
  const onSave = async (patch: Partial<PivotPlan["pivot"]>) => {
    if (!selected) return;
    setBusy("Guardando");
    try {
      await post("/api/campaign", {
        action: "pivot",
        pivot: { ...selected.pivot, ...patch },
      });
      await load();
      setMessage("Registro guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setBusy("");
    }
  };
  const plans = useMemo(
    () =>
      data?.plans
        .filter(
          (p) =>
            `${p.pivot.name} ${p.pivot.field} ${p.pivot.province ?? ""}`
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (filter === "Todos" ||
              (filter === "Pendientes" && p.pivot.status !== "TERMINADO") ||
              (filter === "Programados" && p.pivot.status === "PROGRAMADO") ||
              (filter === "Terminados" && p.pivot.status === "TERMINADO") ||
              (filter === "Aptos" &&
                p.days.find((d) => d.date === date)?.condition === "APTO")),
        )
        .sort(
          (a, b) =>
            (b.days.find((d) => d.date === date)?.priority ?? 0) -
            (a.days.find((d) => d.date === date)?.priority ?? 0),
        ) ?? [],
    [data, search, filter, date],
  );
  const counts = {
    apto: plans.filter(
      (p) => p.days.find((d) => d.date === date)?.condition === "APTO",
    ).length,
    risk: plans.filter(
      (p) => p.days.find((d) => d.date === date)?.condition === "RIESGO",
    ).length,
    blocked: plans.filter(
      (p) => p.days.find((d) => d.date === date)?.condition === "NO APTO",
    ).length,
  };
  const currentLayer = layers.find((l) => l.id === layer)!;
  const issues = data?.plans.filter((p) => p.locationWarning) ?? [];
  return (
    <div className="console-app">
      <header className="console-header">
        <a className="console-brand" href="/">
          climato <span>OPERACIONES</span>
        </a>
        <nav aria-label="Vistas de operación">
          {(
            [
              { name: "Mapa", icon: Map },
              { name: "Planificador", icon: CalendarDays },
              { name: "Campaña", icon: Flag },
              { name: "Equipos", icon: Database },
              { name: "Fuentes", icon: Activity },
              { name: "Configuración", icon: Settings2 },
            ] as const
          ).map(({ name, icon: Icon }) => (
            <button
              title={name}
              className={view === name ? "selected" : ""}
              key={name}
              onClick={() => {
                setView(name);
                setPlaying(false);
                if (view !== "Mapa") load().catch((e) => setError(e.message));
              }}
            >
              <Icon size={15} />
              <span>{name === "Configuración" ? "Reglas" : name}</span>
            </button>
          ))}
        </nav>
        <div className="console-actions">
          <span className="internal-tag">INTERNO</span>
          <button
            className="console-update"
            disabled={!!busy}
            onClick={() => refresh("forecast")}
          >
            <RefreshCw size={14} className={busy ? "spin" : ""} />
            <span>{busy || "Actualizar"}</span>
          </button>
        </div>
      </header>
      {(error || message) && (
        <div className={`console-toast ${error ? "error" : ""}`} role="status">
          {error || message}
          <button
            aria-label="Cerrar aviso"
            onClick={() => {
              setError("");
              setMessage("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {view === "Mapa" ? (
        <div className="map-workspace">
          <OperationalMap
            plans={plans}
            date={date}
            layer={layer}
            heat={heat}
            opacity={opacity}
            radiusKm={data?.rules.clusterKm ?? 30}
            selectedId={selected?.pivot.id}
            onSelect={setSelected}
          />
          <div className="map-title">
            <span className="live-indicator" />
            CAMPAÑA 2026
            <span className="map-title-divider" />
            {data?.campaign.pending ?? "—"} pendientes
            <span
              className={`campaign-status ${data?.campaign.status === "CRÍTICO" ? "critical" : (data?.campaign.status ?? "").includes("RIESGO") ? "risk" : ""}`}
            >
              {data?.campaign.status ?? "CARGANDO"}
            </span>
          </div>
          <aside className={`map-list ${listOpen ? "" : "collapsed"}`}>
            <div className="map-list-toolbar">
              <div className="map-search">
                <Search size={15} />
                <input
                  aria-label="Buscar equipo en mapa"
                  placeholder="Equipo, campo o provincia"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button
                title={listOpen ? "Ocultar lista" : "Mostrar lista"}
                aria-label={listOpen ? "Ocultar lista" : "Mostrar lista"}
                onClick={() => setListOpen(!listOpen)}
              >
                {listOpen ? (
                  <ChevronLeft size={16} />
                ) : (
                  <ListFilter size={16} />
                )}
              </button>
            </div>
            {listOpen && (
              <>
                <div className="map-list-filters">
                  <select
                    aria-label="Filtrar equipos"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "Pendientes",
                      "Aptos",
                      "Programados",
                      "Terminados",
                      "Todos",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                  <span>{plans.length} equipos</span>
                </div>
                <div className="map-list-counts">
                  <span>
                    <i className="ok" />
                    {counts.apto} aptos
                  </span>
                  <span>
                    <i className="risk" />
                    {counts.risk} riesgo
                  </span>
                  <span>
                    <i className="blocked" />
                    {counts.blocked} no aptos
                  </span>
                </div>
                <div className="map-list-items">
                  {!data ? (
                    <p className="list-placeholder">Cargando datos…</p>
                  ) : (
                    plans.slice(0, 60).map((p) => {
                      const day = p.days.find((d) => d.date === date);
                      return (
                        <button
                          className="map-pivot-row"
                          key={p.pivot.id}
                          onClick={() => setSelected(p)}
                        >
                          <span
                            className={`status-dot ${colorClass(day?.condition)}`}
                          />
                          <div>
                            <strong>{p.pivot.name}</strong>
                            <span>{p.pivot.field || p.cluster}</span>
                            <small>
                              {p.locationWarning
                                ? "Verificar coordenadas"
                                : day?.window
                                  ? `${day.window.start.slice(11, 16)}–${day.window.end.slice(11, 16)} · ${day.window.probability}%`
                                  : "Sin ventana disponible"}
                            </small>
                          </div>
                          <span className="row-priority">
                            {day?.priority ?? "—"}
                            <small>prioridad</small>
                          </span>
                        </button>
                      );
                    })
                  )}
                  {data && !plans.length && (
                    <p className="list-placeholder">
                      Sin equipos para este filtro.
                    </p>
                  )}
                  {plans.length > 60 && (
                    <p className="list-placeholder">
                      Mostrando 60 de {plans.length}. Usá la búsqueda para
                      filtrar.
                    </p>
                  )}
                </div>
                <div className="list-footer">
                  {date
                    ? labelDate(date, {
                        weekday: "long",
                        day: "numeric",
                        month: "short",
                      })
                    : "—"}{" "}
                  · orden por prioridad
                </div>
              </>
            )}
          </aside>
          <aside className="map-layers">
            <div className="layers-heading">
              <Layers size={15} />
              <strong>Capas</strong>
            </div>
            {layers.map((l) => (
              <button
                key={l.id}
                className={layer === l.id ? "active" : ""}
                onClick={() => setLayer(l.id)}
              >
                <span className="layer-radio" />
                {l.label}
                {layer === l.id && <span className="layer-check">✓</span>}
              </button>
            ))}
            <div className="heat-controls">
              <label>
                <input
                  type="checkbox"
                  checked={heat}
                  onChange={(e) => setHeat(e.target.checked)}
                />
                Mapa de calor
              </label>
              <label className="opacity-control">
                Intensidad
                <input
                  aria-label="Intensidad del mapa de calor"
                  type="range"
                  min=".15"
                  max="1"
                  step=".05"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="layer-note">
              {currentLayer.description}
              <span>
                Superficie orientativa hasta {data?.rules.clusterKm ?? 30} km de
                cada punto. No extrapola a ubicaciones sin estimaciones.
              </span>
            </div>
          </aside>
          {!!issues.length && (
            <button
              className="coordinate-warning"
              onClick={() => setSelected(issues[0])}
            >
              <AlertTriangle size={13} />
              {issues.length} ubicación por verificar
            </button>
          )}
          <div className="map-scale">
            <div>
              <strong>{currentLayer.label}</strong>
              <span>{currentLayer.unit}</span>
            </div>
            <div
              className={`scale-ramp ${["access", "wind", "rain", "deadline"].includes(layer) ? "reverse" : ""}`}
            />
            <div className="scale-labels">
              {layer === "availability" ? (
                <>
                  <span>No apto</span>
                  <span>Riesgo</span>
                  <span>Apto</span>
                </>
              ) : (
                <>
                  <span>0</span>
                  <span>{currentLayer.max / 2}</span>
                  <span>{currentLayer.max}</span>
                </>
              )}
            </div>
            <small>Gris: sin información suficiente · azul: programado</small>
          </div>
          <div className="map-timeline">
            <div className="timeline-top">
              <div className="timeline-date">
                <button
                  aria-label="Día anterior"
                  onClick={() => {
                    setPlaying(false);
                    setDate(addDays(date, -1));
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <input
                  aria-label="Fecha operativa"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setPlaying(false);
                  }}
                />
                <button
                  aria-label="Día siguiente"
                  onClick={() => {
                    setPlaying(false);
                    setDate(addDays(date, 1));
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <span className="timeline-source">
                {data?.updatedAt
                  ? `Consulta ${new Date(data.updatedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}`
                  : "Sin pronóstico"}{" "}
                · {data?.evidence.ensembles ?? 0} celdas ensemble
              </span>
              <button
                aria-label={playing ? "Pausar animación" : "Animar fechas"}
                className="timeline-play"
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
            </div>
            <div className="timeline-days">
              {data &&
                Array.from({ length: data.rules.horizon }, (_, i) => {
                  const dt = addDays(data.today, i);
                  return (
                    <button
                      className={dt === date ? "active" : ""}
                      key={dt}
                      onClick={() => {
                        setDate(dt);
                        setPlaying(false);
                      }}
                    >
                      <span>
                        {i === 0 ? "HOY" : labelDate(dt, { weekday: "short" })}
                      </span>
                      <strong>{labelDate(dt, { day: "numeric" })}</strong>
                      <i className={i < 7 ? "near" : "far"} />
                    </button>
                  );
                })}
            </div>
            <div className="timeline-horizons">
              <span>0–7 días · operación</span>
              <span>8+ días · tendencia / menor confianza</span>
            </div>
          </div>
        </div>
      ) : view === "Fuentes" ? (
        <div className="sources-view">
          <div className="section-title">
            <h1>Fuentes y validación</h1>
            <p>
              Fuentes, variables disponibles y errores. No se entrena con datos
              inventados.
            </p>
          </div>
          <div className="source-actions">
            <button disabled={!!busy} onClick={() => refresh("ensemble")}>
              <RefreshCw size={15} />
              Actualizar ensembles
            </button>
            <button disabled={!!busy} onClick={() => refresh("history")}>
              <Database size={15} />
              Actualizar histórico 2021–2025
            </button>
            <label className="observation-import">
              <Upload size={15} />
              Importar verificaciones JSON
              <input
                type="file"
                accept=".json"
                disabled={!!busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy("Importando verificaciones");
                  try {
                    await post(
                      "/api/observations",
                      JSON.parse(await file.text()),
                    );
                    await loadResearch();
                    setMessage(
                      "Verificaciones registradas. Calibración reevaluada.",
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "JSON inválido");
                  } finally {
                    setBusy("");
                  }
                }}
              />
            </label>
          </div>
          {busy && (
            <p className="source-progress">
              <RefreshCw size={15} className="spin" />
              {busy}
            </p>
          )}
          <div className="source-summary">
            <article>
              <span>Ensembles</span>
              <strong>
                {research?.ensembles.length ?? data?.evidence.ensembles ?? 0}
                <small> / {research?.cells.length ?? "—"} celdas</small>
              </strong>
              <p>
                ECMWF, GEFS, ICON EPS y GEM EPS con viento y lluvia disponibles.
              </p>
            </article>
            <article>
              <span>Histórico horario</span>
              <strong>
                {research?.climate.length ?? data?.evidence.climate ?? 0}
                <small> celdas · 5 años</small>
              </strong>
              <p>
                Archivo IFS, octubre–diciembre. Disponibilidad y secuencias
                históricas de jornadas.
              </p>
            </article>
            <article>
              <span>Calibración / machine learning</span>
              <strong>
                {research?.calibration.count ?? 0}
                <small> verificaciones</small>
              </strong>
              <p>
                {research?.calibration.reason ??
                  "Se requieren observaciones reales antes de entrenar."}
              </p>
            </article>
          </div>
          <section className="source-table">
            <h2>Inventario por celda</h2>
            <p>
              Se consulta un punto representativo por celda de 0,25°. Los
              pronósticos determinísticos siguen siendo por equipo.
            </p>
            <div className="source-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Celda</th>
                    <th>Ensemble / miembros con todas las variables</th>
                    <th>Histórico</th>
                    <th>Última consulta</th>
                  </tr>
                </thead>
                <tbody>
                  {research?.cells.map((cell) => {
                    const e = research.ensembles.find(
                        (e) => e.key === cell.key,
                      ),
                      h = research.climate.find((h) => h.key === cell.key);
                    return (
                      <tr key={cell.key}>
                        <td>{cell.key}</td>
                        <td>
                          {e
                            ? e.sources.map((s) => (
                                <span
                                  className={
                                    s.usableMembers
                                      ? "source-ready"
                                      : "source-partial"
                                  }
                                  key={s.family}
                                >
                                  {s.family} {s.usableMembers}/{s.members}
                                </span>
                              ))
                            : "Sin datos"}
                          {e?.errors.length ? (
                            <small>{e.errors.join(" · ")}</small>
                          ) : null}
                        </td>
                        <td>{h ? h.years.join(", ") : "Pendiente"}</td>
                        <td>
                          {e
                            ? new Date(e.fetchedAt).toLocaleString("es-AR")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="source-method">
            <h2>Criterio de cálculo</h2>
            <p>
              La probabilidad de ventana usa el mismo intervalo continuo para
              cada miembro y promedia familias con el mismo peso. Los valores
              faltantes no cuentan como condiciones favorables. La confianza
              penaliza horizonte, información disponible y dispersión. Los datos
              ensemble pueden estar interpolados a una hora desde pasos nativos
              de 3–6 horas.
            </p>
            <p>
              La campaña se evalúa mediante trayectorias Monte Carlo con
              miembros compartidos entre regiones y años históricos compartidos.
              El resultado depende del acceso, la capacidad y las zonas sin
              información disponible. Es una estimación condicionada; todavía no
              una probabilidad validada contra resultados reales.
            </p>
            <h3>Calibración</h3>
            <p>
              Se implementó calibración logística de probabilidades, con
              separación temporal entre entrenamiento y validación. Requiere al
              menos 200 verificaciones, casos favorables y no favorables, y una
              mejora del Brier score frente al pronóstico sin calibrar. Sin esa
              evidencia no se activa.
            </p>
            <details>
              <summary>Formato de verificaciones</summary>
              <pre>{`[{"pivotId":"ID del equipo", "issuedAt":"2026-10-01T10:00:00Z", "validAt":"2026-10-02T15:00:00Z", "probability":0.75, "operable":true, "source":"ensayo"}]`}</pre>
              <p>
                Una fila por ventana realmente verificada. La probabilidad debe
                provenir del snapshot emitido antes de la ventana. Fuentes
                admitidas: ensayo, estacion, encargado. Los históricos modelados
                no se aceptan como verdad de campo.
              </p>
            </details>
          </section>
        </div>
      ) : (
        <div className="management-view">
          {view === "Campaña" && data && (
            <section className="simulation-panel">
              <div>
                <h1>Proyección de campaña</h1>
                <p>
                  {data.simulation.runs} trayectorias ·{" "}
                  {data.simulation.label.toLowerCase()}
                </p>
              </div>
              <div className="simulation-values">
                <span>
                  <strong>
                    {data.simulation.unresolvedLocations
                      ? "—"
                      : `${data.simulation.probability}%`}
                  </strong>
                  cumplimiento simulado
                </span>
                <span>
                  <strong>
                    {data.simulation.completedP50}/{data.campaign.pending}
                  </strong>
                  trabajos terminados · mediana
                </span>
                <span>
                  <strong>
                    {data.simulation.completedP10}–
                    {data.simulation.completedP90}
                  </strong>
                  rango de trabajos · P10–P90
                </span>
                <span>
                  <strong>
                    {data.simulation.coverage.history}/
                    {data.simulation.coverage.regions}
                  </strong>
                  zonas con histórico
                </span>
              </div>
              <p className="simulation-limit">
                Sin calibración observacional.{" "}
                {data.simulation.unresolvedLocations
                  ? `${data.simulation.unresolvedLocations} ubicación sin validar impide estimar el cumplimiento total. `
                  : ""}{" "}
                {data.simulation.coverage.ensembles}/
                {data.simulation.coverage.regions} zonas con ensemble; acceso y
                logística siguen siendo supuestos.
              </p>
            </section>
          )}
          {view === "Campaña" && data && (
            <section className="source-table">
              <h2>Trabajos previstos por semana</h2>
              <p>
                Promedio y rango P10–P90 de trabajos completados en la
                simulación. No son asignaciones.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Semana</th>
                    <th>Trabajos · promedio</th>
                    <th>P10–P90</th>
                  </tr>
                </thead>
                <tbody>
                  {data.simulation.weeks.map((w) => (
                    <tr key={w.date}>
                      <td>
                        {labelDate(w.date, { day: "numeric", month: "short" })}
                      </td>
                      <td>{w.jobs}</td>
                      <td>
                        {w.p10}–{w.p90}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {view !== "Campaña" && <Dashboard key={view} initialTab={view} />}
        </div>
      )}
      {selected && (
        <Detail
          plan={selected}
          date={date}
          busy={!!busy}
          onClose={() => setSelected(null)}
          onSave={onSave}
          crews={data?.rules.crews ?? defaultRules.crews}
        />
      )}
    </div>
  );
}
