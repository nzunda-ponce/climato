"use client";
import { useState } from "react";
import {
  ArrowLeft,
  Database,
  RefreshCw,
  Settings2,
  Upload,
  MapPin,
  Check,
  X,
} from "lucide-react";
import { ClimateData, SourceStatus } from "./climate-types";
import { Pivot, Rules } from "@/domain/types";
const sourceUrl =
  "https://www.google.com/maps/d/viewer?mid=1XjGPX2pxGOVbN53k-B6TIUnDzWAA_P4";
const fields: {
  key: keyof Rules;
  label: string;
  unit: string;
  step?: number;
}[] = [
  { key: "wind", label: "Viento máximo", unit: "km/h" },
  { key: "rain", label: "Lluvia máxima en el día", unit: "mm", step: 0.1 },
  {
    key: "rain24Limit",
    label: "Lluvia del día anterior: menos de",
    unit: "mm",
    step: 0.1,
  },
  { key: "minHours", label: "Duración mínima continua", unit: "h" },
  { key: "startHour", label: "Inicio de jornada", unit: "h" },
  { key: "endHour", label: "Fin de jornada", unit: "h" },
];
export default function ClimateDataRules({
  data,
  sources,
  onClose,
  onReload,
}: {
  data: ClimateData;
  sources: SourceStatus | null;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const [tab, setTab] = useState("Fuentes"),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [rules, setRules] = useState(data.rules),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState<Pivot | null>(null);
  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "No se pudo completar");
    return d;
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy("");
    }
  };
  const refresh = async (
    kind: "history" | "seasonal" | "ensemble" | "grid" | "enso",
  ) => {
    if (kind === "enso") {
      await post("/api/long-range", { kind });
      return;
    }
    if (kind === "grid") {
      const total = sources?.gridStatus?.total ?? 527;
      for (let offset = 0; offset < total; offset += 8) {
        setBusy(`Malla meteorológica ${Math.min(offset + 8, total)}/${total}`);
        await post("/api/long-range", { kind, offset });
        if (offset + 8 < total) await new Promise((r) => setTimeout(r, 8000));
      }
      return;
    }
    const cells = sources?.cells ?? [];
    if (!cells.length) throw new Error("No hay ubicaciones válidas");
    for (let i = 0; i < cells.length; i++) {
      setBusy(
        `${kind === "history" ? "ERA5 + pronóstico" : kind === "ensemble" ? "Ensembles de corto plazo" : "EC46 / SEAS5"} · ${i + 1}/${cells.length}`,
      );
      await post(kind === "ensemble" ? "/api/research" : "/api/long-range", {
        kind,
        key: cells[i].key,
      });
    }
  };
  const history =
      sources?.regions.filter((r) => (r.history?.years.length ?? 0) >= 30) ??
      [],
    forecast =
      sources?.regions.filter((r) => (r.forecast?.covered ?? 0) > 0) ?? [];
  const pivots = data.plans
    .map((p) => p.pivot)
    .filter((p) =>
      `${p.name} ${p.field} ${p.province}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <div className="climate-app climate-data-view">
      <header className="climate-header">
        <button className="data-back" onClick={onClose}>
          <ArrowLeft size={16} /> Mapa
        </button>
        <div className="climate-heading">Datos y reglas</div>
        <nav>
          {["Fuentes", "Reglas", "Equipos"].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>
      <main className="climate-data-content">
        {(busy || message || error) && (
          <div className={`data-notice ${error ? "error" : ""}`} role="status">
            {busy && <RefreshCw size={14} className="spin" />}
            {error || busy || message}
          </div>
        )}
        {tab === "Fuentes" && (
          <>
            <div className="data-title">
              <Database size={22} />
              <div>
                <h1>Fuentes meteorológicas</h1>
                <p>
                  Pronóstico hasta {data.rules.deadline}. La estadística
                  histórica se usa para estimar ventanas, no para reemplazar el
                  pronóstico.
                </p>
              </div>
            </div>
            <div className="climate-source-cards">
              <article>
                <small>CORTO PLAZO</small>
                <h2>ECMWF · GEFS</h2>
                <p>
                  Comparamos varios escenarios de viento y lluvia para ver en
                  cuántos se puede trabajar. ICON y GEM aportan otra referencia
                  de viento y lluvia.
                </p>
                <button
                  disabled={!!busy}
                  onClick={() =>
                    run("Actualizando ensembles", () => refresh("ensemble"))
                  }
                >
                  Actualizar corto plazo
                </button>
              </article>
              <article>
                <small>HASTA FIN DE AÑO</small>
                <h2>EC46 → SEAS5</h2>
                <p>
                  {forecast.length}/{sources?.cells.length ?? "—"} zonas con
                  ventanas estimadas. Usamos 51 escenarios posibles del tiempo:
                  EC46 cubre unas 6 semanas y SEAS5 llega hasta fin de año. A
                  mayor distancia, mayor incertidumbre.
                </p>
                <button
                  disabled={!!busy}
                  onClick={() =>
                    run("Actualizando largo plazo", () => refresh("seasonal"))
                  }
                >
                  Actualizar pronóstico
                </button>
              </article>
              <article>
                <small>HISTÓRICOS + ENSO</small>
                <h2>ERA5 · 45 años</h2>
                <p>
                  {history.length}/{sources?.cells.length ?? "—"} zonas con
                  serie larga. Octubre–diciembre de 1981–2025. Ráfagas, viento y
                  lluvia horarios. Niño, Niña y neutrales según NOAA.
                </p>
                <button
                  disabled={!!busy}
                  onClick={() => run("Cargando ERA5", () => refresh("history"))}
                >
                  Actualizar y recalcular modelo
                </button>
              </article>
              <article>
                <small>MAPA CONTINUO</small>
                <h2>{sources?.gridStatus?.points ?? 0} puntos</h2>
                <p>
                  El color combina los datos de puntos cercanos para mostrar
                  cómo varían el viento y la lluvia en la región. Sirve para
                  comparar zonas; no distingue lo que pasa dentro de un campo.
                </p>
                <button
                  disabled={!!busy}
                  onClick={() =>
                    run("Actualizando malla", () => refresh("grid"))
                  }
                >
                  Actualizar mapa
                </button>
              </article>
            </div>
            <section className="data-enso">
              <h2>El Niño / La Niña</h2>
              <p>
                {sources?.enso
                  ? `Último RONI publicado: ${sources.enso.latest.value > 0 ? "+" : ""}${sources.enso.latest.value.toFixed(1)} °C · período centrado en ${sources.enso.latest.season}. Señal ${sources.enso.latest.phase}.`
                  : "Índice NOAA pendiente."}{" "}
                Este número indica cuánto se aparta la temperatura del Pacífico
                de lo habitual. Una señal cálida apunta a Niño; una fría, a
                Niña. Para clasificar los años históricos exigimos que la señal
                dure varios meses.
              </p>
              <p>
                El pronóstico de largo plazo ya tiene en cuenta la evolución del
                Pacífico. Mostramos también cómo fueron los años Niño, Niña y
                neutrales para comparar las posibilidades de trabajo.
              </p>
              <button
                disabled={!!busy}
                onClick={() => run("Consultando NOAA", () => refresh("enso"))}
              >
                Actualizar NOAA
              </button>{" "}
              <a
                href="https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"
                target="_blank"
                rel="noreferrer"
              >
                Diagnóstico oficial de NOAA ↗
              </a>
            </section>
            <section className="data-table-section">
              <h2>Cobertura por zona</h2>
              <div className="data-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Zona</th>
                      <th>Serie histórica</th>
                      <th>Pronóstico</th>
                      <th>Modelo estadístico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources?.regions.map((r) => (
                      <tr key={r.key}>
                        <td>{r.key}</td>
                        <td>
                          {r.history
                            ? `${r.history.years[0]}–${r.history.years.at(-1)} · ${r.history.samples.toLocaleString("es-AR")} días`
                            : "Pendiente"}
                        </td>
                        <td>
                          {r.forecast
                            ? `${r.forecast.covered}/${r.forecast.days} días · consultado ${new Date(r.forecast.fetchedAt).toLocaleDateString("es-AR")}`
                            : "Pendiente"}
                          {r.forecast?.errors.map((e) => (
                            <small className="data-error-text" key={e}>
                              {e}
                            </small>
                          ))}
                        </td>
                        <td>
                          {r.history?.validation
                            ? `Brier interno ${r.history.validation.brier.toFixed(3)} / base ${r.history.validation.baseline.toFixed(3)}`
                            : "Sin validación interna"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="data-method-note">
              <h2>De dónde salen los días aptos</h2>
              <p>
                Primero tomamos el viento y la lluvia pronosticados. Para las
                fechas lejanas buscamos los 60 días más parecidos del mismo mes
                en 45 años de clima y revisamos cuántos tuvieron las horas
                seguidas necesarias para trabajar, según los límites de viento y
                lluvia. Repetimos esto para los distintos escenarios del
                pronóstico. El resultado es una posibilidad de encontrar una
                ventana.
              </p>
              <p>
                Un 60% para un día significa que alrededor de 6 de cada 10
                escenarios dan condiciones aptas. Para una semana sumamos las
                posibilidades de sus días: 2 días estimados no aseguran dos
                fechas concretas. Las fechas lejanas sirven para planificar; hay
                que volver a mirarlas cuando se acercan.
              </p>
              <details>
                <summary>Detalle técnico y cómo se comprueba</summary>
                <p>
                  Modelo experimental de 60 análogos con ERA5 horario. La
                  comprobación interna de la tabla (Brier, menor es mejor)
                  separa entrenamiento hasta 2015 y evaluación desde 2016.
                  Comprueba la relación estadística dentro de ERA5, no el
                  acierto del pronóstico futuro. Faltan pronósticos históricos
                  de SEAS5 y resultados reales de campo para medir y ajustar ese
                  acierto. EC46/SEAS5 tienen datos cada 6 horas; la malla del
                  mapa combina puntos cada 1° y 2° mediante interpolación.
                </p>
              </details>
              <p>
                <a
                  href="https://open-meteo.com/en/docs/seasonal-forecast-api"
                  target="_blank"
                  rel="noreferrer"
                >
                  EC46 / SEAS5
                </a>{" "}
                ·{" "}
                <a
                  href="https://open-meteo.com/en/docs/historical-weather-api"
                  target="_blank"
                  rel="noreferrer"
                >
                  ERA5
                </a>{" "}
                ·{" "}
                <a
                  href="https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/"
                  target="_blank"
                  rel="noreferrer"
                >
                  RONI de NOAA
                </a>
              </p>
            </section>
          </>
        )}
        {tab === "Reglas" && (
          <>
            <div className="data-title">
              <Settings2 size={22} />
              <div>
                <h1>Condiciones para trabajar</h1>
                <p>
                  Se aplican a todas las zonas. Al guardar se recalculan las
                  ventanas con los datos meteorológicos guardados.
                </p>
              </div>
            </div>
            <form
              className="climate-rule-form"
              onSubmit={(e) => {
                e.preventDefault();
                run("Guardando y recalculando", async () => {
                  await post("/api/campaign", { action: "rules", rules });
                  await refresh("history");
                  setMessage("Reglas guardadas y modelo recalculado.");
                });
              }}
            >
              <div className="climate-rule-grid">
                {fields.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    <div>
                      <input
                        type="number"
                        step={f.step ?? 1}
                        required
                        value={rules[f.key]}
                        onChange={(e) =>
                          setRules({
                            ...rules,
                            [f.key]: Number(e.target.value),
                          })
                        }
                      />
                      <span>{f.unit}</span>
                    </div>
                  </label>
                ))}
                <label>
                  Cierre de campaña
                  <input
                    required
                    type="date"
                    value={rules.deadline}
                    onChange={(e) =>
                      setRules({ ...rules, deadline: e.target.value })
                    }
                  />
                </label>
              </div>
              <button className="data-primary" type="submit" disabled={!!busy}>
                <Check size={15} />
                Guardar y recalcular
              </button>
            </form>
            <p className="data-method-note">
              Las cuadrillas y los caminos no cambian el potencial climático del
              mapa. Se mantienen como datos de ejecución; el cálculo principal
              indica cuándo el tiempo permite trabajar.
            </p>
          </>
        )}
        {tab === "Equipos" && (
          <>
            <div className="data-title">
              <MapPin size={22} />
              <div>
                <h1>Ubicaciones de los trabajos</h1>
                <p>
                  {data.plans.length} equipos. Las correcciones de coordenadas
                  se sincronizan conservando estados y comentarios.
                </p>
              </div>
            </div>
            <div className="data-equipment-actions">
              <input
                aria-label="Buscar equipo"
                placeholder="Equipo, campo o provincia"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                disabled={!!busy}
                onClick={() =>
                  run("Sincronizando mapa de origen", async () => {
                    const d = await post("/api/import", { url: sourceUrl });
                    setMessage(
                      `${d.updated} ubicaciones actualizadas · ${d.added} equipos nuevos`,
                    );
                  })
                }
              >
                <RefreshCw size={14} />
                Sincronizar Google My Maps
              </button>
              <label>
                <Upload size={14} />
                Importar archivo
                <input
                  type="file"
                  accept=".csv,.kml,.kmz,.json,.geojson"
                  disabled={!!busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    run("Importando equipos", async () => {
                      const body = new FormData();
                      body.set("file", file);
                      const r = await fetch("/api/import", {
                          method: "POST",
                          body,
                        }),
                        d = await r.json();
                      if (!r.ok) throw new Error(d.error);
                      setMessage(
                        `${d.updated} ubicaciones actualizadas · ${d.added} nuevas`,
                      );
                    });
                  }}
                />
              </label>
            </div>
            <div className="data-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Equipo</th>
                    <th>Campo / provincia</th>
                    <th>Latitud</th>
                    <th>Longitud</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pivots.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        {p.field}
                        <small>{p.province}</small>
                      </td>
                      <td>{p.lat.toFixed(5)}</td>
                      <td>{p.lon.toFixed(5)}</td>
                      <td>{p.status}</td>
                      <td>
                        <button onClick={() => setEdit({ ...p })}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {edit && (
          <div className="data-edit-backdrop">
            <form
              className="data-edit"
              onSubmit={(e) => {
                e.preventDefault();
                run("Guardando equipo", async () => {
                  await post("/api/campaign", { action: "pivot", pivot: edit });
                  setEdit(null);
                  setMessage(
                    "Equipo actualizado. Si cambió de zona, actualizá las fuentes meteorológicas.",
                  );
                });
              }}
            >
              <button
                type="button"
                className="climate-close"
                aria-label="Cerrar edición"
                onClick={() => setEdit(null)}
              >
                <X size={17} />
              </button>
              <h2>{edit.name}</h2>
              <p>{edit.field}</p>
              <label>
                Latitud
                <input
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  required
                  value={edit.lat}
                  onChange={(e) =>
                    setEdit({ ...edit, lat: Number(e.target.value) })
                  }
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
                  value={edit.lon}
                  onChange={(e) =>
                    setEdit({ ...edit, lon: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Estado
                <select
                  value={edit.status}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      status: e.target.value as Pivot["status"],
                    })
                  }
                >
                  {["PENDIENTE", "PROGRAMADO", "TERMINADO"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <button className="data-primary" disabled={!!busy} type="submit">
                Guardar cambios
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
