"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PivotPlan } from "@/domain/types";
export default function PivotMap({
  plans,
  date,
  onSelect,
}: {
  plans: PivotPlan[];
  date: string;
  onSelect: (p: PivotPlan) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef("");
  useEffect(() => {
    if (!root.current) return;
    const m = L.map(root.current, { zoomControl: false }).setView(
      [-35, -63],
      5,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    for (const p of plans) {
      const day = p.days.find((d) => d.date === date);
      const color =
        p.pivot.status === "TERMINADO"
          ? "#8c99a2"
          : p.pivot.status === "PROGRAMADO"
            ? "#4d74d9"
            : day?.condition === "APTO"
              ? "#31856b"
              : day?.condition === "RIESGO"
                ? "#d8a342"
                : day?.condition === "NO APTO"
                  ? "#d06858"
                  : "#94a0ac";
      const marker = L.circleMarker([p.pivot.lat, p.pivot.lon], {
        radius: 8,
        fillColor: color,
        color: "#ffffff",
        weight: 2,
        fillOpacity: 1,
      });
      const label = document.createElement("span");
      label.textContent = p.pivot.name;
      marker.bindTooltip(label);
      marker.on("click", () => onSelect(p));
      marker.addTo(layer.current);
    }
    const key = plans
      .map(
        (p) =>
          `${p.pivot.id}:${p.pivot.lat}:${p.pivot.lon}:${!!p.locationWarning}`,
      )
      .join(",");
    if (plans.some((p) => !p.locationWarning) && fitted.current !== key) {
      map.current.fitBounds(
        L.latLngBounds(
          plans
            .filter((p) => !p.locationWarning)
            .map((p) => [p.pivot.lat, p.pivot.lon] as [number, number]),
        ),
        { padding: [45, 45], maxZoom: 10 },
      );
      fitted.current = key;
    }
  }, [plans, date, onSelect]);
  return (
    <div
      ref={root}
      className="map-canvas"
      aria-label="Mapa de pivots de la campaña"
    />
  );
}
