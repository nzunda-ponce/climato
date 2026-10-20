"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { PlanningReport, PlanningZone } from "@/domain/planning-report";
import {
  availabilityCell,
  availabilityColor,
  availabilityGroups,
  availabilityBacking,
  bestForecastDay,
  type AvailabilityCell,
} from "@/domain/availability-matrix";
const number = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const date = (value: string) =>
  new Date(value + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const weekday = (value: string) =>
  new Date(value + "T12:00Z").toLocaleDateString("es-AR", {
    weekday: "short",
    timeZone: "UTC",
  });
const percent = (v: number | null) =>
  v === null ? "—" : `${Math.round(v * 100)}%`;
const sourceName: Record<string, string> = {
  pronóstico: "Pronóstico meteorológico",
  histórico: "Referencia histórica",
  subestacional: "Proyección subestacional",
  estacional: "Proyección estacional",
};
export default function AvailabilityOverview({
  report,
  zones,
  onZones,
  onDetail,
  mode,
  onMode,
  error,
  onRetry,
}: {
  report: PlanningReport | null;
  zones: PlanningZone[];
  onZones: () => void;
  onDetail: (key: string, date: string) => void;
  mode: "days" | "weeks";
  onMode: (mode: "days" | "weeks") => void;
  error: string;
  onRetry: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapRegion, setMapRegion] = useState("");
  const [overlay, setOverlay] = useState("wind");
  const [active, setActive] = useState<{
    region: string;
    start: string;
  } | null>(null);
  useEffect(() => {
    if (active && !dialog.current?.open) dialog.current?.showModal();
  }, [active]);
  const groups = useMemo(() => availabilityGroups(zones), [zones]);
  const days = zones[0]?.outlook.slice(0, 14).map((d) => d.date) ?? [];
  const periods =
    mode === "days"
      ? days.map((d) => ({ start: d, end: d, dates: [d] }))
      : (zones[0]?.weekly ?? []).map((w) => ({
          start: w.start,
          end: w.end,
          dates: zones[0].outlook
            .filter((d) => d.date >= w.start && d.date <= w.end)
            .map((d) => d.date),
        }));
  const periodDates = periods.flatMap((p) => p.dates);
  const rows = groups.map(([name, items]) => ({
    name,
    items,
    total: availabilityCell(items, periodDates),
    cells: periods.map((p) => availabilityCell(items, p.dates)),
  }));
  const next = availabilityCell(zones, days);
  const remaining = availabilityCell(
    zones,
    zones[0]?.outlook.map((d) => d.date) ?? [],
  );
  const best = report?.publication?.stale
    ? undefined
    : bestForecastDay(zones, days);
  const mapPoints = groups.find(([name]) => name === mapRegion)?.[1] ?? zones;
  const lat = mapPoints.length
    ? mapPoints.reduce((s, z) => s + z.lat, 0) / mapPoints.length
    : -38.55;
  const lon = mapPoints.length
    ? mapPoints.reduce((s, z) => s + z.lon, 0) / mapPoints.length
    : -58.74;
  const embed = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    zoom: mapRegion ? "8" : "5",
    level: "surface",
    overlay,
    product: "ecmwf",
    menu: "",
    message: "true",
    marker: "true",
    calendar: "now",
    type: "map",
    location: "coordinates",
    metricWind: "km/h",
    metricTemp: "°C",
  });
  const selectedRow = rows.find((r) => r.name === active?.region),
    selectedIndex = periods.findIndex((p) => p.start === active?.start),
    selectedCell = selectedRow?.cells[selectedIndex],
    selectedPeriod = periods[selectedIndex];
  const coverage = (cell: AvailabilityCell) =>
    `${cell.covered}/${cell.total} combinaciones de ubicación y fecha con datos`;
  return (
    <div className="availability-overview">
      <div className="availability-top">
        <section
          className={`availability-map ${mapOpen ? "map-open" : ""}`}
          hidden={!zones.length}
          aria-label="Mapa meteorológico de Windy"
        >
          <div className="availability-map-header">
            <strong>
              Windy <span>Mapa de referencia · no filtra el análisis</span>
            </strong>
            <div>
              <label>
                <span className="availability-sr-only">Centrar mapa en</span>
                <select
                  aria-label="Centrar mapa en"
                  value={groups.some(([n]) => n === mapRegion) ? mapRegion : ""}
                  onChange={(e) => setMapRegion(e.target.value)}
                >
                  <option value="">Todas las zonas</option>
                  {groups.map(([name]) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="availability-sr-only">Capa de Windy</span>
                <select
                  aria-label="Capa de Windy"
                  value={overlay}
                  onChange={(e) => setOverlay(e.target.value)}
                >
                  <option value="wind">Viento</option>
                  <option value="rain">Lluvia</option>
                </select>
              </label>
            </div>
          </div>
          <button
            className="availability-map-toggle"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((v) => !v)}
          >
            {mapOpen ? "Ocultar mapa" : "Mostrar mapa de Windy"}
          </button>
          <iframe
            title="Windy · mapa meteorológico oficial"
            src={`https://embed.windy.com/embed2.html?${embed}`}
            loading="lazy"
            allowFullScreen
          />
          <div className="availability-map-foot">
            <span>
              Si el mapa no carga, podés abrir Windy. Las estimaciones siguen
              disponibles. La fecha y el modelo del mapa se eligen dentro de
              Windy.
            </span>
            <a
              href={`https://www.windy.com/?${overlay === "rain" ? "rain," : ""}${lat.toFixed(3)},${lon.toFixed(3)},6`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir Windy <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </div>
        </section>
        <section
          className="availability-summary"
          hidden={!report || !zones.length}
          aria-label="Resumen de días disponibles"
        >
          <div className="availability-summary-head">
            <span className="planning-eyebrow">DÍAS APTOS ESTIMADOS</span>
            <button onClick={onZones}>
              Elegir zonas <ArrowUpRight size={12} aria-hidden="true" />
            </button>
          </div>
          <div className="availability-primary-stat">
            <span>
              {days.length
                ? `${date(days[0])}–${date(days.at(-1)!)} · ${days.length} días analizados`
                : "Seleccioná zonas para comparar"}
            </span>
            <strong>
              {number(next.expected)} <small>días</small>
            </strong>
            <p>
              en promedio por ubicación · pueden ser días separados
              {!next.complete && next.expected !== null
                ? " · cobertura parcial"
                : ""}
            </p>
          </div>
          <div className="availability-secondary-stat">
            <div>
              <span>
                Hasta {report ? date(report.deadline) : "fin de campaña"}
              </span>
              <strong>
                {number(remaining.expected)} <small>días / ubicación</small>
              </strong>
              {remaining.expected !== null && !remaining.complete && (
                <small>Estimación parcial</small>
              )}
            </div>
            <div>
              <span>Selección</span>
              <strong>
                {groups.length} <small>zonas</small>
              </strong>
              <small>
                {zones.length} ubicaciones ·{" "}
                {zones.reduce((s, z) => s + z.pending, 0)} equipos
              </small>
            </div>
          </div>
          <div className="availability-best-day">
            <span>
              {report?.publication?.stale
                ? "Informe pendiente de actualizar"
                : "Fecha mejor posicionada según el pronóstico"}
            </span>
            <strong>
              {best
                ? `${date(best.date)} · ${percent(best.cell.probability)}`
                : zones.length
                  ? "Sin pronóstico suficiente para comparar fechas"
                  : "Elegí al menos una zona"}
            </strong>
            <small>
              {best
                ? `Pronóstico en ${best.locations}/${best.total} ubicaciones. Promedio climático; no confirma una salida ni una racha.`
                : "La historia orienta la campaña, pero no permite anunciar el clima de una fecha concreta."}
            </small>
          </div>
          <p className="availability-summary-note">
            Pronósticos y referencia histórica. Cobertura de datos a 14 días:{" "}
            {next.total
              ? `${Math.floor((next.covered / next.total) * 100)}%`
              : "sin datos"}
            . {availabilityBacking(next)}. Cobertura no equivale a certeza. Los
            días estimados no son días confirmados ni necesariamente
            consecutivos.
          </p>
        </section>
      </div>
      {zones.length > 0 && (
        <section
          className="availability-zone-outlook"
          aria-label="Comparación de ventanas por zona"
        >
          <h2>Planificá por zona</h2>
          <p>
            Compará fechas con pronóstico y consultá la continuidad de cada
            ubicación. Una media regional no garantiza que todos los campos
            estén aptos.
          </p>
          <div>
            {groups.map(([name, items]) => {
              const candidate = report?.publication?.stale
                ? undefined
                : bestForecastDay(items, days);
              const estimate = availabilityCell(items, days);
              return (
                <article key={name}>
                  <h3>{name}</h3>
                  <strong>{number(estimate.expected)} días estimados</strong>
                  <p>
                    por ubicación en {days.length} días ·{" "}
                    {availabilityBacking(estimate)}
                  </p>
                  <p>
                    {candidate
                      ? `${date(candidate.date)} · ${percent(candidate.cell.probability)} promedio con pronóstico (${candidate.locations}/${items.length} ubicaciones)`
                      : "Sin pronóstico vigente suficiente; consultá la referencia histórica por semana."}
                  </p>
                  <button
                    onClick={() =>
                      onDetail(items[0].key, candidate?.date ?? days[0])
                    }
                  >
                    Ver fechas y continuidad en {name}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <section
        className="availability-matrix-panel"
        aria-labelledby="availability-heading"
      >
        <div className="availability-matrix-heading">
          <div>
            <h2 id="availability-heading">Disponibilidad por zona</h2>
            <p>
              {mode === "days"
                ? `${report?.publication?.stale ? "Período publicado" : "Próximos 14 días"} · probabilidad diaria de al menos un ensayo completo`
                : `Hasta ${report ? date(report.deadline) : "fin de campaña"} · días esperados por semana y ubicación`}
            </p>
          </div>
          <div
            className="availability-switch"
            role="group"
            aria-label="Agrupar disponibilidad"
          >
            <button
              aria-pressed={mode === "days"}
              onClick={() => {
                onMode("days");
                setActive(null);
              }}
            >
              Días
            </button>
            <button
              aria-pressed={mode === "weeks"}
              onClick={() => {
                onMode("weeks");
                setActive(null);
              }}
            >
              Semanas
            </button>
          </div>
        </div>
        <div className="availability-legend">
          <div>
            <span>{mode === "days" ? "0%" : "0 días"}</span>
            <i aria-hidden="true" />
            <span>
              {mode === "days"
                ? "100% de probabilidad"
                : "7 días / semana completa"}
            </span>
          </div>
          <span>
            <i className="availability-missing-swatch" /> Sin datos
          </span>
          <span>
            <i className="availability-partial-swatch" /> Cobertura parcial
          </span>
        </div>
        {!report ? (
          <div className="availability-empty" role="status">
            {error ? (
              <>
                <strong>No se pudo cargar el informe</strong>
                <p>{error}</p>
                <button onClick={onRetry}>Volver a intentar</button>
              </>
            ) : (
              "Cargando las estimaciones…"
            )}
          </div>
        ) : !zones.length ? (
          <div className="availability-empty">
            <strong>
              {report.zones.length
                ? "Elegí las zonas que querés analizar"
                : "Importando ubicaciones de los equipos"}
            </strong>
            <p>
              {report.zones.length
                ? "La selección se aplica al resumen y a toda la matriz."
                : "La disponibilidad aparecerá cuando se descarguen datos suficientes."}
            </p>
            <button onClick={onZones}>Ver zonas de trabajo</button>
          </div>
        ) : (
          <>
            <div
              className="availability-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Matriz de disponibilidad por zona; desplazable horizontalmente"
            >
              <table className="availability-table">
                <caption className="availability-sr-only">
                  Disponibilidad estimada: filas por zona y columnas por{" "}
                  {mode === "days" ? "día" : "semana"}. Cada zona promedia sus
                  ubicaciones seleccionadas, sin multiplicar por cantidad de
                  equipos.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Zona de trabajo</th>
                    {periods.map((p) => (
                      <th scope="col" key={p.start}>
                        {date(p.start)}
                        <small>
                          {mode === "days"
                            ? weekday(p.start)
                            : `al ${date(p.end)}`}
                        </small>
                      </th>
                    ))}
                    <th scope="col" className="availability-total">
                      Días estimados<small>del período</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={row.name}>
                      <th scope="row">
                        <button
                          onClick={() =>
                            onDetail(row.items[0].key, periods[0]?.start ?? "")
                          }
                        >
                          {row.name}
                        </button>
                        <small>
                          {row.items.length} ubicaciones ·{" "}
                          {row.items.reduce((s, z) => s + z.pending, 0)} equipos
                        </small>
                        <small className="availability-mobile-total">
                          {number(row.total.expected)} días del período
                        </small>
                      </th>
                      {row.cells.map((cell, i) => {
                        const p = periods[i],
                          label =
                            cell.expected === null
                              ? "Sin datos"
                              : mode === "days"
                                ? percent(cell.probability)
                                : `${number(cell.expected)} d`,
                          description = `${row.name} · ${date(p.start)}${mode === "weeks" ? ` al ${date(p.end)}` : ""}: ${label}. ${coverage(cell)}. ${Object.keys(
                            cell.sources,
                          )
                            .map((s) => sourceName[s] ?? s)
                            .join(
                              " + ",
                            )}${!cell.complete && cell.expected !== null ? ". Estimación parcial." : ""}`;
                        return (
                          <td key={p.start}>
                            <button
                              className={`availability-cell ${cell.expected === null ? "missing" : ""} ${!cell.complete && cell.expected !== null ? "partial" : ""}`}
                              style={availabilityColor(cell.probability)}
                              title={description}
                              aria-label={description}
                              data-row={rowIndex}
                              data-col={i}
                              tabIndex={rowIndex === 0 && i === 0 ? 0 : -1}
                              onFocus={(e) => {
                                e.currentTarget
                                  .closest("table")
                                  ?.querySelectorAll<HTMLButtonElement>(
                                    ".availability-cell",
                                  )
                                  .forEach(
                                    (b) =>
                                      (b.tabIndex =
                                        b === e.currentTarget ? 0 : -1),
                                  );
                              }}
                              onKeyDown={(e) => {
                                const movement: Record<
                                  string,
                                  [number, number]
                                > = {
                                  ArrowRight: [0, 1],
                                  ArrowLeft: [0, -1],
                                  ArrowUp: [-1, 0],
                                  ArrowDown: [1, 0],
                                };
                                const delta = movement[e.key];
                                if (!delta) return;
                                const target = e.currentTarget
                                  .closest("table")
                                  ?.querySelector<HTMLButtonElement>(
                                    `button[data-row="${rowIndex + delta[0]}"][data-col="${i + delta[1]}"]`,
                                  );
                                e.preventDefault();
                                target?.focus();
                              }}
                              aria-pressed={
                                active?.region === row.name &&
                                active.start === p.start
                              }
                              onClick={() =>
                                setActive((current) =>
                                  current?.region === row.name &&
                                  current.start === p.start
                                    ? null
                                    : { region: row.name, start: p.start },
                                )
                              }
                            >
                              {label}
                              <small className="availability-backing">
                                {availabilityBacking(cell)}
                              </small>
                              {!cell.complete && cell.expected !== null && (
                                <span
                                  className="availability-partial-mark"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          </td>
                        );
                      })}
                      <td className="availability-total">
                        <strong>{number(row.total.expected)}</strong>
                        <small>
                          {row.total.expected === null
                            ? "Sin datos"
                            : row.total.complete
                              ? "días / ubicación"
                              : "días · parcial"}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dialog
              ref={dialog}
              className="availability-cell-dialog"
              aria-labelledby="cell-detail-title"
              onClose={() => setActive(null)}
            >
              {selectedCell && selectedRow && selectedPeriod && (
                <div className="availability-cell-detail">
                  <div>
                    <h2 id="cell-detail-title">
                      {selectedRow.name} · {date(selectedPeriod.start)}
                      {mode === "weeks"
                        ? ` al ${date(selectedPeriod.end)}`
                        : ""}
                    </h2>
                    <p>
                      {mode === "days"
                        ? `${percent(selectedCell.probability)} de probabilidad diaria promedio`
                        : `${number(selectedCell.expected)} días esperados por ubicación`}
                      . {coverage(selectedCell)}.
                      {!selectedCell.complete
                        ? " Cobertura incompleta; no se extrapolan los faltantes."
                        : ""}
                    </p>
                    <p>
                      {Object.entries(selectedCell.sources).length
                        ? Object.entries(selectedCell.sources)
                            .map(
                              ([s, n]) =>
                                `${sourceName[s] ?? s}: ${n} ubicación-fechas`,
                            )
                            .join(" · ")
                        : "Todavía no hay evidencia suficiente. Revisá el estado de las descargas en Datos y criterios."}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      dialog.current?.close();
                      onDetail(selectedRow.items[0].key, selectedPeriod.start);
                    }}
                  >
                    Ver detalle por ubicación{" "}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </button>
                </div>
              )}
              <button onClick={() => dialog.current?.close()}>
                Cerrar detalle
              </button>
            </dialog>
            <div className="availability-table-note">
              <span>
                Cada fila promedia las coordenadas de los equipos de esa zona.
                Tocá una celda para ver sus fuentes y cobertura. Usá las flechas
                del teclado para recorrer fechas y zonas. En móvil, deslizá para
                ver más fechas.
              </span>
              <button onClick={onZones}>Modificar selección</button>
            </div>
          </>
        )}
      </section>
      {report && (
        <p className="availability-print-criteria">
          Ensayo: {report.rules.minHours} h seguidas entre{" "}
          {report.rules.startHour} y {report.rules.endHour} h · viento ≤{" "}
          {report.rules.wind} km/h · lluvia durante el ensayo ≤{" "}
          {report.rules.rain} mm · lluvia del día anterior &lt;{" "}
          {report.rules.rain24Limit} mm. Evalúa clima; el acceso al campo se
          verifica por separado.
        </p>
      )}
    </div>
  );
}
