import L from "leaflet";
import { ForecastGrid } from "@/domain/seasonal";
import { createGridSampler } from "@/domain/weather-grid";

// Static geometry is uploaded once per map/date change. Only a time uniform
// changes while drawing: hundreds of moving streaks without SVG style/paint work.
export function mountWindRenderer(
  map: L.Map,
  grid: ForecastGrid,
  start: string,
  end: string,
  animated: boolean,
) {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const shader = (type: number, source: string) => {
    const result = gl.createShader(type)!;
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      gl.deleteShader(result);
      return null;
    }
    return result;
  };
  const vertex = shader(
    gl.VERTEX_SHADER,
    `
    attribute vec2 position;
    attribute vec3 weather;
    uniform vec2 resolution;
    varying vec3 flow;
    void main() {
      gl_Position = vec4(position.x / resolution.x * 2.0 - 1.0, 1.0 - position.y / resolution.y * 2.0, 0.0, 1.0);
      flow = weather;
    }
  `,
  );
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    `
    precision mediump float;
    uniform float time;
    varying vec3 flow;
    void main() {
      float intensity = clamp(flow.y / 45.0, 0.0, 1.0);
      float length = 3.0 + intensity * 15.0;
      float phase = mod(flow.x - time * (4.0 + flow.y * 1.6) + flow.z, 36.0);
      if (phase > length) discard;
      float tail = 0.4 + 0.6 * phase / length;
      gl_FragColor = vec4(1.0, 1.0, 1.0, (0.4 + intensity * 0.5) * tail);
    }
  `,
  );
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  canvas.className = "wind-particles";
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.windRenderer = "webgl";
  map.getPane("heatSurface")!.appendChild(canvas);
  const u = createGridSampler(grid, start, end, "u"),
    v = createGridSampler(grid, start, end, "v"),
    strength = createGridSampler(grid, start, end, "wind");
  const buffer = gl.createBuffer()!;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const position = gl.getAttribLocation(program, "position"),
    weather = gl.getAttribLocation(program, "weather");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(weather);
  gl.vertexAttribPointer(weather, 3, gl.FLOAT, false, 20, 8);
  const resolution = gl.getUniformLocation(program, "resolution"),
    time = gl.getUniformLocation(program, "time");
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  gl.clearColor(0, 0, 0, 0);
  let count = 0,
    frame = 0,
    moving = false,
    last = 0;
  const epoch = performance.now();
  const draw = (now: number) => {
    if (animated && !document.hidden && !moving)
      frame = requestAnimationFrame(draw);
    if (moving || (animated && now - last < 40)) return;
    last = now;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(time, animated ? ((now - epoch) / 1000) % 600 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  };
  const play = () => {
    cancelAnimationFrame(frame);
    canvas.dataset.windMotion =
      animated && !document.hidden && !moving ? "running" : "paused";
    if (document.hidden || moving) return;
    last = 0;
    draw(performance.now());
  };
  const reset = () => {
    cancelAnimationFrame(frame);
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    gl.viewport(0, 0, size.x, size.y);
    gl.uniform2f(resolution, size.x, size.y);
    const vertices: number[] = [];
    let lines = 0;
    const spacing = Math.max(28, Math.sqrt((size.x * size.y) / 550));
    for (let sy = 0; sy < size.y; sy += spacing)
      for (let sx = 0; sx < size.x; sx += spacing) {
        let x = sx + spacing * (0.5 + 0.3 * Math.sin(sx * 13 + sy * 7));
        let y = sy + spacing * (0.5 + 0.3 * Math.cos(sx * 3 + sy * 11));
        let distance = 0;
        const phase = (sx * 7 + sy * 3) % 36;
        let hasLine = false;
        for (let step = 0; step < 18; step++) {
          const ll = map.containerPointToLatLng([x, y]),
            east = u(ll.lat, ll.lng),
            north = v(ll.lat, ll.lng);
          if (east === null || north === null) break;
          const magnitude = Math.hypot(east, north);
          if (magnitude < 0.3) break;
          const speed = strength(ll.lat, ll.lng) ?? magnitude;
          const dx = (east / magnitude) * 6,
            dy = (-north / magnitude) * 6;
          const width = 0.45 + Math.min(1, speed / 45) * 0.5;
          const px = (-dy / 6) * width,
            py = (dx / 6) * width;
          const a = [x + px, y + py, distance, speed, phase],
            b = [x - px, y - py, distance, speed, phase];
          const c = [x + dx + px, y + dy + py, distance + 6, speed, phase],
            d = [x + dx - px, y + dy - py, distance + 6, speed, phase];
          vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
          x += dx;
          y += dy;
          distance += 6;
          hasLine = true;
        }
        if (hasLine) lines++;
      }
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    count = vertices.length / 5;
    canvas.dataset.windLines = String(lines);
    moving = false;
    canvas.style.visibility = "visible";
    play();
  };
  const move = () => {
    moving = true;
    cancelAnimationFrame(frame);
    canvas.style.visibility = "hidden";
  };
  reset();
  map.on("movestart zoomstart", move);
  map.on("moveend zoomend resize", reset);
  document.addEventListener("visibilitychange", play);
  return () => {
    cancelAnimationFrame(frame);
    map.off("movestart zoomstart", move);
    map.off("moveend zoomend resize", reset);
    document.removeEventListener("visibilitychange", play);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    canvas.remove();
  };
}
