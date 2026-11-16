import { HAZARDS, type StudioProduct, type Timeline } from "../../../shared/studio";
import { hourLabel } from "../../../shared/timeline";
import { C, Frame, SANS, SERIF, SIZE, validLine, type Format } from "../Frame";
import { HAZARD_LABEL } from "./RiskMap";

export const HAZARD_COLOR: Record<string, string> = { tornado: "#c2185b", wind: "#ff9f1c", hail: "#4dd0e1", flood: "#3d8bff", winter: "#b6d9ff", heat: "#ff4d4d", none: "#1a2540" };

export function TimelineView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const body = product.body as Timeline;
  const { w, h } = SIZE[fmt];
  const wide = fmt === "wide";
  const rows = body.rows.slice(0, 10);
  const nBlocks = Math.max(1, ...rows.map((r) => r.blocks.length));
  const left = wide ? 60 : 40;
  const nameW = wide ? 260 : 220;
  const top = wide ? 220 : 270;
  const rowH = Math.min(wide ? 84 : 90, ((wide ? h - 300 : h - 460) - 60) / Math.max(1, rows.length));
  const cell = (w - left - nameW - (wide ? 60 : 40)) / nBlocks;
  const used = [...new Set(rows.flatMap((r) => r.blocks.filter((b) => b.intensity > 0).map((b) => b.hazard)))];
  return (
    <Frame fmt={fmt} title={product.title || "Storm Timeline"} sub={validLine(product.validFrom, product.validTo)} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
      {rows[0]?.blocks.map((b, i) => <text key={i} x={left + nameW + i * cell + cell / 2} y={top - 16} text-anchor="middle" font-family={SANS} font-size="24" font-weight="600" fill={C.muted}>{hourLabel(b.hour)}</text>)}
      {rows.map((r, ri) => (
        <g key={r.city}>
          <text x={left} y={top + ri * rowH + rowH / 2 + 9} font-family={SERIF} font-size="30" font-weight="600" fill={C.text}>{r.city}</text>
          {r.blocks.map((b, i) => (
            <rect key={i} x={left + nameW + i * cell + 2} y={top + ri * rowH + 4} width={cell - 4} height={rowH - 8} rx="8" fill={HAZARD_COLOR[b.hazard]} fill-opacity={b.intensity === 0 ? 1 : 0.35 + b.intensity * 0.22} />
          ))}
        </g>
      ))}
      {rows.length === 0 && <text x={w / 2} y={h / 2} text-anchor="middle" font-family={SANS} font-size="32" fill={C.muted}>No timeline yet</text>}
      <g transform={`translate(${left} ${wide ? h - 90 : h - 150})`}>
        {(used.length ? used : HAZARDS.slice(0, 3)).map((hz, i) => (
          <g key={hz} transform={`translate(${i * 250} 0)`}>
            <rect y="-22" width="30" height="24" rx="6" fill={HAZARD_COLOR[hz]} />
            <text x="42" font-family={SANS} font-size="24" fill={C.text}>{HAZARD_LABEL[hz as keyof typeof HAZARD_LABEL]}</text>
          </g>
        ))}
        <text y="40" font-family={SANS} font-size="20" fill={C.muted}>Darker color means a stronger signal in that block.</text>
      </g>
    </Frame>
  );
}
