// Shared map chrome for every Forecaster Studio graphic. Colors and fonts are literal values (no CSS
// variables) so a serialized SVG rasterizes to a PNG exactly as it looks on screen.
import type { ComponentChildren } from "preact";
import { decodeRing, makeProjector, ringsPath, type Box, type Projector } from "../../shared/projection";
import type { Bbox } from "../../shared/types";
import basemap from "./basemap.json";

export const C = {
  bg: "#0b1220", panel: "#131c2e", panel2: "#1a2540", text: "#f3ede4", muted: "#98a2b8", accent: "#ff8a65", line: "#ffffff26",
  water: "#0d1b2e", land: "#1b2742", county: "#34456b", state: "#8b9bc0",
};
export const SERIF = "'Iowan Old Style','Palatino Linotype',Georgia,serif";
export const SANS = "'Segoe UI',system-ui,-apple-system,Roboto,sans-serif";

export type Format = "wide" | "portrait";
export const SIZE: Record<Format, { w: number; h: number }> = { wide: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 1350 } };

export interface Layout {
  w: number;
  h: number;
  map: Box;
  side: Box;
}
export function layout(fmt: Format): Layout {
  const { w, h } = SIZE[fmt];
  return fmt === "wide"
    ? { w, h, map: { x: 60, y: 150, w: 1180, h: 830 }, side: { x: 1280, y: 150, w: 580, h: 830 } }
    : { w, h, map: { x: 40, y: 190, w: 1000, h: 760 }, side: { x: 40, y: 970, w: 1000, h: 300 } };
}

const fmtDay = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
export const validLine = (from: string, to: string): string => `Valid ${fmtDay(from)} to ${fmtDay(to)}`;

export function Logo({ x, y, size = 40 }: { x: number; y: number; size?: number }) {
  const s = size / 32;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M16 28c-6.6 0-12-4.7-12-10.5S9.4 6 16 6s10 3.8 10 8.5-3.6 7.5-8 7.5-6.5-2.4-6.5-5S13 11.5 15 11.5" fill="none" stroke={C.accent} stroke-width="2.4" stroke-linecap="round" />
    </g>
  );
}

/** Title bar, footer and background shared by every graphic. */
export function Frame({ fmt, title, sub, credit, data = "Data: NWS · NOAA SPC · Open-Meteo", children }: { fmt: Format; title: string; sub: string; credit: string; data?: string; children: ComponentChildren }) {
  const { w, h } = SIZE[fmt];
  const tsize = fmt === "wide" ? 56 : 48;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} class="studio-svg" role="img" aria-label={title}>
      <rect width={w} height={h} fill={C.bg} />
      <rect width={w} height={fmt === "wide" ? 118 : 160} fill={C.panel} />
      <rect y={fmt === "wide" ? 114 : 156} width={w} height="4" fill={C.accent} />
      <Logo x={fmt === "wide" ? 60 : 40} y={fmt === "wide" ? 30 : 28} size={52} />
      <text x={fmt === "wide" ? 128 : 108} y={fmt === "wide" ? 66 : 62} font-family={SERIF} font-size="34" font-weight="700" letter-spacing="3" fill={C.text}>SHELLY</text>
      <text x={fmt === "wide" ? 60 : 40} y={fmt === "wide" ? 108 : 146} font-family={SANS} font-size={fmt === "wide" ? 22 : 20} fill={C.muted}>{sub}</text>
      <text x={fmt === "wide" ? w - 60 : 40} y={fmt === "wide" ? 70 : 118} text-anchor={fmt === "wide" ? "end" : "start"} font-family={SERIF} font-size={fmt === "wide" ? tsize : 40} font-weight="600" fill={C.text}>
        {title}
      </text>
      {children}
      <text x={fmt === "wide" ? 60 : 40} y={h - 24} font-family={SANS} font-size="22" fill={C.muted}>{credit}</text>
      <text x={fmt === "wide" ? w - 60 : w - 40} y={h - 24} text-anchor="end" font-family={SANS} font-size="20" fill={C.muted}>{data}</text>
    </svg>
  );
}

/** County outlines and state borders from the bundled basemap, projected into `proj`. */
export function Basemap({ proj, bbox }: { proj: Projector; bbox: Bbox }) {
  const f = proj.fit;
  const clip = `clip-${Math.round(f.x)}-${Math.round(f.y)}-${Math.round(f.w)}`;
  const counties = basemap.counties.map((c) => ({
    id: c.id,
    d: c.polys.map((rings) => ringsPath(rings.map(decodeRing), proj)).join(""),
  }));
  const borders = basemap.borders.map((l) => decodeRing(l).map(([lon, lat], i) => `${i ? "L" : "M"}${proj.xy(lon!, lat!).map((n) => Math.round(n * 10) / 10).join(" ")}`).join(""));
  return (
    <g>
      <defs>
        <clipPath id={clip}><rect x={f.x} y={f.y} width={f.w} height={f.h} rx="10" /></clipPath>
      </defs>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="10" fill={C.water} />
      <g clip-path={`url(#${clip})`} data-bbox={`${bbox.south},${bbox.west},${bbox.north},${bbox.east}`}>
        {counties.map((c) => <path key={c.id} d={c.d} fill={C.land} stroke={C.county} stroke-width="1" stroke-linejoin="round" />)}
        {borders.map((d, i) => <path key={i} d={d} fill="none" stroke={C.state} stroke-width="2.4" stroke-linejoin="round" />)}
      </g>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="10" fill="none" stroke={C.line} />
    </g>
  );
}

export function mapProjector(fmt: Format, bbox: Bbox): Projector {
  return makeProjector(bbox, layout(fmt).map);
}

/** A clipped group so overlays never spill outside the map frame. */
export function MapClip({ proj, id, children }: { proj: Projector; id: string; children: ComponentChildren }) {
  const f = proj.fit;
  return (
    <g>
      <defs><clipPath id={id}><rect x={f.x} y={f.y} width={f.w} height={f.h} rx="10" /></clipPath></defs>
      <g clip-path={`url(#${id})`}>{children}</g>
    </g>
  );
}

export function LegendRow({ x, y, color, label, sub }: { x: number; y: number; color: string; label: string; sub?: string }) {
  return (
    <g>
      <rect x={x} y={y - 22} width="34" height="26" rx="6" fill={color} />
      <text x={x + 50} y={y} font-family={SANS} font-size="28" font-weight="600" fill={C.text}>{label}</text>
      {sub && <text x={x + 50} y={y + 28} font-family={SANS} font-size="20" fill={C.muted}>{sub}</text>}
    </g>
  );
}
