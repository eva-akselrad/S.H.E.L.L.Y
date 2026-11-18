// SHELLY Live data blocks. Everything renders from the rundown (rundown.wx, alerts, bulletins),
// so the page never fetches weather itself.
import type { BlockId, Bulletin, CityFull, RegionWx } from "../../shared/live/blocks";
import { pickCity, weekendDays } from "../../shared/live/blocktext";
import type { Rundown, RundownItem } from "../../shared/live/rundown";
import { makeProjector } from "../../shared/projection";
import type { Bbox } from "../../shared/types";
import { fmtDayLength, moonPhase, uvLabel, windDir, wmoToWeather } from "../../shared/wx";
import { WxIcon } from "../components/Icon";
import { Basemap } from "../studio/Frame";
import { placeLabels, tempColor } from "../studio/views/CityTemps";
import { Host } from "./host/Host";

const W = 1228;
const H = 750;
const r = Math.round;

const dayName = (date: string, i: number): string =>
  i === 0 ? "Today" : new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const localTime = (iso: string): string => (iso ? new Date(`${iso.length === 16 ? `${iso}:00` : iso}Z`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "--");
const hourLabel = (iso: string): string => new Date(`${iso}:00Z`).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" });

const popColor = (p: number): string => (p >= 70 ? "#2f7bff" : p >= 40 ? "#4ea3ff" : p >= 20 ? "#7cc3ff" : "#5b6b86");
const windColor = (g: number): string => (g >= 45 ? "#ff4d4d" : g >= 30 ? "#ff9f1c" : g >= 20 ? "#ffd23f" : "#6fe08a");
const dewColor = (d: number): string => (d >= 70 ? "#ff4d4d" : d >= 65 ? "#ff9f1c" : d >= 55 ? "#ffd23f" : d >= 40 ? "#6fe08a" : "#3d8bff");
const dewWord = (d: number): string => (d >= 70 ? "Oppressive" : d >= 65 ? "Sticky" : d >= 55 ? "Humid" : d >= 40 ? "Comfortable" : "Dry");

interface MapSpec {
  title: string;
  sub: string;
  value: (c: CityFull) => number | null;
  label: (c: CityFull) => string;
  color: (c: CityFull) => string;
  arrow?: (c: CityFull) => number;
}

const MAPS: Partial<Record<BlockId, MapSpec>> = {
  tempsNow: { title: "Temperatures Right Now", sub: "Current readings across the region", value: (c) => c.now.temp, label: (c) => `${r(c.now.temp)}°`, color: (c) => tempColor(c.now.temp) },
  feelsNow: { title: "Feels Like", sub: "Wind chill and heat index", value: (c) => c.now.feels, label: (c) => `${r(c.now.feels)}°`, color: (c) => tempColor(c.now.feels) },
  highs: { title: "Today's Highs", sub: "Forecast high temperatures", value: (c) => c.daily[0]?.hi ?? null, label: (c) => `${r(c.daily[0]?.hi ?? 0)}°`, color: (c) => tempColor(c.daily[0]?.hi ?? 0) },
  lows: { title: "Tonight's Lows", sub: "Forecast overnight lows", value: (c) => c.daily[1]?.lo ?? null, label: (c) => `${r(c.daily[1]?.lo ?? 0)}°`, color: (c) => tempColor(c.daily[1]?.lo ?? 0) },
  tomorrow: { title: "Tomorrow's Highs", sub: "Forecast highs for tomorrow", value: (c) => c.daily[1]?.hi ?? null, label: (c) => `${r(c.daily[1]?.hi ?? 0)}°`, color: (c) => tempColor(c.daily[1]?.hi ?? 0) },
  rainChance: { title: "Chance of Rain Today", sub: "Highest chance of rain or snow today", value: (c) => c.daily[0]?.pop ?? null, label: (c) => `${r(c.daily[0]?.pop ?? 0)}%`, color: (c) => popColor(c.daily[0]?.pop ?? 0) },
  wind: { title: "Wind Right Now", sub: "Speed and gusts in mph; arrows show where it's blowing", value: (c) => c.now.wind, label: (c) => (c.now.gust >= c.now.wind + 8 ? `${r(c.now.wind)} G${r(c.now.gust)}` : `${r(c.now.wind)}`), color: (c) => windColor(c.now.gust), arrow: (c) => c.now.dir + 180 },
  humidity: { title: "Dew Points", sub: "Under 55 comfortable · 65 and up sticky", value: (c) => c.now.dew, label: (c) => `${r(c.now.dew)}°`, color: (c) => dewColor(c.now.dew) },
};

/**
 * Frame the map on the cities themselves (not the whole region box) so the busy Philadelphia
 * cluster gets room, then widen it to the panel's shape so the map fills the screen.
 */
function frame(cities: CityFull[], fallback: Bbox): Bbox {
  if (cities.length < 2) return fallback;
  const lats = cities.map((c) => c.lat);
  const lons = cities.map((c) => c.lon);
  const south = Math.min(...lats) - 0.28;
  const north = Math.max(...lats) + 0.38;
  const kx = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const latSpan = north - south;
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const lonSpan = Math.max(Math.max(...lons) - Math.min(...lons) + 0.8, (latSpan * ((W - 48) / (H - 48))) / kx);
  // nudge east so the title card on the left covers land, not cities
  const shift = lonSpan * 0.08;
  return { south, north, west: midLon - lonSpan / 2 - shift, east: midLon + lonSpan / 2 - shift };
}

export function CityMap({ block, wx, bbox }: { block: BlockId; wx: RegionWx; bbox: Bbox }) {
  const spec = MAPS[block];
  if (!spec) return null;
  const cities = wx.cities.filter((c) => spec.value(c) !== null);
  const view = frame(cities, bbox);
  const proj = makeProjector(view, { x: 24, y: 24, w: W - 48, h: H - 48 });
  const placed = placeLabels(cities.map((c) => ({ c: { name: c.name, lat: c.lat, lon: c.lon, value: spec.value(c) ?? 0 }, xy: proj.xy(c.lon, c.lat) })));
  return (
    <div class="bc-blockmap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title}>
        <Basemap proj={proj} bbox={view} />
        {placed.map(({ c, xy: [x, y], bx, by }) => {
          const full = cities.find((k) => k.name === c.name)!;
          const col = spec.color(full);
          const text = spec.label(full);
          const w = Math.max(88, text.length * 21 + 26);
          return (
            <g key={c.name} class="bc-map-pin">
              <line x1={x} y1={y} x2={bx} y2={by} stroke={col} stroke-width="2" opacity=".7" />
              <circle cx={x} cy={y} r="7" fill={col} stroke="#0b1220" stroke-width="3" />
              <rect x={bx - w / 2} y={by - 26} width={w} height="44" rx="12" fill="#0b1220" stroke={col} stroke-width="3" />
              {spec.arrow && (
                <g transform={`translate(${bx - w / 2 - 18} ${by - 4}) rotate(${spec.arrow(full)})`}>
                  <path d="M0 -14 L8 6 L0 1 L-8 6 Z" fill={col} />
                </g>
              )}
              <text x={bx} y={by + 9} text-anchor="middle" class="bc-map-val">{text}</text>
              <text x={bx} y={by + 42} text-anchor="middle" class="bc-map-name">{c.name}</text>
            </g>
          );
        })}
      </svg>
      <div class="bc-blockmap-head">
        <h2>{spec.title}</h2>
        <p>{spec.sub}</p>
      </div>
      {block === "humidity" && (
        <div class="bc-blockmap-key">
          {[[40, "Dry"], [54, "Comfortable"], [60, "Humid"], [67, "Sticky"], [72, "Oppressive"]].map(([d, w]) => <span key={w}><i style={{ background: dewColor(d as number) }} />{w}</span>)}
        </div>
      )}
    </div>
  );
}

function SevenDay({ c }: { c: CityFull }) {
  const days = c.daily.slice(0, 7);
  return (
    <div class="bc-block bc-7day">
      <p class="bc-kicker">7-day forecast · {c.name}, {c.state}</p>
      <div class="bc-7day-row">
        {days.map((d, i) => {
          const w = wmoToWeather(d.code);
          return (
            <div key={d.date} class="bc-day">
              <b>{dayName(d.date, i)}</b>
              <span class="bc-day-icon"><WxIcon icon={w.icon} size={92} /></span>
              <span class="bc-day-hi">{r(d.hi)}°</span>
              <span class="bc-day-lo">{r(d.lo)}°</span>
              <span class="bc-day-pop" style={{ opacity: d.pop >= 20 ? 1 : 0.35 }}>{r(d.pop)}%</span>
              <span class="bc-day-desc">{w.desc}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Hourly({ c }: { c: CityFull }) {
  const hrs = c.hourly.slice(0, 12);
  const temps = hrs.map((h) => h.temp);
  const lo = Math.min(...temps) - 2;
  const hi = Math.max(...temps) + 2;
  const y = (t: number) => 210 - ((t - lo) / Math.max(1, hi - lo)) * 170;
  const step = 1100 / Math.max(1, hrs.length - 1);
  const pts = hrs.map((h, i) => `${40 + i * step},${y(h.temp)}`).join(" ");
  return (
    <div class="bc-block bc-hourly">
      <p class="bc-kicker">Next 12 hours · {c.name}, {c.state}</p>
      <svg viewBox="0 0 1180 250" class="bc-hourly-line" aria-hidden="true">
        <polyline points={pts} fill="none" stroke="var(--accent)" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" />
        {hrs.map((h, i) => (
          <g key={h.time}>
            <circle cx={40 + i * step} cy={y(h.temp)} r="9" fill="var(--panel)" stroke="var(--accent)" stroke-width="5" />
            <text x={40 + i * step} y={y(h.temp) - 22} text-anchor="middle" class="bc-hourly-t">{r(h.temp)}°</text>
          </g>
        ))}
      </svg>
      <div class="bc-hourly-row">
        {hrs.map((h) => (
          <div key={h.time} class="bc-hour">
            <span class="bc-hour-icon"><WxIcon icon={wmoToWeather(h.code).icon} size={48} /></span>
            <span class="bc-hour-bar"><i style={{ height: `${Math.max(4, h.pop)}%`, background: popColor(h.pop) }} /></span>
            <span class="bc-hour-pop">{r(h.pop)}%</span>
            <b>{hourLabel(h.time)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Extremes({ wx }: { wx: RegionWx }) {
  const sorted = [...wx.cities].sort((a, b) => b.now.temp - a.now.temp);
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-5).reverse();
  const span = Math.max(1, (sorted[0]?.now.temp ?? 0) - (sorted[sorted.length - 1]?.now.temp ?? 0));
  const min = sorted[sorted.length - 1]?.now.temp ?? 0;
  const col = (title: string, list: CityFull[], cls: string) => (
    <div class={`bc-board ${cls}`}>
      <h3>{title}</h3>
      {list.map((c, i) => (
        <div key={c.name} class="bc-board-row">
          <span class="bc-board-rank">{i + 1}</span>
          <span class="bc-board-name">{c.name}</span>
          <span class="bc-board-bar"><i style={{ width: `${20 + ((c.now.temp - min) / span) * 80}%`, background: tempColor(c.now.temp) }} /></span>
          <b>{r(c.now.temp)}°</b>
        </div>
      ))}
    </div>
  );
  return (
    <div class="bc-block bc-extremes">
      <p class="bc-kicker">Right now around the region</p>
      <div class="bc-extremes-cols">
        {col("Warmest", top, "warm")}
        {col("Coolest", bottom, "cool")}
      </div>
    </div>
  );
}

function MoonGlyph({ age }: { age: number }) {
  // 0 new .. 14.77 full .. 29.5 new; draw the lit part with an ellipse terminator
  const f = age / 29.53;
  const lit = f <= 0.5 ? f * 2 : (1 - f) * 2; // 0..1 illuminated
  const waxing = f <= 0.5;
  const rx = Math.abs(1 - lit * 2) * 60;
  const sweepLit = lit > 0.5;
  const side = waxing ? 1 : 0;
  const d = `M70 10 A60 60 0 0 ${side} 70 130 A${rx} 60 0 0 ${sweepLit ? 1 - side : side} 70 10 Z`;
  return (
    <svg viewBox="0 0 140 140" width="150" height="150" aria-hidden="true">
      <circle cx="70" cy="70" r="60" fill="#2a3550" />
      <path d={d} fill="#f3ede4" />
    </svg>
  );
}

function Sun({ c, now }: { c: CityFull; now: number }) {
  const moon = moonPhase(new Date(now));
  return (
    <div class="bc-block bc-sun">
      <p class="bc-kicker">Sun and moon · {c.name}, {c.state}</p>
      <div class="bc-sun-grid">
        <div class="bc-stat"><span>Sunrise</span><b>{localTime(c.sunrise)}</b></div>
        <div class="bc-stat"><span>Sunset</span><b>{localTime(c.sunset)}</b></div>
        <div class="bc-stat"><span>Daylight</span><b>{fmtDayLength(`${c.sunrise}Z`, `${c.sunset}Z`)}</b></div>
        <div class="bc-stat bc-moon"><MoonGlyph age={moon.age} /><span>{moon.name}</span></div>
        <div class="bc-stat"><span>UV index today</span><b>{r(c.uv)} <small>{uvLabel(c.uv)}</small></b></div>
        <div class="bc-stat"><span>Wind now</span><b>{windDir(c.now.dir)} {r(c.now.wind)} <small>mph</small></b></div>
      </div>
    </div>
  );
}

function Weekend({ c }: { c: CityFull }) {
  const idx = weekendDays(c);
  return (
    <div class="bc-block bc-weekend">
      <p class="bc-kicker">Weekend outlook · {c.name}, {c.state}</p>
      <div class="bc-weekend-row">
        {idx.map((i) => {
          const d = c.daily[i]!;
          const w = wmoToWeather(d.code);
          return (
            <div key={d.date} class="bc-wkd">
              <h3>{new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}</h3>
              <WxIcon icon={w.icon} size={150} />
              <p class="bc-wkd-t"><b>{r(d.hi)}°</b> / {r(d.lo)}°</p>
              <p class="bc-wkd-d">{w.desc} · {r(d.pop)}% chance of rain</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BUL_LABEL = { info: "SHELLY Bulletin", advisory: "SHELLY Advisory", alert: "SHELLY Alert" } as const;

function AlertsBoard({ r: rd }: { r: Rundown }) {
  const t = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: rd.tz }).format(new Date(iso)) : "");
  return (
    <div class="bc-block bc-alertsboard">
      <p class="bc-kicker">Active alerts and bulletins</p>
      <ul>
        {rd.alerts.map((a) => (
          <li key={a.id} class={/warning|emergency/i.test(a.event) ? "warn" : "watch"}>
            <b>{a.event}</b>
            <span>{a.areaDesc.split(";").map((s) => s.trim()).slice(0, 3).join(", ")}</span>
            {a.expires && <em>until {t(a.expires)}</em>}
          </li>
        ))}
        {rd.bulletins.map((b) => (
          <li key={b.id} class={`bul bul-${b.level}`}>
            <b>{BUL_LABEL[b.level]}: {b.title}</b>
            <span>{b.area || "From the SHELLY forecaster"}</span>
            <em>until {t(b.until)}</em>
          </li>
        ))}
        {rd.alerts.length + rd.bulletins.length === 0 && <li class="none"><b>Nothing active right now</b></li>}
      </ul>
      <p class="bc-sub">NWS alerts come straight from the National Weather Service. SHELLY bulletins are from our forecaster.</p>
    </div>
  );
}

export function BulletinCard({ b, tz }: { b: Bulletin | undefined; tz: string }) {
  if (!b) return null;
  const until = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(b.until));
  return (
    <div class={`bc-bulletin bul-${b.level}`}>
      <p class="bc-bul-tag">{BUL_LABEL[b.level]} · from the forecaster</p>
      <h2>{b.title}</h2>
      {b.area && <p class="bc-alert-area">{b.area}</p>}
      <p class="bc-alert-until">Until {until}</p>
      <p class="bc-alert-text">{b.body}</p>
      <p class="bc-bul-note">Not an official National Weather Service alert.</p>
    </div>
  );
}

function Ident({ region, level }: { region: string; level: Rundown["level"] }) {
  return (
    <div class="bc-block bc-ident">
      <div class="bc-ident-host"><Host level={level} big /></div>
      <div class="bc-ident-text">
        <p class="bc-kicker">You're watching</p>
        <h2>SHELLY Live</h2>
        <p class="bc-sub">Weather for the {region}, around the clock.</p>
      </div>
    </div>
  );
}

function Message({ it }: { it: Extract<RundownItem, { kind: "block" }> }) {
  return (
    <div class="bc-card bc-message">
      <p class="bc-kicker">From the forecaster</p>
      {it.title && <h2>{it.title}</h2>}
      {it.text && <p class="bc-message-text">{it.text}</p>}
    </div>
  );
}

export function BlockView({ it, r: rd, bbox }: { it: Extract<RundownItem, { kind: "block" }>; r: Rundown; bbox: Bbox }) {
  const wx = rd.wx;
  if (it.block === "ident") return <Ident region={rd.region} level={rd.level} />;
  if (it.block === "message") return <Message it={it} />;
  if (it.block === "alertsBoard") return <AlertsBoard r={rd} />;
  if (!wx) return <div class="bc-card"><h2>{it.headline}</h2></div>;
  if (MAPS[it.block]) return <CityMap block={it.block} wx={wx} bbox={bbox} />;
  const c = pickCity(wx, it.city);
  if (!c) return <div class="bc-card"><h2>{it.headline}</h2></div>;
  switch (it.block) {
    case "sevenDay":
      return <SevenDay c={c} />;
    case "hourly":
      return <Hourly c={c} />;
    case "extremes":
      return <Extremes wx={wx} />;
    case "sun":
      return <Sun c={c} now={Date.parse(rd.generatedAt)} />;
    case "weekend":
      return <Weekend c={c} />;
    default:
      return <div class="bc-card"><h2>{it.headline}</h2></div>;
  }
}
