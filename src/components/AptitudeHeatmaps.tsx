"use client";

import { useMemo, useState } from "react";
import type { PlanningZone } from "@/domain/planning-report";
import {
  availabilityGroups,
  availabilityCell,
  availabilityBacking,
} from "@/domain/availability-matrix";

const dateLabel = (date: string) =>
  new Date(date + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const percent = (value: number) => `${Math.round(value * 100)}%`;

export default function AptitudeHeatmaps({
  items,
  dates,
  threshold,
  mode = "both",
}: {
  items: PlanningZone[];
  dates: string[];
  threshold: number;
  mode?: "both" | "forecast" | "history";
}) {
  const [location, setLocation] = useState("");
  const [readout, setReadout] = useState(
    "Seleccioná una celda para consultar su fecha, valor y fuente.",
  );
  const [allYears, setAllYears] = useState(false);
  const [historyReadout, setHistoryReadout] = useState(
    "Seleccioná una celda para consultar el resultado histórico.",
  );
  const coordinates = useMemo(
    () => [
      ...new Map(
        items.map((item) => [item.locationKey ?? item.key, item]),
      ).values(),
    ],
    [items],
  );
  const selected =
    coordinates.find((item) => (item.locationKey ?? item.key) === location) ??
    coordinates[0];
  const history = selected?.science?.historicalDaily;
  const indices = useMemo(
    () => new Map(history?.dates.map((date, index) => [date, index]) ?? []),
    [history],
  );
  const years = history?.years.slice().sort((a, b) => b.year - a.year) ?? [];
  const visible = allYears ? years : years.slice(0, 12);
  const groups = useMemo(
    () =>
      availabilityGroups(items).map(([name, zones]) => ({
        name,
        cells: dates.map((date) => ({
          date,
          cell: availabilityCell(zones, [date]),
        })),
      })),
    [items, dates],
  );
  const headers = (
    <tr>
      <th>Fecha →</th>
      {dates.map((date, index) => (
        <th key={date} className={index % 7 === 0 ? "heat-date-label" : ""}>
          <span>{index % 7 === 0 ? dateLabel(date) : ""}</span>
        </th>
      ))}
    </tr>
  );
  if (!dates.length) return null;
  return (
    <div className="results-heatmaps">
      {mode !== "history" && (
        <section className="results-chart-card">
          <div className="results-chart-heading">
            <div>
              <span className="results-kicker">ZONA × DÍA</span>
              <h2>Mapa de calor de aptitud estimada</h2>
            </div>
            <span className="results-badge">Corte: {percent(threshold)}</span>
          </div>
          <div className="results-heat-legend">
            <span>
              <i className="apt" />
              Apto estimado
            </span>
            <span>
              <i className="not-apt" />
              No apto estimado
            </span>
            <span>
              <i className="reference" />
              Referencia histórica / mixta
            </span>
            <span>
              <i className="missing" />
              Sin datos
            </span>
          </div>
          <div className="results-heat-scroll">
            <table className="results-heat-table">
              <caption>
                Clasificación de la probabilidad media por zona; no es una
                observación de trabajo realizado.
              </caption>
              <thead>{headers}</thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.name}>
                    <th scope="row">{group.name}</th>
                    {group.cells.map(({ date, cell }) => {
                      const reference = Boolean(cell.sources["histórico"]);
                      const kind =
                        cell.probability === null
                          ? "missing"
                          : reference
                            ? "reference"
                            : cell.probability >= threshold
                              ? "apt"
                              : "not-apt";
                      const state =
                        kind === "missing"
                          ? "Sin datos"
                          : kind === "reference"
                            ? "Referencia histórica, sin aviso operativo"
                            : kind === "apt"
                              ? "Apto estimado"
                              : "No apto estimado";
                      const text = `${group.name} · ${dateLabel(date)} · ${state}${cell.probability === null ? "" : ` · ${percent(cell.probability)}`} · ${availabilityBacking(cell)} · ${cell.covered}/${cell.total} ubicaciones con datos`;
                      return (
                        <td key={date}>
                          <button
                            className={`heat-cell ${kind} ${cell.complete ? "" : "partial"}`}
                            aria-label={text}
                            title={text}
                            onClick={() => setReadout(text)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="results-heat-reading" aria-live="polite">
            {readout}
          </p>
          <p className="results-note">
            Apto significa que la probabilidad media de la zona alcanza{" "}
            {percent(threshold)}. Las fechas con base histórica llevan trama y
            no se anuncian como días operativos. Subestacional y estacional son
            proyecciones; los bordes discontinuos señalan cobertura parcial.
          </p>
        </section>
      )}
      {mode !== "forecast" && (
        <section className="results-chart-card">
          <div className="results-chart-heading">
            <div>
              <span className="results-kicker">TEMPORADA × DÍA · ERA5</span>
              <h2>Días aptos y no aptos en el histórico</h2>
            </div>
            <label>
              Ubicación
              <select
                aria-label="Ubicación del mapa de calor histórico"
                value={selected?.locationKey ?? selected?.key ?? ""}
                onChange={(event) => setLocation(event.target.value)}
              >
                {coordinates.map((item) => (
                  <option
                    key={item.locationKey ?? item.key}
                    value={item.locationKey ?? item.key}
                  >
                    {item.equipment.map((e) => e.name).join(" / ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="results-heat-legend">
            <span>
              <i className="apt" />
              Apto según ERA5
            </span>
            <span>
              <i className="not-apt" />
              No apto según ERA5
            </span>
            <span>
              <i className="missing" />
              Sin datos
            </span>
            <span>
              {visible.length} de {years.length} temporadas
            </span>
          </div>
          {!history || !years.length ? (
            <p className="results-note">
              Esta ubicación no contiene etiquetas históricas diarias en la
              publicación.
            </p>
          ) : (
            <div className="results-heat-scroll history-heat-scroll">
              <table className="results-heat-table">
                <caption>
                  Días históricos bajo los criterios del ensayo; son
                  reconstrucciones ERA5, no registros de campo.
                </caption>
                <thead>{headers}</thead>
                <tbody>
                  {visible.map((sample) => (
                    <tr key={sample.year}>
                      <th scope="row">{sample.year}</th>
                      {dates.map((date) => {
                        const index = indices.get(date),
                          value =
                            index === undefined ? "?" : sample.values[index];
                        const kind =
                          value === "1"
                            ? "apt"
                            : value === "0"
                              ? "not-apt"
                              : "missing";
                        const text = `${sample.year}-${date.slice(5)} · ${kind === "apt" ? "Apto" : kind === "not-apt" ? "No apto" : "Sin datos"} · ERA5 · ${selected?.equipment.map((e) => e.name).join(" / ")}`;
                        return (
                          <td key={date}>
                            <button
                              className={`heat-cell ${kind}`}
                              title={text}
                              aria-label={text}
                              onClick={() => setHistoryReadout(text)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="results-heat-reading" aria-live="polite">
            {historyReadout}
          </p>
          {years.length > 12 && (
            <button
              type="button"
              className="results-text-button"
              aria-expanded={allYears}
              onClick={() => setAllYears((value) => !value)}
            >
              {allYears
                ? "Ver las 12 temporadas recientes"
                : `Mostrar las ${years.length} temporadas`}
            </button>
          )}
          <p className="results-note">
            Cada celda representa una fecha real del año indicado. Los faltantes
            quedan grises; no se convierten en días no aptos.
          </p>
        </section>
      )}
    </div>
  );
}
