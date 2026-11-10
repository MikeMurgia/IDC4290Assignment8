// Great-circle path between two airports as [lat, lon] points (longitudes unwrapped so
// routes that cross the antimeridian, e.g. to Guam, do not wrap across the map).
export function greatCircle(a, b, n = 48) {
  const r = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a.lat * r, a.lon * r, b.lat * r, b.lon * r];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((la2 - la1) / 2) ** 2 +
          Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
      )
    );
  if (!d) return [[a.lat, a.lon], [b.lat, b.lon]];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    pts.push([Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r]);
  }
  for (let i = 1; i < pts.length; i++) {
    while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360;
    while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360;
  }
  return pts;
}

// One-hue sequential ramp (light -> dark blue) for magnitude, t in [0, 1].
const STOPS = ["#9ec5f4", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];
export function seqColor(t) {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const p = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [c1, c2] = [p(STOPS[i]), p(STOPS[i + 1])];
  return "#" + c1.map((v, k) => Math.round(v + (c2[k] - v) * f).toString(16).padStart(2, "0")).join("");
}

export const fmtPct = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
