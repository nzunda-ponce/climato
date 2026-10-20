"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Info,
  Layers,
  Search,
  Settings2,
  CloudRain,
  X,
  MapPin,
} from "lucide-react";
import { addDays, PivotPlan } from "@/domain/types";
import { cellKey } from "@/domain/evidence";
import { nextMonday, weatherMapPeriod } from "@/domain/map-period";
import { periodPotential } from "@/domain/climatic";
import {
  listPossibleWindows,
  workDaySummary,
  workDayLabel,
  estimatedDaysText,
} from "@/domain/work-windows";
import PossibleWindows from "./PossibleWindows";
import { RAIN_GRADIENT, weatherPeriodDays } from "@/domain/weather-grid";
import { ClimateData, SourceStatus } from "./climate-types";
import ClimateDataRules from "./ClimateDataRules";
import AutoSyncStatus from "./AutoSyncStatus";
import "./climate.css";
const ClimateMap = dynamic(() => import("./OperationalMap"), { ssr: false });
const fmt = (v: number | null, digits = 0) =>
  v === null
    ? "—"
    : v.toLocaleString("es-AR", { maximumFractionDigits: digits });
const estimate = (value: number | null) =>
  value !== null && value > 0 && value < 0.1 ? "<0,1" : fmt(value, 1);
const label = (s: string) =>
  new Date(s + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export default function ClimateWorkspace() {
  const timeline = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ClimateData | null>(null),
    [sources, setSources] = useState<SourceStatus | null>(null),
    [error, setError] = useState("");
  const [management, setManagement] = useState(false),
    [period, setPeriod] = useState(""),
    [layer, setLayer] = useState<"rain" | "availability">("rain"),
    [opacity, setOpacity] = useState(0.7);
  const [animateWind, setAnimateWind] = useState(true);
  const [granularity, setGranularity] = useState<"day" | "week">("week");
  const [summary, setSummary] = useState(true),
    [selected, setSelected] = useState(""),
    [equipment, setEquipment] = useState<PivotPlan | null>(null),
    [search, setSearch] = useState(""),
    [info, setInfo] = useState(false),
    [zoneList, setZoneList] = useState(false),
    [windowsOpen, setWindowsOpen] = useState(false),
    [focus, setFocus] = useState(0);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch("/api/campaign?mode=climate"),
      fetch("/api/long-range?grid=1"),
    ]);
    const [d, s] = await Promise.all([a.json(), b.json()]);
    if (!a.ok) throw new Error(d.error);
    if (!b.ok) throw new Error(s.error);
    setData(d);
    setPeriod((current) => current || d.climatic.start);
    setSources(s);
    setError("");
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const timer = setInterval(
      () => load().catch((e) => setError(e.message)),
      60000,
    );
    return () => clearInterval(timer);
  }, [load]);
  const periods = useMemo(() => {
    if (!data) return [];
    const c = data.climatic;
    const result = [];
    const monday = nextMonday(data.today);
    for (let d = c.start; d <= c.end;) {
      const end =
        granularity === "day"
          ? d
          : d < monday
            ? addDays(monday, -1)
            : addDays(d, 6);
      result.push({
        key: d,
        start: d,
        end: end > c.end ? c.end : end,
        label: granularity === "week" && d < monday ? "Esta semana" : label(d),
      });
      d = addDays(end, 1);
    }
    result.push({
      key: "campaign",
      start: c.start,
      end: c.end,
      label: "Hasta fin de año",
    });
    return result;
  }, [data, granularity]);
  const range = periods.find((p) => p.key === period) ?? periods[0];
  const rawMapPeriod =
    data && range
      ? weatherMapPeriod(data.today, range.start, period === "campaign")
      : null;
  const mapPeriod =
    rawMapPeriod && data
      ? {
          ...rawMapPeriod,
          end:
            rawMapPeriod.end > data.climatic.end
              ? data.climatic.end
              : rawMapPeriod.end,
        }
      : null;
  const changeGranularity = (next: "day" | "week") => {
    setGranularity(next);
    if (!data) return;
    if (period === "campaign") {
      if (next === "day") setPeriod(data.climatic.start);
      return;
    }
    let start = data.climatic.start;
    if (next === "day") start = range.start;
    else {
      const monday = nextMonday(data.today);
      if (range.start >= monday) {
        start = monday;
        while (addDays(start, 7) <= range.start) start = addDays(start, 7);
      }
    }
    setPeriod(start);
  };
  const selectDay = (day: string) => {
    if (data && day >= data.climatic.start && day <= data.climatic.end) {
      setPeriod(day);
    }
  };
  useEffect(() => {
    const track = timeline.current;
    const active = track?.querySelector<HTMLElement>("button.active");
    if (track && active) {
      const left = active.offsetLeft - track.offsetLeft;
      if (
        left < track.scrollLeft ||
        left + active.offsetWidth > track.scrollLeft + track.clientWidth
      ) {
        track.scrollTo({
          left: Math.max(0, left - track.clientWidth / 3),
          behavior: "smooth",
        });
      }
    }
  }, [period, granularity]);
  const zones = useMemo(
    () =>
      !data || !range
        ? []
        : data.climatic.zones.map((z) => ({
            ...z,
            potential: periodPotential(z, range.start, range.end),
          })),
    [data, range],
  );
  const complete = zones.filter(
    (z) => z.potential.covered === z.potential.total && z.potential.total > 0,
  );
  const surface = useMemo(
    () =>
      zones.flatMap((z) =>
        z.potential.covered !== z.potential.total ||
        z.potential.fraction === null
          ? []
          : [
              {
                lat: z.lat,
                lon: z.lon,
                key: z.key,
                value: z.potential.fraction * 100,
                label: `≈ ${estimate(z.potential.expectedDays)} días estimados para trabajar en el período`,
              },
            ],
      ),
    [zones, range],
  );
  const chosen = zones.find((z) => z.key === selected),
    plans = useMemo(
      () =>
        data?.plans.filter((p) =>
          `${p.pivot.name} ${p.pivot.field} ${p.pivot.province ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ) ?? [],
      [data, search],
    );
  const selectPivot = (p: PivotPlan) => {
    setEquipment(p);
    setSelected(cellKey(p.pivot.lat, p.pivot.lon));
    setSummary(true);
    setZoneList(false);
  };
  const selectedId =
    equipment?.pivot.id ??
    (selected
      ? plans.find((p) => cellKey(p.pivot.lat, p.pivot.lon) === selected)?.pivot
          .id
      : undefined);
  const partial = complete.length < zones.length;
  const daySummary = range
    ? workDaySummary(chosen ? [chosen] : zones, range.start, range.end)
    : null;
  const possibleWindows = useMemo(() => {
    if (!windowsOpen || !data || !range) return [];
    const scope = data.plans.filter((plan) =>
      equipment
        ? plan.pivot.id === equipment.pivot.id
        : chosen
          ? cellKey(plan.pivot.lat, plan.pivot.lon) === chosen.key
          : true,
    );
    return listPossibleWindows(
      scope,
      data.climatic.zones,
      range.start,
      range.end,
    );
  }, [windowsOpen, data, range, equipment, chosen]);
  if (management && data)
    return (
      <>
        <AutoSyncStatus onReload={load} />
        <ClimateDataRules
          data={data}
          sources={sources}
          onReload={load}
          onClose={() => {
            setManagement(false);
            load().catch((e) => setError(e.message));
          }}
        />
      </>
    );
  return (
    <div className="climate-app windy-workspace">
      <AutoSyncStatus onReload={load} />
      <header className="climate-header">
        <a href="/" className="climate-logo">
          climato
        </a>
        <Link className="climate-report-link" href="/informe">
          Informe de oportunidades
        </Link>
        <button disabled={!data} onClick={() => setManagement(true)}>
          <Settings2 size={15} />
          <span>Datos y reglas</span>
        </button>
      </header>
      <main className="climate-stage">
        <div className="climate-map-area">
          {data && range && (
            <ClimateMap
              plans={plans}
              date={layer === "rain" ? mapPeriod!.start : range.start}
              periodEnd={layer === "rain" ? mapPeriod!.end : range.end}
              layer="probability"
              heat
              opacity={opacity}
              radiusKm={160}
              surface={surface}
              grid={layer !== "availability" ? sources?.grid : undefined}
              field={layer !== "availability" ? layer : undefined}
              selectedId={selectedId}
              onSelect={selectPivot}
              focusKey={focus}
              animateWind={animateWind}
              windOverlay={layer === "rain"}
            />
          )}
        </div>
        <div className="windy-search">
          <Search size={15} />
          <input
            aria-label="Buscar trabajos en el mapa"
            placeholder="Buscar equipo, campo o provincia"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button aria-label="Limpiar búsqueda" onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="windy-map-label">
          <span className="windy-status-dot" />
          {layer === "rain" ? "Lluvia + viento" : "Días aptos por zona"}
          <span>
            {layer === "rain" && mapPeriod
              ? mapPeriod.start === data?.today
                ? "Hoy"
                : `${label(mapPeriod.start)} — ${label(mapPeriod.end)}`
              : range
                ? `${label(range.start)} — ${label(range.end)}`
                : "Cargando…"}
          </span>
        </div>
        {error && (
          <div className="windy-error" role="alert">
            {error}
            <button onClick={() => load().catch((e) => setError(e.message))}>
              Reintentar
            </button>
          </div>
        )}
        <div className="climate-sidebar">
          <div className="windy-summary-controls">
            <button onClick={() => setSummary(!summary)}>
              <CalendarDays size={14} />
              Resumen
              <ChevronDown size={13} />
            </button>
            <button
              aria-label="Centrar mapa en los trabajos"
              title="Centrar trabajos"
              onClick={() => setFocus((f) => f + 1)}
            >
              <Crosshair size={15} />
            </button>
          </div>
          {summary && (
            <aside className="windy-summary">
              <button
                className="climate-close"
                aria-label="Ocultar resumen"
                onClick={() => setSummary(false)}
              >
                <X size={14} />
              </button>
              <span className="climate-eyebrow">
                {chosen
                  ? equipment
                    ? "EQUIPO SELECCIONADO"
                    : "ZONA SELECCIONADA"
                  : "OPORTUNIDADES DE TRABAJO"}
              </span>
              <h1>
                {chosen
                  ? (equipment?.pivot.name ?? chosen.name)
                  : period === "campaign"
                    ? "Hasta fin de año"
                    : range
                      ? range.start === range.end
                        ? label(range.start)
                        : `${label(range.start)} — ${label(range.end)}`
                      : "Cargando datos"}
              </h1>
              {chosen && equipment && (
                <p className="windy-location">{equipment.pivot.field}</p>
              )}
              <div className="windy-potential">
                {data
                  ? estimatedDaysText(daySummary?.expectedDays ?? null)
                  : "—"}
                <span>
                  {chosen
                    ? "días estimados para trabajar"
                    : "días estimados por zona"}
                </span>
              </div>
              <p className="windy-equipment-summary">
                {chosen
                  ? "Revisá las fechas y confirmá el horario antes de salir."
                  : "Elegí una zona o un equipo para ver sus mejores fechas."}
              </p>
              <button
                className="windy-view-windows"
                disabled={!data}
                onClick={() => setWindowsOpen(true)}
              >
                Ver días y horarios
              </button>
              <p className="windy-basis">
                Es una estimación de días, no trabajos confirmados. Un mismo día
                puede servir para varios equipos.
              </p>
              {chosen ? (
                <>
                  <h3>Días para revisar</h3>
                  <div className="windy-opportunities">
                    {chosen.days
                      .filter(
                        (d) =>
                          d.date >= data!.climatic.start &&
                          d.date <= addDays(data!.today, 14) &&
                          (d.probability ?? 0) > 0 &&
                          (d.slots ?? 0) > 0,
                      )
                      .sort(
                        (a, b) => (b.probability ?? 0) - (a.probability ?? 0),
                      )
                      .slice(0, 3)
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((d) => (
                        <button
                          key={d.date}
                          onClick={() => {
                            setGranularity("day");
                            setPeriod(d.date);
                          }}
                        >
                          {label(d.date)}{" "}
                          <span>
                            {workDayLabel(
                              d.probability,
                              d.source !== "pronóstico" ||
                                d.date > addDays(data!.today, 7),
                            )}
                          </span>
                        </button>
                      ))}
                    {!chosen.days.some(
                      (d) => (d.probability ?? 0) > 0 && (d.slots ?? 0) > 0,
                    ) && (
                      <p>
                        Por ahora no hay una oportunidad clara. Revisá los
                        próximos días.
                      </p>
                    )}
                  </div>
                  <button
                    className="windy-text-button"
                    onClick={() => {
                      setSelected("");
                      setEquipment(null);
                    }}
                  >
                    Ver todos los equipos
                  </button>
                </>
              ) : (
                <>
                  {partial && (
                    <p className="windy-data-coverage">
                      Algunas zonas todavía están cargando.
                    </p>
                  )}
                  <button
                    className="windy-text-button"
                    onClick={() => setZoneList(!zoneList)}
                  >
                    <MapPin size={12} />
                    {zoneList ? "Ocultar zonas" : "Ver zonas"}
                  </button>
                  {zoneList && (
                    <div className="windy-zone-list">
                      {zones.map((z) => (
                        <button
                          key={z.key}
                          onClick={() => {
                            setSelected(z.key);
                            setEquipment(null);
                            setZoneList(false);
                          }}
                        >
                          <span>{z.name}</span>
                          <strong>
                            {estimatedDaysText(
                              workDaySummary([z], range.start, range.end)
                                .expectedDays,
                            )}{" "}
                            días estimados
                          </strong>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <button
                className="windy-method-link"
                onClick={() => setInfo(true)}
              >
                <Info size={12} />
                Cómo leer estos resultados
              </button>
            </aside>
          )}
          <aside className="windy-layers">
            <div>
              <Layers size={13} />
              CAPAS
            </div>
            <button
              className={layer === "rain" ? "active" : ""}
              onClick={() => setLayer("rain")}
            >
              <CloudRain size={16} />
              Lluvia + viento
            </button>
            <button
              className={layer === "availability" ? "active" : ""}
              onClick={() => setLayer("availability")}
            >
              <CalendarDays size={16} />
              Días aptos
            </button>
            <details className="windy-map-options">
              <summary>Ajustar mapa</summary>
              <label>
                Intensidad
                <input
                  aria-label="Intensidad del mapa de calor"
                  type="range"
                  min=".2"
                  max=".95"
                  step=".05"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </label>
              {layer === "rain" && (
                <label className="windy-animation">
                  <input
                    type="checkbox"
                    checked={animateWind}
                    onChange={(e) => setAnimateWind(e.target.checked)}
                  />
                  Animar viento
                </label>
              )}
            </details>
          </aside>
          <div className={`windy-legend ${layer}`}>
            <span>
              {layer === "rain"
                ? mapPeriod?.start === data?.today
                  ? "Lluvia de hoy · mm"
                  : "Lluvia acumulada esperada · mm"
                : "Días estimados para trabajar"}
            </span>
            <div
              style={
                layer === "rain" ? { background: RAIN_GRADIENT } : undefined
              }
            />
            <footer>
              {(layer === "rain"
                ? [0, 2, 10, 50].map(
                    (value) =>
                      value *
                      (mapPeriod
                        ? weatherPeriodDays(mapPeriod.start, mapPeriod.end)
                        : 1),
                  )
                : [0, 0.25, 0.5, 0.75, 1].map(
                    (fraction) => fraction * (daySummary?.totalDays ?? 1),
                  )
              ).map((v) => (
                <span key={v}>
                  {fmt(v, 1)}
                  {layer === "rain" &&
                  v ===
                    50 *
                      (mapPeriod
                        ? weatherPeriodDays(mapPeriod.start, mapPeriod.end)
                        : 1)
                    ? "+"
                    : ""}
                </span>
              ))}
            </footer>
            {layer === "rain" && mapPeriod?.start !== data?.today && (
              <p className="windy-rain-explanation">
                Total del período, no lluvia continua.
              </p>
            )}
          </div>
        </div>
        <section className="windy-timeline">
          <div className="windy-time-controls">
            <div role="group" aria-label="Desglose del pronóstico">
              <button
                aria-pressed={granularity === "day"}
                onClick={() => changeGranularity("day")}
              >
                Por día
              </button>
              <button
                aria-pressed={granularity === "week"}
                onClick={() => changeGranularity("week")}
              >
                Por semana
              </button>
            </div>
            <div className="windy-timeline-nav">
              <button
                aria-label="Ver fechas anteriores"
                onClick={() =>
                  timeline.current?.scrollBy({ left: -450, behavior: "smooth" })
                }
              >
                <ChevronLeft size={16} />
              </button>
              <button
                aria-label="Ver fechas siguientes"
                onClick={() =>
                  timeline.current?.scrollBy({ left: 450, behavior: "smooth" })
                }
              >
                <ChevronRight size={16} />
              </button>
            </div>
            {granularity === "day" && data && range && (
              <input
                aria-label="Ir a fecha"
                type="date"
                min={data.climatic.start}
                max={data.climatic.end}
                value={range.start}
                onChange={(e) => selectDay(e.currentTarget.value)}
                onInput={(e) => selectDay(e.currentTarget.value)}
              />
            )}
            <span>
              {range && period !== "campaign"
                ? `${label(range.start)}${range.start !== range.end ? ` — ${label(range.end)}` : ""}`
                : "Toda la campaña"}
            </span>
          </div>
          <div className="windy-periods" ref={timeline}>
            {periods.map((p) => {
              const stats = workDaySummary(
                chosen ? [chosen] : data!.climatic.zones,
                p.start,
                p.end,
              );
              const fraction =
                stats.expectedDays === null || !stats.totalDays
                  ? null
                  : stats.expectedDays / stats.totalDays;
              const tentative =
                p.start > addDays(data!.today, 7) ||
                (chosen ? [chosen] : data!.climatic.zones).some((z) =>
                  z.days.some(
                    (d) =>
                      d.date >= p.start &&
                      d.date <= p.end &&
                      d.source !== "pronóstico",
                  ),
                );
              return (
                <button
                  key={p.key}
                  className={period === p.key ? "active" : ""}
                  onClick={() => {
                    setPeriod(p.key);
                  }}
                >
                  <span>{p.key === "campaign" ? "Hasta 31 dic" : p.label}</span>
                  {granularity === "day" && p.key !== "campaign" && (
                    <small className="windy-weekday">
                      {new Date(p.start + "T12:00Z").toLocaleDateString(
                        "es-AR",
                        { weekday: "short", timeZone: "UTC" },
                      )}
                    </small>
                  )}
                  <i>
                    <b style={{ width: `${(fraction ?? 0) * 100}%` }} />
                  </i>
                  <small>
                    {stats.expectedDays === null
                      ? "Faltan datos"
                      : granularity === "day" && p.key !== "campaign"
                        ? workDayLabel(stats.expectedDays, tentative)
                        : `≈ ${estimatedDaysText(stats.expectedDays)} días aptos`}
                  </small>
                  <small className="windy-weekday">
                    {chosen ? "Esta zona" : "Promedio por zona"}
                    {tentative ? " · a confirmar" : ""}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="windy-timeline-source">
            <span>
              Los números indican días estimados para trabajar. Las fechas
              lejanas se vuelven a evaluar al acercarse.
            </span>
          </div>
        </section>
        {windowsOpen && data && range && (
          <PossibleWindows
            rows={possibleWindows}
            start={range.start}
            end={range.end}
            minHours={data.rules.minHours}
            onClose={() => setWindowsOpen(false)}
          />
        )}
        {info && (
          <div className="climate-method">
            <button
              className="climate-close"
              aria-label="Cerrar metodología"
              onClick={() => setInfo(false)}
            >
              <X size={16} />
            </button>
            <h2>Cuándo se puede trabajar</h2>
            <p>
              Buscamos {data?.rules.minHours ?? 4} horas seguidas con viento de
              hasta {data?.rules.wind ?? 16} km/h, sin lluvia durante el ensayo
              y menos de {data?.rules.rain24Limit ?? 15} mm el día anterior.
            </p>
            <p>
              La cifra principal indica cuántos días podrían servir para
              trabajar en el período elegido. Por ejemplo, unos 2 días en una
              semana. Si no elegís una zona, mostramos el promedio entre zonas.
              La lluvia de noche no descarta un ensayo que pueda hacerse en
              horas secas. Confirmá los horarios antes de salir.
            </p>
            <p>
              El mapa muestra la lluvia y el viento de hoy. Al elegir otra
              semana, muestra la lluvia acumulada esperada de esa semana. El
              acumulado no significa que llueva continuamente.
            </p>
            <button
              className="windy-text-button"
              onClick={() => {
                setInfo(false);
                setManagement(true);
              }}
            >
              Ver fuentes, cobertura y validación
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
