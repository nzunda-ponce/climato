export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.WINDY_MAP_API_KEY?.trim();
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Frame-Options": "SAMEORIGIN",
    "X-Robots-Tag": "noindex, noarchive",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
  if (!key)
    return new Response(
      "<!doctype html><html lang=es><meta charset=utf-8><title>Windy</title><p>Windy no está configurado.</p><script>parent.postMessage({type:'climato-windy-error'},location.origin)</script></html>",
      { status: 503, headers },
    );
  // Map Forecast keys are browser credentials by design. Keep the value out of
  // Git/build bundles and restrict its allowed domains in the Windy account.
  const config = JSON.stringify(key).replace(/</g, "\\u003c");
  return new Response(
    `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Windy · equipos</title>
<style>html,body,#windy{width:100%;height:100%;margin:0;padding:0}body{background:#202e38}.climato-equipment{font:13px Arial,sans-serif}</style></head>
<body><div id="windy"></div><script>
(() => {
  const origin = location.origin;
  let api, markers, lastPoints = "", started = false;
  const send = (type, extra = {}) => parent.postMessage({type, ...extra}, origin);
  const fail = () => send("climato-windy-error");
  const load = (src) => new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = src;
    script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
  });
  const valid = (p) => p && typeof p.id === "string" && typeof p.name === "string" && Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 && Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 180;
  function update(data) {
    if (!api) return;
    if (["wind", "rain"].includes(data.overlay)) api.store.set("overlay", data.overlay);
    const points = Array.isArray(data.points) ? data.points.filter(valid) : [];
    const signature = JSON.stringify(points);
    if (signature === lastPoints) return;
    lastPoints = signature;
    markers.clearLayers();
    for (const point of points) {
      const label = document.createElement("div"); label.className = "climato-equipment";
      label.textContent = point.name + (point.field ? " · " + point.field : "");
      L.circleMarker([point.lat, point.lon], {radius: points.length === 1 ? 9 : 6, weight: 2, color: "#fff", fillColor: "#1b6847", fillOpacity: 1})
        .bindTooltip(label).on("click", () => send("climato-windy-select", {id:point.id})).addTo(markers);
    }
    if (points.length > 1) api.map.fitBounds(points.map((p) => [p.lat, p.lon]), {padding:[30,30],maxZoom:11});
    else if (points.length === 1) api.map.setView([points[0].lat,points[0].lon],11);
    else if (Number.isFinite(data.lat) && Number.isFinite(data.lon)) api.map.setView([data.lat,data.lon],5);
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== origin || event.source !== parent) return;
    if (event.data?.type === "climato-windy-connect") {
      if (api) send("climato-windy-ready");
      return;
    }
    if (event.data?.type !== "climato-windy-update") return;
    try { update(event.data); } catch { fail(); }
  });
  async function start() {
    try {
      await load("https://unpkg.com/leaflet@1.4.0/dist/leaflet.js");
      await load("https://api.windy.com/assets/map-forecast/libBoot.js");
      windyInit({key:${config},lat:-36.6,lon:-60.2,zoom:5,verbose:false}, (value) => {
        api = value; markers = L.layerGroup().addTo(api.map);
        api.overlays.wind.setMetric("km/h"); api.overlays.rain.setMetric("mm");
        started = true; send("climato-windy-ready");
      });
    } catch { fail(); }
  }
  setTimeout(() => {if (!started) fail();}, 40000);
  void start();
})();
</script></body></html>`,
    { headers },
  );
}
