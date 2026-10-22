export type PlotPoint = { x: number; y: number };
const f = (value: number) => Number(value.toFixed(2));

// Cubic controls stay inside each pair of observations. This rounds the joins
// without overshoot, moving observed points, or crossing missing observations.
export function smoothSegments(points: (PlotPoint | null)[]) {
  const output = Array<string>(points.length).fill("");
  let start = 0;
  while (start < points.length) {
    if (!points[start]) {
      start++;
      continue;
    }
    let end = start;
    while (end + 1 < points.length && points[end + 1]) end++;
    const rows = points.slice(start, end + 1) as PlotPoint[];
    const slopes = rows
      .slice(1)
      .map((point, i) => (point.y - rows[i].y) / (point.x - rows[i].x || 1));
    const tangent = rows.map((_, i) => {
      if (i === 0) return slopes[0] ?? 0;
      if (i === rows.length - 1) return slopes.at(-1) ?? 0;
      const before = slopes[i - 1],
        after = slopes[i];
      return before * after <= 0 ? 0 : (2 * before * after) / (before + after);
    });
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i],
        b = rows[i + 1],
        width = (b.x - a.x) / 3;
      const low = Math.min(a.y, b.y),
        high = Math.max(a.y, b.y);
      const clamp = (value: number) => Math.max(low, Math.min(high, value));
      output[start + i] =
        `M${f(a.x)},${f(a.y)} C${f(a.x + width)},${f(clamp(a.y + tangent[i] * width))} ${f(b.x - width)},${f(clamp(b.y - tangent[i + 1] * width))} ${f(b.x)},${f(b.y)}`;
    }
    start = end + 1;
  }
  return output;
}

export function smoothPath(points: (PlotPoint | null)[]) {
  return smoothSegments(points).filter(Boolean).join(" ");
}
