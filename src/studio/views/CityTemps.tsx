import type { CityTemps, StudioProduct } from "../../../shared/studio";
import { Basemap, C, Frame, LegendRow, layout, mapProjector, MapClip, SANS, SERIF, validLine, type Format } from "../Frame";

const STOPS: [number, string][] = [[10, "#6a5cff"], [32, "#3d8bff"], [45, "#3ecfd0"], [58, "#6fe08a"], [70, "#ffd23f"], [82, "#ff9f1c"], [95, "#ff4d4d"], [105, "#c2185b"]];

export function tempColor(f: number): string {
  if (f <= STOPS[0]![0]) return STOPS[0]![1];
  for (let i = 1; i < STOPS.length; i++) {
    if (f <= STOPS[i]![0]) return STOPS[i]![1];
  }
  return STOPS[STOPS.length - 1]![1];
}

const OFFSETS: [number, number][] = [[0, -50], [0, 56], [-96, -10], [96, -10], [-86, -62], [86, -62], [-86, 62], [86, 62], [0, -110], [0, 116], [-150, -10], [150, -10]];

/** Greedy label placement so the busy Philadelphia cluster stays readable. */
export function placeLabels(items: { c: CityTemps["cities"][number]; xy: [number, number] }[]): { c: CityTemps["cities"][number]; xy: [number, number]; bx: number; by: number }[] {
  const placed: { x: number; y: number }[] = [];
  const hit = (x: number, y: number) => placed.some((p) => Math.abs(p.x - x) < 108 && Math.abs(p.y - y) < 70);
  return items.map((it) => {
    const [x, y] = it.xy;
    const off = OFFSETS.find(([dx, dy]) => !hit(x + dx, y + dy)) ?? OFFSETS[0]!;
    const bx = x + off[0];
    const by = y + off[1];
    placed.push({ x: bx, y: by });
    return { ...it, bx, by };
  });
}

const TITLES = { high: "Highs", low: "Lows", feelsLike: "Feels Like" } as const;

export function CityTempsView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const body = product.body as CityTemps;
  const proj = mapProjector(fmt, product.region);
  const L = layout(fmt);
  const wide = fmt === "wide";
  const vals = body.cities.map((c) => c.value);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 0;
  const hottest = body.cities.find((c) => c.value === hi);
  const coldest = body.cities.find((c) => c.value === lo);
  return (
    <Frame fmt={fmt} title={product.title || TITLES[body.metric]} sub={validLine(product.validFrom, product.validTo)} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
      <Basemap proj={proj} bbox={product.region} />
      <MapClip proj={proj} id="ct-clip">
        {placeLabels(body.cities.map((c) => ({ c, xy: proj.xy(c.lon, c.lat) }))).map(({ c, xy: [x, y], bx, by }) => {
          const col = tempColor(c.value);
          return (
            <g key={c.name}>
              <line x1={x} y1={y} x2={bx} y2={by} stroke={col} stroke-width="2" opacity=".7" />
              <circle cx={x} cy={y} r="7" fill={col} stroke="#0b1220" stroke-width="3" />
              <rect x={bx - 44} y={by - 24} width="88" height="42" rx="11" fill={C.bg} stroke={col} stroke-width="3" />
              <text x={bx} y={by + 9} text-anchor="middle" font-family={SERIF} font-size="32" font-weight="700" fill={C.text}>{Math.round(c.value)}°</text>
              <text x={bx} y={by + 40} text-anchor="middle" font-family={SANS} font-size="20" font-weight="600" fill={C.text} stroke={C.bg} stroke-width="5" paint-order="stroke">{c.name}</text>
            </g>
          );
        })}
      </MapClip>
      <g transform={`translate(${L.side.x} ${L.side.y})`}>
        <text y="40" font-family={SERIF} font-size="40" font-weight="700" fill={C.text}>{TITLES[body.metric]}</text>
        {wide ? (
          <>
            {STOPS.map(([v, col], i) => <LegendRow key={v} x={0} y={110 + i * 56} color={col} label={i === 0 ? `${v}° and below` : i === STOPS.length - 1 ? `${STOPS[i - 1]![0] + 1}° and up` : `${STOPS[i - 1]![0] + 1}° to ${v}°`} />)}
            {hottest && <text y="620" font-family={SANS} font-size="28" fill={C.text}>Warmest: {hottest.name} {Math.round(hottest.value)}°</text>}
            {coldest && <text y="664" font-family={SANS} font-size="28" fill={C.text}>Coolest: {coldest.name} {Math.round(coldest.value)}°</text>}
          </>
        ) : (
          <>
            {STOPS.map(([v, col], i) => <g key={v} transform={`translate(${(i % 4) * 250} ${90 + Math.floor(i / 4) * 70})`}><rect y="-22" width="34" height="26" rx="6" fill={col} /><text x="46" font-family={SANS} font-size="24" fill={C.text}>{i === 0 ? `≤${v}°` : `to ${v}°`}</text></g>)}
          </>
        )}
      </g>
    </Frame>
  );
}
