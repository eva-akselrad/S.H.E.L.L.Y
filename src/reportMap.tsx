// Inline SVG map for the damage report: no raster tiles, so it prints crisply in black and white.
// The address is the centre; rings mark 1, 5 and 10 miles; shapes (not colours) tell the report types apart.
import type { DamageReport, ReportItem } from "../shared/damage";

const SIZE = 320;
const C = SIZE / 2;
const RANGE_MI = 11.5; // half-width of the map in miles
const PX = C / RANGE_MI;
const MI_LAT = 69.0;

export function ReportMap({ report, listed }: { report: DamageReport; listed: ReportItem[] }) {
  const { lat, lon } = report.point;
  const miLon = 69.172 * Math.cos((lat * Math.PI) / 180);
  const xy = (la: number, lo: number): [number, number] => [C + (lo - lon) * miLon * PX, C - (la - lat) * MI_LAT * PX];

  const rings = report.warningShapes.flatMap((g, gi) => {
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as unknown as number[][][][];
    return polys.map((poly, pi) => {
      const d = poly
        .map((ring) => `M${ring.map(([lo, la]) => xy(la!, lo!).map((n) => n.toFixed(1)).join(",")).join("L")}Z`)
        .join("");
      return <path key={`${gi}-${pi}`} d={d} class="rm-warn" fill-rule="evenodd" />;
    });
  });

  return (
    <figure class="rp-map">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Map of storm reports around the address">
        <defs>
          <clipPath id="rm-clip">
            <rect width={SIZE} height={SIZE} />
          </clipPath>
        </defs>
        <rect class="rm-bg" width={SIZE} height={SIZE} />
        <g clip-path="url(#rm-clip)">
          {rings}
          {[1, 5, 10].map((mi) => (
            <g key={mi}>
              <circle class="rm-ring" cx={C} cy={C} r={mi * PX} />
              <text class="rm-lbl" x={C + 3} y={C - mi * PX - 2}>
                {mi} mi
              </text>
            </g>
          ))}
          {report.gusts.map((g) => {
            const [x, y] = xy(g.lat, g.lon);
            return (
              <g key={g.station}>
                <path class="rm-gust" d={`M${x - 4},${y}H${x + 4}M${x},${y - 4}V${y + 4}`} />
                <text class="rm-lbl" x={x + 5} y={y + 3}>
                  {g.station} {g.mph}
                </text>
              </g>
            );
          })}
          {listed.map((r, i) => {
            const [x, y] = xy(r.lat, r.lon);
            return (
              <g key={`${r.time}${r.lat}${r.lon}${r.kind}`} class={`rm-r rm-${r.kind}`}>
                {shape(r.kind, x, y)}
                <text class="rm-num" x={x + 7} y={y - 5}>
                  {i + 1}
                </text>
              </g>
            );
          })}
        </g>
        {/* the address */}
        <circle class="rm-home-o" cx={C} cy={C} r="6" />
        <circle class="rm-home" cx={C} cy={C} r="2.5" />
        <text class="rm-n" x={SIZE - 16} y="16">
          N ↑
        </text>
      </svg>
      <figcaption>
        <span>● address</span>
        <span>▲ wind</span>
        <span>■ hail</span>
        <span>◆ flood</span>
        <span>★ tornado</span>
        <span>+ gust station</span>
        <span class="rm-key-warn">▭ warning area</span>
      </figcaption>
    </figure>
  );
}

function shape(kind: ReportItem["kind"], x: number, y: number) {
  if (kind === "wind") return <path d={`M${x},${y - 5}L${x + 5},${y + 4}L${x - 5},${y + 4}Z`} />;
  if (kind === "hail") return <rect x={x - 4} y={y - 4} width="8" height="8" />;
  if (kind === "flood") return <path d={`M${x},${y - 5}L${x + 5},${y}L${x},${y + 5}L${x - 5},${y}Z`} />;
  const pts = Array.from({ length: 10 }, (_, k) => {
    const rr = k % 2 ? 2.4 : 6;
    const a = (k * Math.PI) / 5 - Math.PI / 2;
    return `${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return <polygon points={pts} />;
}
