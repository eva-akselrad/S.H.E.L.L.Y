import type { Discussion, StudioProduct } from "../../../shared/studio";
import { C, Frame, SERIF, SIZE, validLine, type Format } from "../Frame";

export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + " " + w).length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The forecaster's written discussion, as a self-contained SVG. */
export function DiscussionView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const { w, h } = SIZE[fmt];
  const body = product.body as Discussion;
  const size = fmt === "wide" ? 40 : 38;
  const max = fmt === "wide" ? 62 : 36;
  const lines = wrap(body.text, max).slice(0, fmt === "wide" ? 13 : 20);
  const lead = size * 1.45;
  const y0 = Math.max(260, h / 2 - (lines.length * lead) / 2 + 40);
  return (
    <Frame fmt={fmt} title={product.title} sub={validLine(product.validFrom, product.validTo)} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
      {lines.map((l, i) => (
        <text key={i} x={w / 2} y={y0 + i * lead} text-anchor="middle" font-family={SERIF} font-size={size} fill={C.text}>{l}</text>
      ))}
    </Frame>
  );
}

/** Towns and ETAs for a storm, as a simple list. */
export function StormTrackView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const { w } = SIZE[fmt];
  const b = product.body as import("../../../shared/studio").StormTrack;
  return (
    <Frame fmt={fmt} title={product.title} sub={validLine(product.validFrom, product.validTo)} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
      {b.towns.slice(0, 8).map((t, i) => (
        <text key={i} x={w / 2} y={300 + i * 90} text-anchor="middle" font-family={SERIF} font-size="58" fill={C.text}>
          {t.name}: {t.etaMin <= 1 ? "now" : `${t.etaMin} min`}
        </text>
      ))}
    </Frame>
  );
}
