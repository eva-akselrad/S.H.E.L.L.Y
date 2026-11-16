import { geomPath } from "../../../shared/projection";
import { RISK_LEVELS, type Hazard, type RiskLevel, type RiskMap, type StudioProduct } from "../../../shared/studio";
import { Basemap, C, Frame, LegendRow, layout, mapProjector, MapClip, SANS, SERIF, validLine, type Format } from "../Frame";

/** SHELLY's own names and palette (deliberately not SPC's labels). */
export const RISK: Record<RiskLevel, { label: string; color: string; blurb: string }> = {
  low: { label: "Low", color: "#3ecf9a", blurb: "Isolated, mostly minor" },
  some: { label: "Some", color: "#ffd23f", blurb: "Scattered impacts possible" },
  moderate: { label: "Moderate", color: "#ff9f1c", blurb: "Numerous impacts likely" },
  high: { label: "High", color: "#ff4d4d", blurb: "Widespread, dangerous" },
  extreme: { label: "Extreme", color: "#c2185b", blurb: "Life-threatening, rare" },
};
export const HAZARD_LABEL: Record<Hazard, string> = { tornado: "Tornadoes", wind: "Damaging wind", hail: "Large hail", flood: "Flooding", winter: "Winter weather", heat: "Heat" };

export function RiskMapView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const body = product.body as RiskMap;
  const proj = mapProjector(fmt, product.region);
  const L = layout(fmt);
  const wide = fmt === "wide";
  const ordered = [...body.areas].sort((a, b) => RISK_LEVELS.indexOf(a.level) - RISK_LEVELS.indexOf(b.level));
  const hazards = [...new Set(body.areas.map((a) => a.hazard))];
  const top = body.areas.length ? RISK_LEVELS[Math.max(...body.areas.map((a) => RISK_LEVELS.indexOf(a.level)))]! : null;
  return (
    <Frame fmt={fmt} title={product.title || "Risk Outlook"} sub={validLine(product.validFrom, product.validTo)} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
      <Basemap proj={proj} bbox={product.region} />
      <MapClip proj={proj} id="rk-clip">
        {ordered.map((a, i) => (
          <path key={i} d={geomPath(a.geometry, proj)} fill={RISK[a.level].color} fill-opacity="0.5" stroke={RISK[a.level].color} stroke-width="4" stroke-linejoin="round" />
        ))}
      </MapClip>
      <g transform={`translate(${L.side.x} ${L.side.y})`}>
        <text y="40" font-family={SERIF} font-size="40" font-weight="700" fill={C.text}>Risk level</text>
        {wide ? (
          <>
            {RISK_LEVELS.map((lv, i) => <LegendRow key={lv} x={0} y={110 + i * 84} color={RISK[lv].color} label={RISK[lv].label} sub={RISK[lv].blurb} />)}
            <text y="600" font-family={SANS} font-size="26" font-weight="700" fill={C.muted}>MAIN THREATS</text>
            <text y="640" font-family={SANS} font-size="28" fill={C.text}>{hazards.length ? hazards.map((h) => HAZARD_LABEL[h]).join(" · ") : "None highlighted"}</text>
            {top && <text y="700" font-family={SANS} font-size="26" fill={RISK[top].color}>Highest risk: {RISK[top].label}</text>}
          </>
        ) : (
          <>
            {RISK_LEVELS.map((lv, i) => <g key={lv} transform={`translate(${i * 196} 80)`}><rect y="-22" width="34" height="26" rx="6" fill={RISK[lv].color} /><text x="44" font-family={SANS} font-size="24" fill={C.text}>{RISK[lv].label}</text></g>)}
            <text y="170" font-family={SANS} font-size="26" fill={C.text}>{hazards.length ? hazards.map((h) => HAZARD_LABEL[h]).join(" · ") : "No main threats highlighted"}</text>
          </>
        )}
      </g>
    </Frame>
  );
}
