"use client";

import { useEffect, useRef, useState } from "react";

export interface WindyPoint {
  id: string;
  name: string;
  field?: string;
  lat: number;
  lon: number;
}

export default function WindyMap({
  enabled,
  embed,
  lat,
  lon,
  zoom,
  overlay,
  points,
  onSelect,
}: {
  enabled: boolean;
  embed: string;
  lat: number;
  lon: number;
  zoom: number;
  overlay: string;
  points: WindyPoint[];
  onSelect: (id: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const [basic, setBasic] = useState(false);
  const api = enabled && !basic;
  const latest = useRef({ lat, lon, zoom, overlay, points });
  latest.current = { lat, lon, zoom, overlay, points };
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    if (!api) return;
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.type === "climato-windy-ready") {
        setStatus("ready");
        frame.current?.contentWindow?.postMessage(
          { type: "climato-windy-update", ...latest.current },
          window.location.origin,
        );
      }
      if (event.data?.type === "climato-windy-error") setStatus("error");
      if (
        event.data?.type === "climato-windy-select" &&
        typeof event.data.id === "string" &&
        latest.current.points.some((p) => p.id === event.data.id)
      )
        select.current(event.data.id);
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage(
      { type: "climato-windy-connect" },
      window.location.origin,
    );
    const timeout = window.setTimeout(
      () => setStatus((current) => (current === "ready" ? current : "error")),
      45000,
    );
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(timeout);
    };
  }, [api, attempt]);
  useEffect(() => {
    if (api && status === "ready")
      frame.current?.contentWindow?.postMessage(
        { type: "climato-windy-update", ...latest.current },
        window.location.origin,
      );
  }, [api, status, lat, lon, zoom, overlay, points]);
  return (
    <div className="work-map-frame">
      <iframe
        ref={frame}
        key={`${api}-${attempt}`}
        title="Windy · mapa de equipos"
        src={
          api
            ? `/windy-map?attempt=${attempt}`
            : `https://embed.windy.com/embed.html?${embed}`
        }
        allowFullScreen
      />
      {api && status === "loading" && (
        <div className="work-map-status" role="status">
          Conectando con Windy…
        </div>
      )}
      {api && status === "error" && (
        <div className="work-map-status" role="alert">
          <p>No se pudo conectar con Windy.</p>
          <button
            onClick={() => {
              setStatus("loading");
              setAttempt((value) => value + 1);
            }}
          >
            Reintentar
          </button>
          <button onClick={() => setBasic(true)}>Ver mapa básico</button>
        </div>
      )}
    </div>
  );
}
