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
        {body.cities.map((c) => {
          const [x, y] = proj.xy(c.lon, c.lat);
          const col = tempColor(c.value);
          return (
            <g key={c.name}>
              <circle cx={x} cy={y} r="8" fill={col} stroke="#0b1220" stroke-width="3" />
              <rect x={x - 46} y={y - 62} width="92" height="46" rx="12" fill={C.bg} stroke={col} stroke-width="3" />
              <text x={x} y={y - 28} text-anchor="middle" font-family={SERIF} font-size="34" font-weight="700" fill={C.text}>{Math.round(c.value)}°</text>
              <text x={x} y={y + 34} text-anchor="middle" font-family={SANS} font-size="22" font-weight="600" fill={C.text} stroke={C.bg} stroke-width="5" paint-order="stroke">{c.name}</text>
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
