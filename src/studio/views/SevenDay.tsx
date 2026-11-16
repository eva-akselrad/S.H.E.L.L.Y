import type { SevenDay, StudioProduct } from "../../../shared/studio";
import { wmoToWeather, type IconKey } from "../../../shared/wx";
import { C, Frame, SANS, SERIF, SIZE, validLine, type Format } from "../Frame";

/** Small flat weather glyphs drawn from basic shapes, sized to a 100x100 box. */
export function WxGlyph({ icon, x, y, size = 100 }: { icon: IconKey; x: number; y: number; size?: number }) {
  const s = size / 100;
  const cloud = <path d="M28 66h46a16 16 0 0 0 2-32 22 22 0 0 0-42-4 18 18 0 0 0-6 36z" fill="#c9d3ea" />;
  const sun = (cx: number, cy: number, r: number) => (
    <g>
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1={cx + Math.cos((i * Math.PI) / 4) * (r + 6)} y1={cy + Math.sin((i * Math.PI) / 4) * (r + 6)} x2={cx + Math.cos((i * Math.PI) / 4) * (r + 14)} y2={cy + Math.sin((i * Math.PI) / 4) * (r + 14)} stroke="#ffc233" stroke-width="5" stroke-linecap="round" />
      ))}
      <circle cx={cx} cy={cy} r={r} fill="#ffc233" />
    </g>
  );
  let body;
  switch (icon) {
    case "sun": body = sun(50, 50, 20); break;
    case "moon": body = <path d="M62 24a28 28 0 1 0 14 48 24 24 0 0 1-14-48z" fill="#dfe6f7" />; break;
    case "partly": body = <g>{sun(36, 36, 14)}<g transform="translate(8 14)">{cloud}</g></g>; break;
    case "fog": body = <g stroke="#9fb0d0" stroke-width="7" stroke-linecap="round"><line x1="20" y1="38" x2="80" y2="38" /><line x1="28" y1="54" x2="86" y2="54" /><line x1="20" y1="70" x2="74" y2="70" /></g>; break;
    case "drizzle":
    case "rain": body = <g>{cloud}<g stroke="#5ec2ff" stroke-width="6" stroke-linecap="round"><line x1="36" y1="76" x2="32" y2="90" /><line x1="52" y1="76" x2="48" y2="90" /><line x1="68" y1="76" x2="64" y2="90" /></g></g>; break;
    case "snow": body = <g>{cloud}<g fill="#fff"><circle cx="36" cy="82" r="5" /><circle cx="52" cy="88" r="5" /><circle cx="68" cy="82" r="5" /></g></g>; break;
    case "sleet": body = <g>{cloud}<g stroke="#9ad9ff" stroke-width="6" stroke-linecap="round"><line x1="38" y1="76" x2="34" y2="90" /><line x1="66" y1="76" x2="62" y2="90" /></g><circle cx="52" cy="84" r="5" fill="#fff" /></g>; break;
    case "storm": body = <g>{cloud}<path d="M54 64l-12 16h10l-6 14 18-20H52l8-10z" fill="#ffc233" /></g>; break;
    default: body = cloud;
  }
  return <g transform={`translate(${x} ${y}) scale(${s})`}>{body}</g>;
}

/** Greedy word wrap for SVG text (no foreignObject, so PNG export stays clean). */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + " " + word).length > max) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines;
}

const dayName = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { weekday: "short" });
};
const dayDate = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric" });
};

export function SevenDayView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const body = product.body as SevenDay;
  const days = body.days.slice(0, 7);
  const { w, h } = SIZE[fmt];
  const wide = fmt === "wide";
  const colW = wide ? (w - 120 - (days.length - 1) * 16) / Math.max(1, days.length) : w - 80;
  const rowH = wide ? 780 : (h - 360) / Math.max(1, days.length);
  return (
    <Frame fmt={fmt} title={product.title || "7-Day Forecast"} sub={`${body.place} · ${validLine(product.validFrom, product.validTo)}`} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
      {days.map((d, i) => {
        const x = wide ? 60 + i * (colW + 16) : 40;
        const y = wide ? 160 : 180 + i * rowH;
        const icon = wmoToWeather(d.code, true).icon;
        return wide ? (
          <g key={d.date}>
            <rect x={x} y={y} width={colW} height={rowH} rx="18" fill={C.panel} stroke={d.edited ? C.accent : C.line} stroke-width={d.edited ? 3 : 1} />
            <text x={x + colW / 2} y={y + 56} text-anchor="middle" font-family={SERIF} font-size="44" font-weight="700" fill={C.text}>{dayName(d.date)}</text>
            <text x={x + colW / 2} y={y + 90} text-anchor="middle" font-family={SANS} font-size="22" fill={C.muted}>{dayDate(d.date)}</text>
            <WxGlyph icon={icon} x={x + colW / 2 - 60} y={y + 120} size={120} />
            <text x={x + colW / 2} y={y + 310} text-anchor="middle" font-family={SERIF} font-size="84" font-weight="700" fill={C.text}>{d.hi}°</text>
            <text x={x + colW / 2} y={y + 372} text-anchor="middle" font-family={SANS} font-size="44" fill={C.muted}>{d.lo}°</text>
            <text x={x + colW / 2} y={y + 430} text-anchor="middle" font-family={SANS} font-size="30" fill="#5ec2ff">{d.pop}% precip</text>
            <text x={x + colW / 2} y={y + 480} text-anchor="middle" font-family={SANS} font-size="24" fill={C.muted}>{wmoToWeather(d.code, true).desc}</text>
            {d.note && wrap(d.note, 16).slice(0, 4).map((line, k) => <text key={k} x={x + colW / 2} y={y + 530 + k * 32} text-anchor="middle" font-family={SANS} font-size="24" font-weight="600" fill={C.text}>{line}</text>)}
            {d.edited && <text x={x + colW / 2} y={y + rowH - 20} text-anchor="middle" font-family={SANS} font-size="20" font-weight="700" letter-spacing="1.5" fill={C.accent}>SHELLY FORECAST</text>}
          </g>
        ) : (
          <g key={d.date}>
            <rect x={x} y={y} width={colW} height={rowH - 10} rx="14" fill={C.panel} stroke={d.edited ? C.accent : C.line} stroke-width={d.edited ? 3 : 1} />
            <text x={x + 24} y={y + 50} font-family={SERIF} font-size="38" font-weight="700" fill={C.text}>{dayName(d.date)}</text>
            <text x={x + 24} y={y + 80} font-family={SANS} font-size="20" fill={C.muted}>{dayDate(d.date)}</text>
            <WxGlyph icon={icon} x={x + 190} y={y + 8} size={90} />
            <text x={x + 330} y={y + 66} font-family={SERIF} font-size="60" font-weight="700" fill={C.text}>{d.hi}°</text>
            <text x={x + 460} y={y + 66} font-family={SANS} font-size="40" fill={C.muted}>{d.lo}°</text>
            <text x={x + 580} y={y + 62} font-family={SANS} font-size="26" fill="#5ec2ff">{d.pop}%</text>
            <text x={x + 24} y={y + 108} font-family={SANS} font-size="22" fill={C.muted}>{d.note || wmoToWeather(d.code, true).desc}{d.edited ? "  ·  SHELLY FORECAST" : ""}</text>
          </g>
        );
      })}
    </Frame>
  );
}
