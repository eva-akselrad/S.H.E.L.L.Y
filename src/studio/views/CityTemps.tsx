import type { CityTemps, StudioProduct } from "../../../shared/studio";
import { Basemap, C, Frame, LegendRow, layout, MapClip, SANS, SERIF, validLine, type Format } from "../Frame";
import { makeProjector, type Box } from "../../../shared/projection";
import type { Bbox } from "../../../shared/types";

/** Zoom onto the cities (with room for labels) and widen to the map box, so the Philadelphia cluster spreads out. */
export function cityView(cities: { lat: number; lon: number }[], fallback: Bbox, box: Box): Bbox {
  if (cities.length < 2) return fallback;
  const lats = cities.map((c) => c.lat);
  const lons = cities.map((c) => c.lon);
  const south = Math.min(...lats) - 0.3;
  const north = Math.max(...lats) + 0.35;
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const minLon = Math.min(...lons) - 0.45;
  const maxLon = Math.max(...lons) + 0.45;
  const lonSpan = Math.max(maxLon - minLon, ((north - south) * (box.w / box.h)) / k);
  const latSpan = Math.max(north - south, ((maxLon - minLon) * k * box.h) / box.w);
  const mLat = (south + north) / 2;
  const mLon = (minLon + maxLon) / 2;
  return { south: mLat - latSpan / 2, north: mLat + latSpan / 2, west: mLon - lonSpan / 2, east: mLon + lonSpan / 2 };
}

const STOPS: [number, string][] = [[10, "#6a5cff"], [32, "#3d8bff"], [45, "#3ecfd0"], [58, "#6fe08a"], [70, "#ffd23f"], [82, "#ff9f1c"], [95, "#ff4d4d"], [105, "#c2185b"]];

export function tempColor(f: number): string {
  if (f <= STOPS[0]![0]) return STOPS[0]![1];
  for (let i = 1; i < STOPS.length; i++) {
    if (f <= STOPS[i]![0]) return STOPS[i]![1];
  }
  return STOPS[STOPS.length - 1]![1];
}

const OFFSETS: [number, number][] = [
  [0, -50], [0, 56], [-96, -10], [96, -10], [-86, -62], [86, -62], [-86, 62], [86, 62], [0, -110], [0, 116], [-150, -10], [150, -10],
  [-140, -90], [140, -90], [-140, 90], [140, 90], [0, -170], [0, 176], [-210, -40], [210, -40], [-210, 40], [210, 40],
];
const BOX_W = 108;
const BOX_H = 70;

/**
 * Greedy label placement so the busy Philadelphia cluster stays readable: the first spot that is
 * clear of other labels, or, when none is, the least crowded one (never just the first spot).
 */
export function placeLabels(items: { c: CityTemps["cities"][number]; xy: [number, number] }[]): { c: CityTemps["cities"][number]; xy: [number, number]; bx: number; by: number }[] {
  const placed: { x: number; y: number }[] = [];
  // how far a spot is from overlapping its nearest label (bigger is better, >= 1 means clear)
  const room = (x: number, y: number) => placed.reduce((m, p) => Math.min(m, Math.max(Math.abs(p.x - x) / BOX_W, Math.abs(p.y - y) / BOX_H)), Infinity);
  return items.map((it) => {
    const [x, y] = it.xy;
    let best = OFFSETS[0]!;
    let bestRoom = -1;
    for (const off of OFFSETS) {
      const r = room(x + off[0], y + off[1]);
      if (r >= 1) { best = off; bestRoom = r; break; }
      if (r > bestRoom) { best = off; bestRoom = r; }
    }
    const bx = x + best[0];
    const by = y + best[1];
    placed.push({ x: bx, y: by });
    return { ...it, bx, by };
  });
}

const TITLES = { high: "Highs", low: "Lows", feelsLike: "Feels Like", pop: "Rain Chance", gust: "Wind Gusts" } as const;

const POP_STOPS: [number, string][] = [[10, "#5b6b86"], [30, "#7cc3ff"], [50, "#4ea3ff"], [70, "#2f7bff"], [100, "#1a4fd6"]];
const GUST_STOPS: [number, string][] = [[15, "#6fe08a"], [25, "#ffd23f"], [35, "#ff9f1c"], [45, "#ff4d4d"], [200, "#c2185b"]];
const pick = (stops: [number, string][], v: number): string => (stops.find(([max]) => v <= max) ?? stops[stops.length - 1]!)[1];

/** Colour stops, value colour and unit for each measure. */
export function metricStyle(metric: CityTemps["metric"]): { stops: [number, string][]; color: (v: number) => string; unit: string; range: (i: number) => string } {
  const span = (stops: [number, string][], u: string) => (i: number) =>
    i === 0 ? `${stops[0]![0]}${u} and below` : i === stops.length - 1 ? `${stops[i - 1]![0] + 1}${u} and up` : `${stops[i - 1]![0] + 1}${u} to ${stops[i]![0]}${u}`;
  if (metric === "pop") return { stops: POP_STOPS, color: (v) => pick(POP_STOPS, v), unit: "%", range: span(POP_STOPS, "%") };
  if (metric === "gust") return { stops: GUST_STOPS, color: (v) => pick(GUST_STOPS, v), unit: " mph", range: span(GUST_STOPS, " mph") };
  return { stops: STOPS, color: tempColor, unit: "°", range: span(STOPS, "°") };
}

export function CityTempsView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const body = product.body as CityTemps;
  const ms = metricStyle(body.metric);
  const short = body.metric === "gust" ? "" : ms.unit;
  const view = cityView(body.cities, product.region, layout(fmt).map);
  const proj = makeProjector(view, layout(fmt).map);
  const L = layout(fmt);
  const wide = fmt === "wide";
  const vals = body.cities.map((c) => c.value);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 0;
  const hottest = body.cities.find((c) => c.value === hi);
  const coldest = body.cities.find((c) => c.value === lo);
  return (
    <Frame fmt={fmt} title={product.title || TITLES[body.metric]} sub={validLine(product.validFrom, product.validTo)} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
      <Basemap proj={proj} bbox={view} />
      <MapClip proj={proj} id="ct-clip">
        {placeLabels(body.cities.map((c) => ({ c, xy: proj.xy(c.lon, c.lat) }))).map(({ c, xy: [x, y], bx, by }) => {
          const col = ms.color(c.value);
          return (
            <g key={c.name}>
              <line x1={x} y1={y} x2={bx} y2={by} stroke={col} stroke-width="2" opacity=".7" />
              <circle cx={x} cy={y} r="7" fill={col} stroke="#0b1220" stroke-width="3" />
              <rect x={bx - 44} y={by - 24} width="88" height="42" rx="11" fill={C.bg} stroke={col} stroke-width="3" />
              <text x={bx} y={by + 9} text-anchor="middle" font-family={SERIF} font-size="32" font-weight="700" fill={C.text}>{Math.round(c.value)}{short}</text>
              <text x={bx} y={by + 40} text-anchor="middle" font-family={SANS} font-size="20" font-weight="600" fill={C.text} stroke={C.bg} stroke-width="5" paint-order="stroke">{c.name}</text>
            </g>
          );
        })}
      </MapClip>
      <g transform={`translate(${L.side.x} ${L.side.y})`}>
        <text y="40" font-family={SERIF} font-size="40" font-weight="700" fill={C.text}>{TITLES[body.metric]}</text>
        {wide ? (
          <>
            {ms.stops.map(([v, col], i) => <LegendRow key={v} x={0} y={110 + i * 56} color={col} label={ms.range(i)} />)}
            {hottest && <text y="620" font-family={SANS} font-size="28" fill={C.text}>{body.metric === "pop" ? "Wettest" : body.metric === "gust" ? "Windiest" : "Warmest"}: {hottest.name} {Math.round(hottest.value)}{ms.unit}</text>}
            {coldest && <text y="664" font-family={SANS} font-size="28" fill={C.text}>{body.metric === "pop" ? "Driest" : body.metric === "gust" ? "Calmest" : "Coolest"}: {coldest.name} {Math.round(coldest.value)}{ms.unit}</text>}
          </>
        ) : (
          <>
            {ms.stops.map(([v, col], i) => <g key={v} transform={`translate(${(i % 4) * 250} ${90 + Math.floor(i / 4) * 70})`}><rect y="-22" width="34" height="26" rx="6" fill={col} /><text x="46" font-family={SANS} font-size="24" fill={C.text}>{i === 0 ? `≤${v}${ms.unit.trim()}` : `to ${v}${ms.unit.trim()}`}</text></g>)}
          </>
        )}
      </g>
    </Frame>
  );
}
