"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import { mountWindRenderer } from "./wind-renderer";
import { PivotPlan } from "@/domain/types";
import { ForecastGrid } from "@/domain/seasonal";
import {
  createGridSampler,
  weatherColor,
  weatherPeriodDays,
} from "@/domain/weather-grid";
import {
  MapLayer,
  mapValue,
  layerColor,
  weightedSurface,
} from "@/domain/map-layer";
export default function OperationalMap({
  plans,
  date,
  layer,
  heat,
  opacity,
  radiusKm,
  selectedId,
  onSelect,
  surface,
  grid,
  field,
  periodEnd,
  focusKey,
  animateWind = false,
  windOverlay = false,
}: {
  plans: PivotPlan[];
  date: string;
  layer: MapLayer;
  heat: boolean;
  opacity: number;
  radiusKm: number;
  selectedId?: string;
  onSelect: (p: PivotPlan) => void;
  surface?: {
    lat: number;
    lon: number;
    value: number;
    key: string;
    label: string;
  }[];
  grid?: ForecastGrid;
  field?: "wind" | "rain";
  periodEnd?: string;
  focusKey?: number;
  animateWind?: boolean;
  windOverlay?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    markers = useRef<L.LayerGroup | null>(null),
    canvas = useRef<HTMLCanvasElement | null>(null),
    fitted = useRef("");
  useEffect(() => {
    if (!container.current) return;
    const m = L.map(container.current, {
      zoomControl: false,
      preferCanvas: false,
      zoomSnap: 0.25,
    }).setView([-34.5, -63], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    m.createPane("heatSurface");
    m.getPane("heatSurface")!.style.zIndex = "350";
    m.getPane("heatSurface")!.style.pointerEvents = "none";
    const c = L.DomUtil.create(
      "canvas",
      "operational-heat",
      m.getPane("heatSurface"),
    );
    canvas.current = c;
    map.current = m;
    markers.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m || !markers.current) return;
    markers.current.clearLayers();
    for (const p of plans) {
      if (p.locationWarning) continue;
      const sample = surface?.find(
        (s) =>
          s.key ===
          `${Math.round(p.pivot.lat * 4) / 4},${Math.round(p.pivot.lon * 4) / 4}`,
      );
      const value = surface
        ? (sample?.value ?? null)
        : mapValue(p, date, layer);
      const rgb = value === null ? [140, 151, 164] : layerColor(value, layer);
      const color =
        p.pivot.status === "TERMINADO"
          ? "#7d8999"
          : p.pivot.status === "PROGRAMADO"
            ? "#5289f4"
            : `rgb(${rgb.join(",")})`;
      const marker = L.circleMarker([p.pivot.lat, p.pivot.lon], {
        radius: p.pivot.id === selectedId ? 9 : surface ? 3 : 6,
        fillColor: color,
        color: "#ffffff",
        weight: p.pivot.id === selectedId ? 3 : 1.7,
        fillOpacity: 1,
      });
      const tooltip = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = p.pivot.name;
      tooltip.append(title);
      const detail = document.createElement("div");
      detail.textContent = `${p.pivot.field} · ${surface ? (sample?.label ?? "SIN DATOS") : (p.days.find((d) => d.date === date)?.condition ?? "SIN DATOS")}`;
      tooltip.append(detail);
      marker.bindTooltip(tooltip, { direction: "top" });
      marker.on("click", () => onSelect(p));
      marker.addTo(markers.current);
    }
    const key =
      plans
        .filter((p) => !p.locationWarning)
        .map((p) => p.pivot.id)
        .sort()
        .join() + String(focusKey ?? 0);
    if (plans.some((p) => !p.locationWarning) && fitted.current !== key) {
      m.fitBounds(
        L.latLngBounds(
          plans
            .filter((p) => !p.locationWarning)
            .map((p) => [p.pivot.lat, p.pivot.lon] as [number, number]),
        ),
        {
          paddingTopLeft: [surface ? 35 : 300, 80],
          paddingBottomRight: [surface ? 35 : 180, surface ? 35 : 160],
          maxZoom: 8,
        },
      );
      if (grid)
        m.panInsideBounds(
          L.latLngBounds(
            [grid.bounds.south, grid.bounds.west],
            [grid.bounds.north, grid.bounds.east],
          ),
          { animate: false },
        );
      fitted.current = key;
    }
  }, [plans, date, layer, selectedId, onSelect, surface, focusKey]);
  useEffect(() => {
    const m = map.current;
    if (!m || !grid) return;
    const bounds = L.latLngBounds(
      [grid.bounds.south, grid.bounds.west],
      [grid.bounds.north, grid.bounds.east],
    );
    const constrain = () => {
      // Keep the viewport inside the real weather coverage, including after
      // resizing from a narrow screen to a desktop layout.
      const zoom = Math.ceil(m.getBoundsZoom(bounds, true) * 4) / 4;
      m.setMinZoom(zoom);
      m.panInsideBounds(bounds, { animate: false });
    };
    m.setMaxBounds(bounds);
    constrain();
    m.on("resize", constrain);
    return () => {
      m.off("resize", constrain);
      m.options.maxBounds = undefined;
      m.setMinZoom(0);
    };
  }, [grid]);
  useEffect(() => {
    const m = map.current,
      c = canvas.current;
    if (!m || !c) return;
    const draw = () => {
      const size = m.getSize();
      c.width = size.x;
      c.height = size.y;
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.x, size.y);
      if (!heat) return;
      if (field && !grid) return;
      if (grid && field) {
        const sample = createGridSampler(grid, date, periodEnd ?? date, field),
          periodDays = weatherPeriodDays(date, periodEnd ?? date),
          step = 6;
        for (let y = 0; y < size.y; y += step)
          for (let x = 0; x < size.x; x += step) {
            const ll = m.containerPointToLatLng([x + step / 2, y + step / 2]),
              value = sample(ll.lat, ll.lng);
            if (value === null) continue;
            ctx.fillStyle = `rgba(${weatherColor(value, field, periodDays).join(",")},${opacity})`;
            ctx.fillRect(x, y, step + 1, step + 1);
          }
        if (field === "wind" && !animateWind) {
          const u = createGridSampler(grid, date, periodEnd ?? date, "u"),
            v = createGridSampler(grid, date, periodEnd ?? date, "v");
          ctx.strokeStyle = "rgba(255,255,255,.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let y = 35; y < size.y; y += 65)
            for (let x = 35; x < size.x; x += 65) {
              const ll = m.containerPointToLatLng([x, y]),
                east = u(ll.lat, ll.lng),
                north = v(ll.lat, ll.lng);
              if (east === null || north === null) continue;
              const speed = Math.hypot(east, north);
              if (speed < 0.2) continue;
              const dx = (east / speed) * 10,
                dy = (-north / speed) * 10;
              ctx.moveTo(x - dx, y - dy);
              ctx.lineTo(x + dx, y + dy);
              ctx.moveTo(x + dx, y + dy);
              ctx.lineTo(
                x + dx - dx * 0.45 + dy * 0.35,
                y + dy - dy * 0.45 - dx * 0.35,
              );
              ctx.moveTo(x + dx, y + dy);
              ctx.lineTo(
                x + dx - dx * 0.45 - dy * 0.35,
                y + dy - dy * 0.45 + dx * 0.35,
              );
            }
          ctx.stroke();
        }
        return;
      }
      const sourcePoints =
        surface ??
        plans
          .filter((p) => p.pivot.status !== "TERMINADO")
          .flatMap((p) => {
            const value = mapValue(p, date, layer);
            if (value === null) return [];
            return [{ lat: p.pivot.lat, lon: p.pivot.lon, value }];
          });
      const points = sourcePoints.map((p) => {
        const point = m.latLngToContainerPoint([p.lat, p.lon]);
        const edge = m.latLngToContainerPoint([p.lat + radiusKm / 111, p.lon]);
        return {
          x: point.x,
          y: point.y,
          radius: Math.max(1, point.distanceTo(edge)),
          value: p.value,
        };
      });
      const step = 8;
      for (let y = 0; y < size.y; y += step)
        for (let x = 0; x < size.x; x += step) {
          const sample = weightedSurface(points, x + step / 2, y + step / 2);
          if (!sample) continue;
          ctx.fillStyle = `rgba(${layerColor(sample.value, layer).join(",")},${Math.min(0.9, sample.coverage * (surface ? 3 : 1)) * opacity})`;
          ctx.fillRect(x, y, step + 1, step + 1);
        }
    };
    draw();
    m.on("moveend zoomend resize", draw);
    return () => {
      m.off("moveend zoomend resize", draw);
    };
  }, [
    plans,
    date,
    layer,
    heat,
    opacity,
    radiusKm,
    surface,
    grid,
    field,
    periodEnd,
    animateWind,
  ]);
  useEffect(() => {
    const m = map.current;
    if (!m || !grid || !heat || (!windOverlay && field !== "wind")) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const accelerated = mountWindRenderer(
      m,
      grid,
      date,
      periodEnd ?? date,
      animateWind && !reducedMotion,
    );
    if (accelerated) return accelerated;
    // Build streamlines only when the map or date changes. CSS moves the
    // streaks; no map projection, sampling or full-canvas fading per frame.
    const pane = m.getPane("heatSurface")!;
    const ns = "http://www.w3.org/2000/svg";
    const c = document.createElementNS(ns, "svg");
    c.classList.add("wind-particles");
    c.setAttribute("aria-hidden", "true");
    c.classList.toggle("wind-paused", !animateWind);
    pane.appendChild(c);
    const u = createGridSampler(grid, date, periodEnd ?? date, "u"),
      v = createGridSampler(grid, date, periodEnd ?? date, "v"),
      strength = createGridSampler(grid, date, periodEnd ?? date, "wind");
    const reset = () => {
      const size = m.getSize();
      c.setAttribute("width", String(size.x));
      c.setAttribute("height", String(size.y));
      c.setAttribute("viewBox", `0 0 ${size.x} ${size.y}`);
      const origin = m.containerPointToLayerPoint([0, 0]);
      c.style.transform = `translate3d(${origin.x}px, ${origin.y}px, 0)`;
      c.replaceChildren();
      // Five animation groups keep the dense field cheap to animate.
      const groups = [4, 10, 20, 35, 55].map((speed) => {
        const group = document.createElementNS(ns, "g");
        group.classList.add("wind-flow-group");
        const duration = Math.max(1.4, 80 / speed);
        group.style.setProperty("--flow-duration", `${duration}s`);
        group.style.setProperty(
          "--flow-steps",
          String(Math.round(duration * 18)),
        );
        c.appendChild(group);
        return group;
      });
      const spacing = Math.max(80, Math.sqrt((size.x * size.y) / 100));
      for (let sy = 0; sy < size.y; sy += spacing) {
        for (let sx = 0; sx < size.x; sx += spacing) {
          let x = sx + spacing * (0.5 + 0.3 * Math.sin(sx * 13 + sy * 7));
          let y = sy + spacing * (0.5 + 0.3 * Math.cos(sx * 3 + sy * 11));
          let path = `M${x.toFixed(1)},${y.toFixed(1)}`;
          let speed = 0,
            steps = 0;
          for (let j = 0; j < 18; j++) {
            const ll = m.containerPointToLatLng([x, y]);
            const east = u(ll.lat, ll.lng),
              north = v(ll.lat, ll.lng);
            if (east === null || north === null) break;
            const magnitude = Math.hypot(east, north);
            if (magnitude < 0.3) break;
            // Mercator is locally conformal: east goes right, north goes up.
            x += (east / magnitude) * 6;
            y -= (north / magnitude) * 6;
            path += ` L${x.toFixed(1)},${y.toFixed(1)}`;
            speed += strength(ll.lat, ll.lng) ?? magnitude;
            steps++;
          }
          if (steps < 3) continue;
          const streak = document.createElementNS(ns, "path");
          streak.setAttribute("d", path);
          streak.classList.add("wind-stream");
          const meanSpeed = speed / steps;
          const intensity = Math.min(1, meanSpeed / 45);
          const length = 3 + intensity * 15;
          streak.style.strokeDasharray = `${length} ${36 - length}`;
          streak.style.strokeWidth = String(0.65 + intensity * 0.8);
          streak.style.opacity = String(0.28 + intensity * 0.5);
          // A full cycle is four 36px dash periods, regardless of intensity.
          groups[
            meanSpeed < 7
              ? 0
              : meanSpeed < 15
                ? 1
                : meanSpeed < 27
                  ? 2
                  : meanSpeed < 45
                    ? 3
                    : 4
          ].appendChild(streak);
        }
      }
      c.style.visibility = "visible";
    };
    const move = () => {
      c.style.visibility = "hidden";
    };
    const visibility = () => {
      for (const path of c.children) {
        (path as SVGElement).style.animationPlayState =
          document.hidden || !animateWind ? "paused" : "running";
      }
    };
    reset();
    visibility();
    document.addEventListener("visibilitychange", visibility);
    m.on("movestart zoomstart", move);
    m.on("moveend zoomend resize", reset);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      m.off("movestart zoomstart", move);
      m.off("moveend zoomend resize", reset);
      c.remove();
    };
  }, [grid, date, periodEnd, field, heat, animateWind, windOverlay]);
  return (
    <div
      ref={container}
      className="operational-map"
      aria-label="Mapa operativo de disponibilidad"
    />
  );
}
