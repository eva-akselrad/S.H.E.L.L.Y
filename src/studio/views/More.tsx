// More Forecaster Studio graphics: forecast card, impact scale, day planner, today vs tomorrow, odds.
// Literal colours only (no CSS variables) so the PNG export matches the screen.
import { IMPACT_LEVELS, type Compare, type DayPlanner, type Impacts, type NoteCard, type Odds, type StudioProduct } from "../../../shared/studio";
import { wmoToWeather } from "../../../shared/wx";
import { C, Frame, SANS, SERIF, SIZE, validLine, type Format } from "../Frame";
import { tempColor } from "./CityTemps";
import { WxGlyph, wrap } from "./SevenDay";

/** "snow" for snowy codes, "rain" otherwise. */
const precipWord = (code: number): string => ((code >= 71 && code <= 77) || code === 85 || code === 86 ? "snow" : "rain");
const credit = (f: string) => (f ? `Forecast by ${f}` : "SHELLY forecast");
const TONE = ["#3ecf9a", "#ffd23f", "#ff9f1c", "#ff4d4d"];
export const IMPACT_COLOR = ["#3b4a6b", "#3ecf9a", "#ffd23f", "#ff9f1c", "#ff4d4d"];

/** Note icons that aren't plain weather: wind, heat and cold. */
function NoteGlyph({ icon, x, y, size }: { icon: NoteCard["icon"]; x: number; y: number; size: number }) {
  const s = size / 100;
  if (icon === "wind")
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`} fill="none" stroke="#c9d3ea" stroke-width="7" stroke-linecap="round">
        <path d="M14 38h50a12 12 0 1 0-12-12" /><path d="M14 56h66a12 12 0 1 1-12 12" /><path d="M14 74h34" />
      </g>
    );
  if (icon === "heat")
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <rect x="42" y="12" width="16" height="56" rx="8" fill="none" stroke="#ff9f1c" stroke-width="6" />
        <circle cx="50" cy="76" r="14" fill="#ff4d4d" /><rect x="46" y="34" width="8" height="40" fill="#ff4d4d" />
        <path d="M74 20q8 10 0 20t0 20M84 24q6 8 0 16" stroke="#ff9f1c" stroke-width="4" fill="none" stroke-linecap="round" />
      </g>
    );
  if (icon === "cold")
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`} stroke="#9ad9ff" stroke-width="6" stroke-linecap="round">
        {[0, 60, 120].map((a) => <line key={a} x1="50" y1="12" x2="50" y2="88" transform={`rotate(${a} 50 50)`} />)}
        {[0, 60, 120, 180, 240, 300].map((a) => <path key={a} d="M42 22l8 8 8-8" fill="none" transform={`rotate(${a} 50 50)`} />)}
      </g>
    );
  const map = { sun: 0, partly: 2, cloud: 3, rain: 63, snow: 73, storm: 95, fog: 45 } as const;
  return <WxGlyph icon={wmoToWeather(map[icon]).icon} x={x} y={y} size={size} />;
}

export function NoteView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const b = product.body as NoteCard;
  const { w } = SIZE[fmt];
  const wide = fmt === "wide";
  const col = TONE[b.tone] ?? TONE[0]!;
  const headLines = wrap(b.headline || product.title, wide ? 26 : 22).slice(0, 3);
  const x0 = wide ? 520 : 60;
  const y0 = wide ? 270 : 520;
  return (
    <Frame fmt={fmt} title={product.title || "Forecast"} sub={validLine(product.validFrom, product.validTo)} credit={credit(forecaster)}>
      <rect x={wide ? 60 : 40} y={wide ? 160 : 190} width={wide ? 420 : w - 80} height={wide ? 820 : 300} rx="24" fill={C.panel} />
      <rect x={wide ? 60 : 40} y={wide ? 160 : 190} width="14" height={wide ? 820 : 300} rx="7" fill={col} />
      <NoteGlyph icon={b.icon} x={wide ? 120 : w / 2 - 130} y={wide ? 400 : 210} size={wide ? 300 : 260} />
      {headLines.map((l, i) => (
        <text key={i} x={x0} y={y0 + i * (wide ? 84 : 72)} font-family={SERIF} font-size={wide ? 76 : 64} font-weight="700" fill={C.text}>{l}</text>
      ))}
      {b.bullets.map((t, i) => {
        const y = y0 + headLines.length * (wide ? 84 : 72) + 50 + i * (wide ? 112 : 120);
        const lines = wrap(t, wide ? 52 : 40).slice(0, 2);
        return (
          <g key={i}>
            <circle cx={x0 + 14} cy={y - 12} r="10" fill={col} />
            {lines.map((l, k) => <text key={k} x={x0 + 44} y={y + k * 44} font-family={SANS} font-size={wide ? 38 : 36} fill={C.text}>{l}</text>)}
          </g>
        );
      })}
    </Frame>
  );
}

export function ImpactsView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const b = product.body as Impacts;
  const { w } = SIZE[fmt];
  const wide = fmt === "wide";
  const scaleX = wide ? 60 : 40;
  const scaleW = w - scaleX * 2;
  const segW = (scaleW - 4 * 10) / 5;
  const rowY0 = wide ? 470 : 520;
  const rowH = Math.min(wide ? 120 : 150, (wide ? 520 : 780) / Math.max(1, b.rows.length));
  return (
    <Frame fmt={fmt} title={product.title || "Impact Scale"} sub={`${b.event ? `${b.event} · ` : ""}${validLine(product.validFrom, product.validTo)}`} credit={credit(forecaster)}>
      <text x={scaleX} y={wide ? 210 : 240} font-family={SANS} font-size="28" font-weight="700" letter-spacing="2" fill={C.muted}>OVERALL IMPACT</text>
      {IMPACT_LEVELS.map((name, i) => {
        const x = scaleX + i * (segW + 10);
        const on = i === b.overall;
        return (
          <g key={name}>
            <rect x={x} y={wide ? 236 : 266} width={segW} height={on ? 150 : 110} rx="16" fill={IMPACT_COLOR[i]} opacity={on ? 1 : 0.28} stroke={on ? "#fff" : "none"} stroke-width="5" />
            <text x={x + segW / 2} y={wide ? 304 : 334} text-anchor="middle" font-family={SERIF} font-size={wide ? (on ? 50 : 36) : on ? 32 : 24} font-weight="700" fill={on && i >= 2 && i <= 3 ? "#1b1006" : C.text}>{name}</text>
            {on && <text x={x + segW / 2} y={wide ? 356 : 386} text-anchor="middle" font-family={SANS} font-size="26" font-weight="700" fill={i >= 2 && i <= 3 ? "#1b1006" : C.text}>EXPECTED</text>}
          </g>
        );
      })}
      {b.rows.map((r, i) => {
        const y = rowY0 + i * rowH;
        const col = IMPACT_COLOR[r.level]!;
        return (
          <g key={i}>
            <rect x={scaleX} y={y} width={scaleW} height={rowH - 14} rx="14" fill={C.panel} />
            <rect x={scaleX} y={y} width="12" height={rowH - 14} rx="6" fill={col} />
            <text x={scaleX + 36} y={y + (wide ? 48 : 50)} font-family={SERIF} font-size={wide ? 40 : 38} font-weight="700" fill={C.text}>{r.label}</text>
            <text x={scaleX + (wide ? 420 : 36)} y={y + (wide ? 48 : 92)} font-family={SANS} font-size={wide ? 30 : 28} fill={C.muted}>{r.note}</text>
            <rect x={scaleX + scaleW - (wide ? 250 : 220)} y={y + 14} width={wide ? 226 : 200} height={rowH - 42} rx="12" fill={col} />
            <text x={scaleX + scaleW - (wide ? 137 : 120)} y={y + 14 + (rowH - 42) / 2 + 10} text-anchor="middle" font-family={SANS} font-size="30" font-weight="800" fill={r.level >= 2 && r.level <= 3 ? "#1b1006" : C.text}>{IMPACT_LEVELS[r.level]}</text>
          </g>
        );
      })}
    </Frame>
  );
}

export function DayPlannerView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const b = product.body as DayPlanner;
  const { w, h } = SIZE[fmt];
  const wide = fmt === "wide";
  const n = Math.max(1, b.parts.length);
  const day = b.date ? new Date(`${b.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }) : "";
  const colW = wide ? (w - 120 - (n - 1) * 20) / n : w - 80;
  const rowH = wide ? 820 : (h - 360) / n;
  return (
    <Frame fmt={fmt} title={product.title || "Day Planner"} sub={`${b.place}${day ? ` · ${day}` : ""}`} credit={credit(forecaster)}>
      {b.parts.map((p, i) => {
        const w2 = wmoToWeather(p.code, p.label !== "Evening" && p.label !== "Overnight");
        if (!wide) {
          const y = 190 + i * rowH;
          return (
            <g key={i}>
              <rect x="40" y={y} width={colW} height={rowH - 14} rx="18" fill={C.panel} />
              <text x="70" y={y + 64} font-family={SERIF} font-size="44" font-weight="700" fill={C.text}>{p.label}</text>
              <text x="70" y={y + 110} font-family={SANS} font-size="26" fill={C.muted}>{p.note || w2.desc}</text>
              <WxGlyph icon={w2.icon} x={500} y={y + 20} size={130} />
              <text x={w - 210} y={y + 96} text-anchor="end" font-family={SERIF} font-size="84" font-weight="700" fill={tempColor(p.temp)}>{p.temp}°</text>
              <text x={w - 80} y={y + 96} text-anchor="end" font-family={SANS} font-size="34" fill="#5ec2ff">{p.pop}%</text>
            </g>
          );
        }
        const x = 60 + i * (colW + 20);
        return (
          <g key={i}>
            <rect x={x} y="160" width={colW} height={rowH} rx="22" fill={C.panel} />
            <rect x={x} y="160" width={colW} height="12" rx="6" fill={tempColor(p.temp)} />
            <text x={x + colW / 2} y="250" text-anchor="middle" font-family={SERIF} font-size="54" font-weight="700" fill={C.text}>{p.label}</text>
            <WxGlyph icon={w2.icon} x={x + colW / 2 - 90} y={300} size={180} />
            <text x={x + colW / 2} y="620" text-anchor="middle" font-family={SERIF} font-size="140" font-weight="700" fill={C.text}>{p.temp}°</text>
            <text x={x + colW / 2} y="700" text-anchor="middle" font-family={SANS} font-size="34" fill="#5ec2ff">{p.pop}% chance of {precipWord(p.code)}</text>
            {wrap(p.note || w2.desc, 20).slice(0, 3).map((l, k) => <text key={k} x={x + colW / 2} y={770 + k * 42} text-anchor="middle" font-family={SANS} font-size="32" fill={C.text}>{l}</text>)}
          </g>
        );
      })}
    </Frame>
  );
}

export function CompareView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const b = product.body as Compare;
  const { w } = SIZE[fmt];
  const wide = fmt === "wide";
  const list = b.cities.slice(0, wide ? 14 : 12);
  const cols = wide ? 2 : 1;
  const perCol = Math.ceil(list.length / cols);
  const colW = (w - (wide ? 120 : 80) - (cols - 1) * 40) / cols;
  const rowH = Math.min(wide ? 112 : 92, (wide ? 820 : 1080) / Math.max(1, perCol));
  return (
    <Frame fmt={fmt} title={product.title || "Today vs Tomorrow"} sub={`High temperatures · ${validLine(product.validFrom, product.validTo)}`} credit={credit(forecaster)}>
      {[0, 1].slice(0, cols).map((c) => (
        <g key={c}>
          <text x={(wide ? 60 : 40) + c * (colW + 40) + colW - 330} y={wide ? 196 : 226} text-anchor="middle" font-family={SANS} font-size="24" font-weight="700" letter-spacing="2" fill={C.muted}>TODAY</text>
          <text x={(wide ? 60 : 40) + c * (colW + 40) + colW - 90} y={wide ? 196 : 226} text-anchor="middle" font-family={SANS} font-size="24" font-weight="700" letter-spacing="2" fill={C.muted}>TOMORROW</text>
        </g>
      ))}
      {list.map((city, i) => {
        const c = Math.floor(i / perCol);
        const x = (wide ? 60 : 40) + c * (colW + 40);
        const y = (wide ? 214 : 244) + (i % perCol) * rowH;
        const d = city.tomorrow - city.today;
        const arrow = d > 1 ? "up" : d < -1 ? "down" : "flat";
        const ac = arrow === "up" ? "#ff9f1c" : arrow === "down" ? "#4ea3ff" : C.muted;
        return (
          <g key={city.name}>
            <rect x={x} y={y} width={colW} height={rowH - 12} rx="14" fill={C.panel} />
            <text x={x + 28} y={y + rowH / 2 + 8} font-family={SERIF} font-size="40" font-weight="700" fill={C.text}>{city.name}</text>
            <text x={x + colW - 330} y={y + rowH / 2 + 12} text-anchor="middle" font-family={SERIF} font-size="50" fill={C.muted}>{city.today}°</text>
            <g transform={`translate(${x + colW - 210} ${y + rowH / 2 - 6})`}>
              {arrow === "flat" ? <path d="M-22 0h40m-12 -12l12 12-12 12" stroke={ac} stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round" /> : <path d={arrow === "up" ? "M0 -24l18 22h-11v22h-14v-22h-11z" : "M0 24l18 -22h-11v-22h-14v22h-11z"} fill={ac} />}
              <text x="34" y="12" font-family={SANS} font-size="30" font-weight="800" fill={ac}>{d > 0 ? `+${d}` : d}</text>
            </g>
            <text x={x + colW - 90} y={y + rowH / 2 + 14} text-anchor="middle" font-family={SERIF} font-size="58" font-weight="700" fill={tempColor(city.tomorrow)}>{city.tomorrow}°</text>
          </g>
        );
      })}
    </Frame>
  );
}

const CONF = { low: { label: "Low confidence", color: "#ff9f1c", bars: 1 }, medium: { label: "Medium confidence", color: "#ffd23f", bars: 2 }, high: { label: "High confidence", color: "#3ecf9a", bars: 3 } } as const;

export function OddsView({ product, fmt, forecaster }: { product: StudioProduct; fmt: Format; forecaster: string }) {
  const b = product.body as Odds;
  const { w } = SIZE[fmt];
  const wide = fmt === "wide";
  const x0 = wide ? 60 : 40;
  const barX = wide ? 640 : 40;
  const barW = w - barX - (wide ? 200 : 160);
  const rowH = Math.min(wide ? 170 : 200, (wide ? 620 : 860) / Math.max(1, b.outcomes.length));
  const conf = CONF[b.confidence];
  return (
    <Frame fmt={fmt} title={product.title || "The Odds"} sub={`${b.event ? `${b.event} · ` : ""}${validLine(product.validFrom, product.validTo)}`} credit={credit(forecaster)}>
      {b.outcomes.map((o, i) => {
        const y = (wide ? 200 : 220) + i * rowH;
        const col = o.pct >= 70 ? "#ff8a65" : o.pct >= 40 ? "#ffb36b" : "#7cc3ff";
        return (
          <g key={i}>
            <text x={x0} y={y + (wide ? 50 : 40)} font-family={SERIF} font-size={wide ? 42 : 40} font-weight="700" fill={C.text}>{o.label}</text>
            <rect x={barX} y={y + (wide ? 14 : 62)} width={barW} height="48" rx="24" fill={C.panel} />
            <rect x={barX} y={y + (wide ? 14 : 62)} width={Math.max(48, (barW * o.pct) / 100)} height="48" rx="24" fill={col} />
            <text x={barX + barW + 24} y={y + (wide ? 52 : 100)} font-family={SERIF} font-size="48" font-weight="700" fill={C.text}>{o.pct}%</text>
          </g>
        );
      })}
      <g transform={`translate(${x0} ${wide ? 880 : 1120})`}>
        {[0, 1, 2].map((k) => <rect key={k} x={k * 30} y={-36 + (2 - k) * 0} width="22" height="40" rx="5" fill={k < conf.bars ? conf.color : C.panel2} />)}
        <text x="110" y="0" font-family={SANS} font-size="34" font-weight="800" fill={conf.color}>{conf.label}</text>
        {b.note && <text x="110" y="48" font-family={SANS} font-size="28" fill={C.muted}>{wrap(b.note, wide ? 100 : 50)[0]}</text>}
      </g>
    </Frame>
  );
}
