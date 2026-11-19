import type { Box, Projector } from "../../../shared/projection";
import type { AreaMap, AreaMarker, AreaShape, StudioProduct } from "../../../shared/studio";
import { Basemap, C, Frame, layout, mapProjector, MapClip, SANS, SERIF, validLine, type Format } from "../Frame";
import { wrap } from "./Discussion";

export const AREA_DASH = "16 11";

/** Pixel corners of a shape. */
export const ringXY = (s: AreaShape, proj: Projector): [number, number][] => s.ring.map(([lon, lat]) => proj.xy(lon, lat));

export const ringD = (pts: [number, number][]): string =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join("") + "Z";

/** Where a shape's label goes: its area centroid, or just outside its box on one side. */
export function labelSpot(pts: [number, number][], at: AreaShape["labelAt"]): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const box = { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
  const c = Math.abs(a) > 1e-6 ? { x: cx / (3 * a), y: cy / (3 * a) } : { x: (box.l + box.r) / 2, y: (box.t + box.b) / 2 };
  switch (at) {
    case "above": return { x: c.x, y: box.t - 16, anchor: "middle" };
    case "below": return { x: c.x, y: box.b + 40, anchor: "middle" };
    case "left": return { x: box.l - 16, y: c.y + 10, anchor: "end" };
    case "right": return { x: box.r + 16, y: c.y + 10, anchor: "start" };
    default: return { x: c.x, y: c.y + 10, anchor: "middle" };
  }
}

export function starPath(x: number, y: number, r: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const t = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? "L" : "M"}${Math.round((x + rr * Math.cos(t)) * 10) / 10} ${Math.round((y + rr * Math.sin(t)) * 10) / 10}`;
  }
  return d + "Z";
}

/** Text with a dark halo so it reads over any fill. */
export function HaloText({ x, y, anchor = "start", size, weight = 700, children }: { x: number; y: number; anchor?: "start" | "middle" | "end"; size: number; weight?: number; children: string }) {
  return (
    <text x={x} y={y} text-anchor={anchor} font-family={SANS} font-size={size} font-weight={weight} fill={C.text} stroke={C.bg} stroke-width={size / 4} stroke-linejoin="round" paint-order="stroke">
      {children}
    </text>
  );
}

export function AreaShapePath({ s, pts }: { s: AreaShape; pts: [number, number][] }) {
  return (
    <path d={ringD(pts)} fill={s.fill} fill-opacity={s.fillOpacity} stroke={s.stroke} stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"
      {...(s.line === "dashed" ? { "stroke-dasharray": AREA_DASH } : {})} />
  );
}

/** Rough rendered width of a line of sans text, enough to keep labels inside the map. */
export const textW = (t: string, size: number): number => t.length * size * 0.56;

/** Move a text anchor so the whole line (and its cap height) stays inside the map frame. */
export function keepInside(x: number, y: number, anchor: "start" | "middle" | "end", w: number, size: number, f: Box): { x: number; y: number } {
  const pad = 10;
  const left = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
  const shift = Math.min(0, f.x + f.w - pad - (left + w)) || Math.max(0, f.x + pad - left);
  return { x: x + shift, y: Math.min(f.y + f.h - pad, Math.max(f.y + size + pad, y)) };
}

export function MarkerMark({ m, proj, scale = 1 }: { m: AreaMarker; proj: Projector; scale?: number }) {
  const [x, y] = proj.xy(m.lon, m.lat);
  const r = 15 * scale;
  const size = 32 * scale;
  const w = textW(m.text, size);
  const f = proj.fit;
  // text goes right of the icon, or left when it would run off the map
  const side: "start" | "middle" | "end" = m.icon === "none" ? "middle" : x + r + 8 * scale + w > f.x + f.w - 10 ? "end" : "start";
  const tx = side === "middle" ? x : side === "start" ? x + r + 8 * scale : x - r - 8 * scale;
  const t = keepInside(tx, y + 11 * scale, side, w, size, f);
  return (
    <g>
      {m.icon === "star" && <path d={starPath(x, y, r)} fill={C.text} stroke={C.bg} stroke-width={3 * scale} stroke-linejoin="round" />}
      {m.icon === "dot" && <circle cx={x} cy={y} r={8 * scale} fill={C.text} stroke={C.bg} stroke-width={3 * scale} />}
      {m.text && <HaloText x={t.x} y={t.y} anchor={side} size={size} weight={m.icon === "none" ? 700 : 600}>{m.text}</HaloText>}
    </g>
  );
}

/** Shapes, then their labels, then markers: the map layer shared by the graphic and the editor. */
export function AreaOverlay({ body, proj }: { body: AreaMap; proj: Projector }) {
  const shapes = body.shapes.map((s) => ({ s, pts: ringXY(s, proj) }));
  return (
    <g>
      {shapes.map(({ s, pts }, i) => <AreaShapePath key={i} s={s} pts={pts} />)}
      {shapes.map(({ s, pts }, i) => {
        if (!s.label) return null;
        const p = labelSpot(pts, s.labelAt);
        const t = keepInside(p.x, p.y, p.anchor, textW(s.label, 30), 30, proj.fit);
        return <HaloText key={i} x={t.x} y={t.y} anchor={p.anchor} size={30}>{s.label}</HaloText>;
      })}
      {body.markers.map((m, i) => <MarkerMark key={i} m={m} proj={proj} />)}
    </g>
  );
}

function Swatch({ s, x, y, size = 40 }: { s: AreaShape; x: number; y: number; size?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={size} height={size * 0.75} rx="6" fill={C.land} />
      <rect x={x} y={y} width={size} height={size * 0.75} rx="6" fill={s.fill} fill-opacity={s.fillOpacity} stroke={s.stroke} stroke-width="3"
        {...(s.line === "dashed" ? { "stroke-dasharray": "7 5" } : {})} />
    </g>
  );
}

export function AreaMapView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const body = product.body as AreaMap;
  const proj = mapProjector(fmt, product.region);
  const L = layout(fmt);
  const wide = fmt === "wide";
  const legend = body.shapes.filter((s) => s.label || s.note);
  return (
    <Frame fmt={fmt} title={product.title || "Affected Area"} sub={validLine(product.validFrom, product.validTo)}
      credit={forecaster ? `Drawn by ${forecaster}` : "SHELLY forecast"} data="SHELLY forecaster graphic · not an official NWS product">
      <Basemap proj={proj} bbox={product.region} />
      <MapClip proj={proj} id="am-clip">
        <AreaOverlay body={body} proj={proj} />
      </MapClip>
      <g transform={`translate(${L.side.x} ${L.side.y})`}>
        {wide ? (
          <>
            <text y="40" font-family={SERIF} font-size="40" font-weight="700" fill={C.text}>What it shows</text>
            {(() => {
              let y = 96;
              const rows = legend.slice(0, 6).map((s, i) => {
                const notes = wrap(s.note, 36).slice(0, 2);
                const top = y;
                y += 46 + notes.length * 30 + 22;
                return (
                  <g key={i}>
                    <Swatch s={s} x={0} y={top - 2} />
                    <text x="58" y={top + 26} font-family={SANS} font-size="30" font-weight="700" fill={C.text}>{s.label || "Area"}</text>
                    {notes.map((l, k) => <text key={k} x="58" y={top + 62 + k * 30} font-family={SANS} font-size="24" fill={C.muted}>{l}</text>)}
                  </g>
                );
              });
              const cap = wrap(body.caption, 40).slice(0, Math.max(0, Math.floor((800 - y) / 36)));
              return (
                <>
                  {rows}
                  {cap.map((l, k) => <text key={`c${k}`} y={y + 20 + k * 36} font-family={SANS} font-size="27" fill={C.text}>{l}</text>)}
                </>
              );
            })()}
          </>
        ) : (
          <>
            {wrap(body.caption, 62).slice(0, 3).map((l, k) => <text key={k} y={34 + k * 36} font-family={SANS} font-size="27" fill={C.text}>{l}</text>)}
            {legend.slice(0, 4).map((s, i) => {
              const top = (body.caption ? 140 : 20) + Math.floor(i / 2) * 90;
              const left = (i % 2) * 500;
              return (
                <g key={i} transform={`translate(${left} ${top})`}>
                  <Swatch s={s} x={0} y={0} size={36} />
                  <text x="50" y="24" font-family={SANS} font-size="26" font-weight="700" fill={C.text}>{s.label || "Area"}</text>
                  {wrap(s.note, 40).slice(0, 2).map((l, k) => <text key={k} x="50" y={52 + k * 24} font-family={SANS} font-size="20" fill={C.muted}>{l}</text>)}
                </g>
              );
            })}
          </>
        )}
      </g>
    </Frame>
  );
}
