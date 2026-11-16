import { bandLabel, TOTAL_SCALES } from "../../../shared/contour";
import { geomPath } from "../../../shared/projection";
import type { StudioProduct, TotalsMap } from "../../../shared/studio";
import { Basemap, C, Frame, LegendRow, layout, mapProjector, MapClip, SANS, SERIF, validLine, type Format } from "../Frame";

export function TotalsMapView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const body = product.body as TotalsMap;
  const scale = TOTAL_SCALES[body.kind];
  const proj = mapProjector(fmt, product.region);
  const L = layout(fmt);
  const wide = fmt === "wide";
  // each band is "value >= min", so paint low to high; colors follow the band's place on the scale
  const colorOf = (min: number) => scale.colors[Math.max(0, scale.thresholds.findIndex((t) => Math.abs(t - min) < 1e-6))] ?? scale.colors[0]!;
  const bands = [...body.bands].sort((a, b) => a.min - b.min);
  const top = bands.length ? bands[bands.length - 1]! : null;
  return (
    <Frame fmt={fmt} title={product.title || (body.kind === "snow" ? "Snow Totals" : "Rain Totals")} sub={validLine(product.validFrom, product.validTo)} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
      <Basemap proj={proj} bbox={product.region} />
      <MapClip proj={proj} id="tt-clip">
        {bands.map((b, i) => <path key={i} d={geomPath(b.geometry, proj)} fill={colorOf(b.min)} fill-opacity="0.78" stroke={colorOf(b.min)} stroke-width="1.2" stroke-linejoin="round" />)}
      </MapClip>
      <g transform={`translate(${L.side.x} ${L.side.y})`}>
        <text y="40" font-family={SERIF} font-size="40" font-weight="700" fill={C.text}>{body.kind === "snow" ? "Snowfall" : "Rainfall"}</text>
        {wide ? (
          <>
            {bands.length === 0 && <text y="110" font-family={SANS} font-size="26" fill={C.muted}>No accumulation expected</text>}
            {bands.map((b, i) => <LegendRow key={i} x={0} y={110 + i * 62} color={colorOf(b.min)} label={bandLabel(b)} />)}
            {top && <text y="640" font-family={SANS} font-size="26" fill={C.muted}>Highest band: {bandLabel(top)}</text>}
          </>
        ) : (
          bands.map((b, i) => <g key={i} transform={`translate(${(i % 3) * 330} ${90 + Math.floor(i / 3) * 60})`}><rect y="-22" width="34" height="26" rx="6" fill={colorOf(b.min)} /><text x="46" font-family={SANS} font-size="26" fill={C.text}>{bandLabel(b)}</text></g>)
        )}
      </g>
    </Frame>
  );
}
