"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanningReport, PlanningZone } from "@/domain/planning-report";
import type { confusionReport } from "@/domain/forecast-validation";
import type { Rules } from "@/domain/types";
import AutoSyncStatus from "./AutoSyncStatus";
import "./planning.css";

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
const group = (z: PlanningZone) =>
  z.regions.join(" / ") ||
  z.provinces.join(" / ") ||
  z.fields.join(" / ") ||
  "Sin zona asignada";
const selectionKey = "climato-planning-locations-v1";

export default function PlanningWorkspace() {
  const [report, setReport] = useState<PlanningReport | null>(null),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null),
    [search, setSearch] = useState("");
  const [horizon, setHorizon] = useState<7 | 14>(7),
    [threshold, setThreshold] = useState(70),
    [lead, setLead] = useState(1);
  const [focused, setFocused] = useState(""),
    [selectedDate, setSelectedDate] = useState("");
  const [overlay, setOverlay] = useState<"wind" | "rain">("wind");
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
      localStorage.setItem(selectionKey, JSON.stringify(selected));
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
  }, [keyQuery, lead, threshold, report?.computedAt]);
  const zones = report?.zones.filter((z) => keys.includes(z.key)) ?? [];
  const groups = useMemo(() => {
    const result = new Map<string, PlanningZone[]>();
    for (const z of report?.zones ?? [])
      result.set(group(z), [...(result.get(group(z)) ?? []), z]);
    return [...result].sort(([a], [b]) => a.localeCompare(b));
  }, [report]);
  const dates = zones[0]?.daily.slice(0, horizon).map((d) => d.date) ?? [];
  const focus = zones.find((z) => z.key === focused) ?? zones[0];
  const detailDay =
    focus?.daily.find((d) => d.date === selectedDate) ?? focus?.daily[0];
  const summaryField = horizon === 7 ? "next7" : "next14";
  const covered = zones.filter((z) => z[summaryField].scenarios !== null);
  const average =
    covered.length === zones.length && zones.length
      ? zones.reduce((s, z) => s + z[summaryField].scenarios!.expected, 0) /
        zones.length
      : null;
  const daysAbove = zones.reduce(
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
  const toggle = (ids: string[], enabled: boolean) =>
    setSelected((current) =>
      enabled
        ? [...new Set([...(current ?? []), ...ids])]
        : (current ?? []).filter((k) => !ids.includes(k)),
    );
  const lat = focus?.lat ?? -38.55,
    lon = focus?.lon ?? -58.74;
  const embedParams = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    detailLat: String(lat),
    detailLon: String(lon),
    width: "100%",
    height: "100%",
    zoom: focus ? "8" : "5",
    level: "surface",
    overlay,
    product: "ecmwf",
    menu: "",
    message: "true",
    marker: "true",
    calendar: "now",
    pressure: "",
    type: "map",
    location: "coordinates",
    detail: "",
    metricWind: "km/h",
    metricTemp: "°C",
    radarRange: "-1",
  });
  const windyUrl = `https://www.windy.com/?${overlay === "rain" ? "rain," : ""}${lat},${lon},8`;
  return (
    <div className="planning-app">
      <header className="planning-header">
        <a href="/" className="planning-brand">
          climato<span>Planificación de uniformidades</span>
        </a>
        <nav>
          <a href="#analysis">Análisis</a>
          <a href="#verification">Validación</a>
          <button onClick={() => window.print()}>Imprimir informe</button>
          <button onClick={() => setSettings((v) => !v)}>Criterios</button>
        </nav>
      </header>
      <main className="planning-main">
        <section className="planning-intro">
          <div>
            <p className="planning-eyebrow">
              INFORME DE DISPONIBILIDAD CLIMÁTICA
            </p>
            <h1>Cuánto tiempo tendremos para trabajar</h1>
            <p>
              Seleccioná las zonas y compará los días disponibles en las
              ubicaciones de tus equipos.
            </p>
          </div>
          <div className="planning-updated">
            Actualizado
            <br />
            <strong>
              {report
                ? new Date(report.computedAt).toLocaleString("es-AR", {
                    timeZone: "America/Argentina/Buenos_Aires",
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "Cargando…"}
            </strong>
            <span>Hora argentina · actualización diaria automática</span>
          </div>
        </section>
        {error && (
          <div className="planning-alert" role="alert">
            {error}{" "}
            <button
              onClick={() => void load().catch((e) => setError(e.message))}
            >
              Reintentar
            </button>
          </div>
        )}
        <AutoSyncStatus inline onReload={load} />
        {settings && report && (
          <RulesEditor
            rules={report.rules}
            onSaved={async () => {
              await load();
              setSettings(false);
            }}
          />
        )}
        {report && (
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
        <div className="planning-layout">
          <aside className="planning-selection" aria-label="Selección de zonas">
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
              <button
                onClick={() =>
                  setSelected(report?.zones.map((z) => z.key) ?? [])
                }
              >
                Seleccionar todas
              </button>
              <button onClick={() => setSelected([])}>Quitar todas</button>
            </div>
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
                  [name, ...z.equipment.map((e) => e.name), ...z.fields, z.key]
                    .join(" ")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                );
                if (!visible.length) return null;
                const count = items.filter((z) => keys.includes(z.key)).length;
                return (
                  <details key={name} open={!!search || groups.length < 5}>
                    <summary>
                      <input
                        type="checkbox"
                        aria-label={`Incluir zona ${name}`}
                        checked={count === items.length}
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              count > 0 && count < items.length;
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          toggle(
                            items.map((z) => z.key),
                            e.target.checked,
                          )
                        }
                      />
                      <span>
                        {name}
                        <small>
                          {count}/{items.length} ubicaciones ·{" "}
                          {items.reduce((s, z) => s + z.pending, 0)} equipos
                        </small>
                      </span>
                    </summary>
                    <div>
                      {visible.map((z) => (
                        <label key={z.key}>
                          <input
                            type="checkbox"
                            checked={keys.includes(z.key)}
                            onChange={(e) => toggle([z.key], e.target.checked)}
                          />
                          <span>
                            {z.equipment.map((e) => e.name).join(" / ")}
                            <small>
                              {z.fields.join(" / ")} · {z.lat.toFixed(4)},{" "}
                              {z.lon.toFixed(4)}
                            </small>
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
              Desmarcar una zona la excluye de todas las estadísticas y tablas.
              Se conserva tu selección en este navegador.
            </p>
          </aside>
          <div className="planning-content">
            <section className="planning-map-panel">
              <div className="planning-panel-title">
                <div>
                  <h2>Mapa meteorológico · Windy</h2>
                  <p>
                    {focus
                      ? `${group(focus)} · ${focus.equipment.map((e) => e.name).join(" / ")}`
                      : "Elegí una ubicación para centrar el mapa"}
                  </p>
                </div>
                <div className="planning-map-tools">
                  <label>
                    Capa
                    <select
                      aria-label="Capa"
                      value={overlay}
                      onChange={(e) =>
                        setOverlay(e.target.value as "wind" | "rain")
                      }
                    >
                      <option value="wind">Viento</option>
                      <option value="rain">Lluvia</option>
                    </select>
                  </label>
                  <a href={windyUrl} target="_blank" rel="noopener noreferrer">
                    Abrir Windy ↗
                  </a>
                </div>
              </div>
              <iframe
                title="Mapa meteorológico interactivo oficial de Windy"
                src={`https://embed.windy.com/embed.html?${embedParams}`}
                allowFullScreen
                loading="lazy"
              />
              <p className="planning-map-note">
                Vista oficial de Windy. Su fecha y modelo se eligen dentro del
                mapa y son independientes del análisis. Los cálculos usan los
                pronósticos de cada ubicación de equipo. Si el mapa no carga,
                usá «Abrir Windy».
              </p>
            </section>
            <section id="analysis" className="planning-analysis">
              <div className="planning-panel-title">
                <div>
                  <p className="planning-eyebrow">
                    DISPONIBILIDAD POR UBICACIÓN
                  </p>
                  <h2>Próximos {horizon} días</h2>
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
                    Umbral de clasificación
                    <select
                      aria-label="Umbral de clasificación"
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
              {!zones.length ? (
                <div className="planning-empty">
                  Seleccioná al menos una zona para generar el análisis.
                </div>
              ) : (
                <>
                  <div className="planning-stats">
                    <Stat
                      label="Equipos seleccionados"
                      value={String(zones.reduce((s, z) => s + z.pending, 0))}
                      note={`${zones.length} ubicaciones analizadas individualmente`}
                    />
                    <Stat
                      label="Días aptos esperados por ubicación"
                      value={number(average)}
                      note={`${covered.length}/${zones.length} ubicaciones con distribución completa · período de ${horizon} días`}
                    />
                    <Stat
                      label={`Ubicación-días con probabilidad ≥ ${threshold}%`}
                      value={String(daysAbove)}
                      note="No equivale a días distintos ni a trabajos ejecutables"
                    />
                  </div>
                  <p className="planning-evidence-note">
                    Probabilidad de al menos un ensayo completo en el día. Es
                    una estimación del ensemble, todavía sin calibración local
                    acreditada. El umbral clasifica los resultados; no aumenta
                    su certeza.
                  </p>
                  <div className="planning-table-scroll">
                    <table className="planning-calendar">
                      <caption>
                        Probabilidad diaria por ubicación. Elegí una celda para
                        ver horarios y evidencia.
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
                        {zones.map((z) => {
                          const distribution = z[summaryField].scenarios;
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
                                    {z.equipment.map((e) => e.name).join(" / ")}{" "}
                                    · {z.fields.join(" / ")}
                                  </small>
                                </button>
                              </th>
                              <td>
                                <strong>
                                  {number(distribution?.expected)}
                                </strong>
                                <small>
                                  {distribution
                                    ? `${distribution.range[0]}–${distribution.range[1]} días`
                                    : "Cobertura insuficiente"}
                                </small>
                                <small>
                                  Racha más larga:{" "}
                                  {z[
                                    horizon === 7
                                      ? "consecutive7"
                                      : "consecutive14"
                                  ]
                                    ? `${z[horizon === 7 ? "consecutive7" : "consecutive14"]!.range[0]}–${z[horizon === 7 ? "consecutive7" : "consecutive14"]!.range[1]} días seguidos`
                                    : "—"}
                                </small>
                              </td>
                              {dates.map((day) => {
                                const d = z.daily.find((d) => d.date === day),
                                  strong =
                                    d?.supported &&
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
                                      {percent(d?.probability)}
                                      <small>
                                        {d?.supported
                                          ? strong
                                            ? "≥ umbral"
                                            : "< umbral"
                                          : "Sin evidencia"}
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
                    <section className="planning-detail">
                      <div className="planning-panel-title">
                        <div>
                          <h3>
                            {group(focus)} · {date(detailDay.date)}
                          </h3>
                          <p>
                            {focus.equipment.map((e) => e.name).join(" / ")} ·{" "}
                            {focus.lat.toFixed(5)}, {focus.lon.toFixed(5)}
                          </p>
                        </div>
                        <strong className="planning-probability">
                          {percent(detailDay.probability)}
                        </strong>
                      </div>
                      <div className="planning-detail-grid">
                        <div>
                          <h4>Fundamento del resultado</h4>
                          <p>
                            {detailDay.supported
                              ? `${detailDay.members} escenarios utilizables de ${detailDay.families} familias de modelos. Cada familia pesa lo mismo.`
                              : "Evidencia insuficiente: se exigen al menos 2 familias, 10 miembros por familia y 80% de cobertura en cada una."}
                          </p>
                          <ul>
                            {detailDay.evidence.map((e) => (
                              <li key={e.family}>
                                {e.family}: {e.usable}/{e.total} miembros ·{" "}
                                {percent(e.probability)} con al menos un ensayo
                              </li>
                            ))}
                          </ul>
                          <p>
                            Pronóstico descargado:{" "}
                            {focus.sources.ensembleAt
                              ? new Date(
                                  focus.sources.ensembleAt,
                                ).toLocaleString("es-AR", {
                                  timeZone: "America/Argentina/Buenos_Aires",
                                })
                              : "sin datos"}
                            .
                          </p>
                        </div>
                        <div>
                          <h4>Franjas con probabilidad ≥ {threshold}%</h4>
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
                              No hay una franja común con evidencia suficiente
                              que supere el umbral. La probabilidad diaria puede
                              reunir ensayos en horarios distintos.
                            </p>
                          )}
                          {detailDay.following && (
                            <p>
                              Si este día resulta apto, se esperan{" "}
                              <strong>
                                {number(detailDay.following.expected)} días
                                adicionales
                              </strong>{" "}
                              hasta el {date(detailDay.followingEnd)}; rango de
                              escenarios {detailDay.following.range[0]}–
                              {detailDay.following.range[1]} días. Probabilidad
                              de no tener otro día apto:{" "}
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
                          Acceso al campo: hay equipos con acceso desconocido o
                          no apto. El resultado climático no resuelve esa
                          restricción.
                        </p>
                      )}
                    </section>
                  )}
                </>
              )}
            </section>
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
              {verifyError && <p role="alert">{verifyError}</p>}
              {!verification && !verifyError ? (
                <p>Consultando registros…</p>
              ) : (
                verification && (
                  <>
                    <p className="planning-validation-coverage">
                      {date(verification.start)}–{date(verification.end)} ·{" "}
                      <strong>{verification.count} casos verificados</strong> de{" "}
                      {verification.expected} ubicación-días ·{" "}
                      {verification.days} fechas · {verification.locations}{" "}
                      ubicaciones. {verification.captured} pronósticos
                      archivados; {verification.pending} sin referencia
                      completa.
                    </p>
                    {verification.count === 0 && (
                      <div className="planning-empty">
                        <strong>
                          Aún no hay pares de pronóstico y resultado para medir
                          aciertos.
                        </strong>
                        <p>
                          La herramienta ya conserva las nuevas estimaciones
                          antes de cada fecha. Los resultados se incorporarán
                          automáticamente cuando ERA5 publique los datos; suelen
                          tener varios días de demora. Los días sin registro
                          previo no se reconstruyen como si hubieran sido
                          pronosticados.
                        </p>
                      </div>
                    )}
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
                            <th scope="row">Pronóstico &lt; {threshold}%</th>
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
                      anticipación. Vecinos y días consecutivos comparten clima:
                      el número de casos no equivale a observaciones
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
                  probó en fechas desde 2016. Esta prueba interna usa clima del
                  día reconstruido; mide la relación entre condiciones y
                  aptitud, no la capacidad de anticipar el tiempo. No sustituye
                  la matriz de los últimos 30 días ni certifica el pronóstico
                  estacional.
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
            <section className="planning-longrange">
              <h2>Perspectiva hasta fin de campaña</h2>
              <p>
                Fuera del horizonte de 14 días, los resultados son
                experimentales y sirven para comparar períodos, no para fijar
                fechas de ensayo. No tienen la misma evidencia que el ensemble
                de corto plazo.
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
                    {zones.map((z) => (
                      <tr key={z.key}>
                        <th>
                          {group(z)} ·{" "}
                          {z.equipment.map((e) => e.name).join(" / ")}
                        </th>
                        <td>{number(z.remaining.expectedDays)}</td>
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
            <section className="planning-method">
              <h2>Cómo se estima la disponibilidad</h2>
              <ol>
                <li>
                  Se consulta el pronóstico en las coordenadas de cada equipo.
                  No se interpola una probabilidad a partir del mapa de colores.
                </li>
                <li>
                  En cada escenario se buscan ensayos completos que cumplan
                  viento, lluvia y duración. La lluvia fuera del ensayo no
                  descarta el día; la del día anterior se verifica por separado.
                </li>
                <li>
                  La probabilidad diaria es la proporción de escenarios con al
                  menos un ensayo. Cada familia meteorológica tiene el mismo
                  peso. No se publica una probabilidad si falta cobertura
                  mínima.
                </li>
                <li>
                  Los días esperados y su rango se calculan recorriendo
                  escenarios completos: se conserva la relación entre días
                  consecutivos. El rango central del 80% describe escenarios del
                  modelo; no es un intervalo de confianza validado en campo.
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
          </div>
        </div>
      </main>
      <footer className="planning-footer">
        Climato · Informe de planificación de uniformidades ·{" "}
        <a
          href="https://www.windy.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Windy
        </a>{" "}
        · Meteorología: Open-Meteo / ensembles y ERA5. Las actualizaciones
        automáticas requieren que el servidor de la aplicación siga encendido.
      </footer>
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
