"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PlanningZone } from "@/domain/planning-report";
import {
  availabilityCell,
  availabilityColor,
  availabilityBacking,
} from "@/domain/availability-matrix";

export default function AvailabilityMap({
  items,
  dates,
  onDetail,
}: {
  items: PlanningZone[];
  dates: string[];
  onDetail: (key: string, date: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null),
    fitted = useRef("");
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const m = L.map(root.current, { scrollWheelZoom: false }).setView(
      [-35, -62],
      5,
    );
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      },
    ).addTo(m);
    tiles.on("tileerror", () => setTileError(true));
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(root.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const points = [
      ...new Map(items.map((z) => [z.locationKey ?? z.key, z])).values(),
    ].filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lon));
    for (const z of points) {
      const cell = availabilityCell([z], dates);
      const marker = L.circleMarker([z.lat, z.lon], {
        radius: 7,
        weight: 1.5,
        color: cell.complete ? "#2268ab" : "#ad7134",
        dashArray: cell.complete ? undefined : "3 2",
        fillColor: availabilityColor(cell.probability).backgroundColor,
        fillOpacity: 0.95,
      });
      const box = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = z.equipment.map((e) => e.name).join(", ");
      box.append(title);
      const value = document.createElement("p");
      value.textContent = `${cell.probability === null ? "Sin datos" : Math.round(cell.probability * 100) + "%"} · ${availabilityBacking(cell)}${cell.complete ? "" : " · Parcial"}`;
      box.append(value);
      const action = document.createElement("button");
      action.textContent = "Ver ubicación y horarios";
      action.onclick = () => onDetail(z.key, dates[0]);
      box.append(action);
      marker.bindPopup(box);
      marker.addTo(layer.current);
    }
    const key = points.map((z) => z.key).join("|");
    if (points.length && key !== fitted.current) {
      map.current.fitBounds(
        L.latLngBounds(points.map((z) => [z.lat, z.lon] as [number, number])),
        { padding: [30, 30], maxZoom: 11 },
      );
      fitted.current = key;
    }
  }, [items, dates, onDetail]);
  return (
    <>
      <div
        ref={root}
        className="analysis-map"
        role="region"
        aria-label="Mapa de disponibilidad por coordenada"
      />
      {tileError && (
        <p className="studio-footnote" role="status">
          No se pudo cargar parte del mapa base. Las estimaciones siguen
          disponibles en la matriz.
        </p>
      )}
    </>
  );
}
