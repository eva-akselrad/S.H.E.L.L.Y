// Builds src/studio/basemap.json: county outlines (US Census data via the us-atlas package,
// public domain) for the SHELLY Live region plus a margin. Run once: node scripts/gen-basemap.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { feature, mesh } from "topojson-client";

const BOX = { south: 37.6, west: -77.6, north: 42.2, east: -72.8 };
const TOL = 0.004; // degrees, Douglas-Peucker

const topo = JSON.parse(readFileSync("node_modules/us-atlas/counties-10m.json", "utf8"));

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// closed rings have identical ends, so split at the farthest point first
function dpRing(r, tol) {
  if (r.length < 5) return r;
  let far = 1, best = -1;
  for (let i = 1; i < r.length - 1; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = dp(r.slice(0, far + 1), tol), b = dp(r.slice(far), tol);
  return [...a, ...b.slice(1)];
}
const flat = (pts) => pts.flatMap(([x, y]) => [Math.round(x * 1000), Math.round(y * 1000)]);
const inBox = ([x, y]) => x >= BOX.west && x <= BOX.east && y >= BOX.south && y <= BOX.north;
const ringInBox = (r) => r.some(inBox);

const counties = [];
for (const f of feature(topo, topo.objects.counties).features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const keepPolys = polys
    .filter((p) => ringInBox(p[0]))
    .map((p) => p.map((r) => flat(dpRing(r, TOL))).filter((r) => r.length >= 6));
  if (keepPolys.length) counties.push({ id: String(f.id), name: f.properties.name, polys: keepPolys });
}

// state borders: only the pieces of the mesh that touch the box
const border = mesh(topo, topo.objects.states, (a, b) => a !== b);
const lines = border.coordinates.filter((l) => l.some(inBox)).map((l) => flat(dp(l, TOL))).filter((l) => l.length >= 4);

writeFileSync("src/studio/basemap.json", JSON.stringify({ box: BOX, counties, borders: lines }));
console.log(`counties: ${counties.length}, border lines: ${lines.length}`);
