"use client";
import { useEffect, useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import { PossibleWindow } from "@/domain/work-windows";
import { workDayLabel } from "@/domain/work-windows";
import { addDays, localDate } from "@/domain/types";
import type { WindowDetail } from "@/domain/window-detail";

const dateLabel = (date: string) =>
  new Date(date + "T12:00Z").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const probability = (value: number) =>
  value < 1 ? "<1%" : `${Math.round(value)}%`;

export default function PossibleWindows({
  rows,
  start,
  end,
  minHours,
  onClose,
}: {
  rows: PossibleWindow[];
  start: string;
  end: string;
  minHours: number;
  onClose: () => void;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [details, setDetails] = useState<
    Record<string, WindowDetail | { error: string }>
  >({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        `${row.equipment} ${row.field}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  const size = 40,
    pages = Math.max(1, Math.ceil(filtered.length / size));
  const visible = filtered.slice(page * size, (page + 1) * size);
  const checkTime = async (row: PossibleWindow) => {
    setLoading((old) => ({ ...old, [row.id]: true }));
    try {
      const response = await fetch(
        `/api/windows?${new URLSearchParams({ pivotId: row.pivotId, date: row.date })}`,
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDetails((old) => ({ ...old, [row.id]: result }));
    } catch (error) {
      setDetails((old) => ({
        ...old,
        [row.id]: {
          error:
            error instanceof Error ? error.message : "No se pudo consultar.",
        },
      }));
    } finally {
      setLoading((old) => ({ ...old, [row.id]: false }));
    }
  };
  return (
    <div
      className="possible-windows-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="possible-windows-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="possible-windows-title"
      >
        <button
          className="climate-close"
          aria-label="Cerrar ventanas posibles"
          onClick={onClose}
          autoFocus
        >
          <X size={18} />
        </button>
        <h2 id="possible-windows-title">Días y horarios para trabajar</h2>
        <p>
          {dateLabel(start)}
          {start !== end ? ` — ${dateLabel(end)}` : ""} · bloques de al menos{" "}
          {minHours} h
        </p>
        <p>
          Cada fila es un día para revisar. Consultá el horario del equipo antes
          de organizar una salida. Las fechas lejanas todavía pueden cambiar.
        </p>
        <label className="possible-windows-search">
          <Search size={16} />
          <input
            aria-label="Filtrar ventanas por equipo o campo"
            placeholder="Equipo o campo"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="possible-windows-table">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Equipo / campo</th>
                <th>Cómo se ve</th>
                <th>Horario</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const detail = details[row.id];
                return (
                  <tr key={row.id}>
                    <td>{dateLabel(row.date)}</td>
                    <td>
                      <strong>{row.equipment}</strong>
                      <small>{row.field}</small>
                    </td>
                    <td>
                      {workDayLabel(
                        row.probability / 100,
                        (row.source !== undefined &&
                          row.source !== "pronóstico") ||
                          row.date > addDays(localDate(), 7),
                      )}
                      <details>
                        <summary>Ver porcentaje</summary>
                        {probability(row.probability)} de escenarios con un día
                        apto. No confirma el horario.
                      </details>
                    </td>
                    <td>
                      {detail && "error" in detail ? (
                        <>
                          <span role="status">{detail.error}</span>
                          <button onClick={() => checkTime(row)}>
                            Reintentar
                          </button>
                        </>
                      ) : detail ? (
                        <>
                          {detail.window && (
                            <strong>
                              {detail.window.start.slice(11, 16)}–
                              {detail.window.end.slice(11, 16)} ·{" "}
                              {detail.window.hours} h
                            </strong>
                          )}
                          {detail.window && (
                            <small>
                              Bloques:{" "}
                              {detail.window.blocks
                                .map(
                                  (block) =>
                                    `${block.start.slice(11, 16)}–${block.end.slice(11, 16)}`,
                                )
                                .join(" · ")}
                            </small>
                          )}
                          <small>{detail.message}</small>
                          {detail.window && (
                            <small>
                              Hora argentina · revisá el pronóstico antes de
                              salir.
                            </small>
                          )}
                          {detail.fetchedAt && (
                            <small>
                              Consulta{" "}
                              {new Date(detail.fetchedAt).toLocaleString(
                                "es-AR",
                                {
                                  timeZone: "America/Argentina/Buenos_Aires",
                                  dateStyle: "short",
                                  timeStyle: "short",
                                },
                              )}
                            </small>
                          )}
                        </>
                      ) : (
                        <button
                          disabled={loading[row.id]}
                          onClick={() => checkTime(row)}
                        >
                          {loading[row.id]
                            ? "Consultando…"
                            : "Consultar horario"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length && (
            <p className="possible-windows-empty">
              No hay posibilidades con los datos disponibles para este período y
              filtro.
            </p>
          )}
        </div>
        <footer>
          <span>
            {filtered.length} fechas por equipo · página {page + 1} de {pages}
          </span>
          <div>
            <button
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Anterior
            </button>
            <button
              disabled={page + 1 >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              Siguiente
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
