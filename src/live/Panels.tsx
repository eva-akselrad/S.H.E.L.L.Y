import type { LiveConfig } from "../../shared/config";
import type { Rundown, RundownItem } from "../../shared/live/rundown";
import { SPC_PHRASE } from "../../shared/live/templates";
import type { Alert, PolygonGeom } from "../../shared/types";
import { decodeRing, makeProjector, type Projector } from "../../shared/projection";
import basemap from "../studio/basemap.json";
import { BlockView, BulletinCard } from "./Blocks";
import { Logo } from "../components/Chrome";
import { Host } from "./host/Host";
import { LiveRadar } from "./LiveRadar";
import { ProductView } from "../studio/ProductView";
import { clock, current, products, rundown, upNext } from "./state";

type Region = LiveConfig["region"];

const LEVEL_NAME = { CALM: "Calm", ELEVATED: "Elevated", WARNING: "Warning", EMERGENCY: "Emergency" } as const;

export function AlertCounters({ r }: { r: Rundown }) {
  const c = r.counters;
  const cell = (label: string, n: number, cls: string) => (
    <div class={`bc-count ${cls} ${n ? "on" : ""}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
  return (
    <div class="bc-counters" aria-label="Active alerts in the region">
      {cell("TOR", c.tor, "tor")}
      {cell("SVR", c.svr, "svr")}
      {cell("FFW", c.ffw, "ffw")}
      {cell("WATCH", c.watch, "watch")}
    </div>
  );
}

export function HeadlineBar({ r }: { r: Rundown }) {
  // calm and elevated can rotate the AI headlines; warnings and emergencies always show the template headline
  const rotating = r.headlines.length > 0 && (r.level === "CALM" || r.level === "ELEVATED");
  const text = rotating ? r.headlines[Math.floor(clock.value / 25_000) % r.headlines.length]! : (current.value?.headline ?? r.region.toUpperCase());
  return (
    <div class={`bc-headline lvl-${r.level.toLowerCase()}`} aria-live="polite">
      <span key={text} class="bc-headline-text">{text.toUpperCase()}</span>
    </div>
  );
}

export function IntensityGauge({ r }: { r: Rundown }) {
  return (
    <div class={`bc-gauge lvl-${r.level.toLowerCase()}`} title={r.drivers.join(", ")}>
      <div class="bc-gauge-top">
        <span class="bc-gauge-label">SHELLY INDEX</span>
        <b>{Math.round(r.score * 100)}</b>
      </div>
      <div class="bc-gauge-bar"><i style={{ width: `${Math.round(r.score * 100)}%` }} /></div>
      <span class="bc-gauge-level">{LEVEL_NAME[r.level]}</span>
    </div>
  );
}

function AlertCard({ alert, item }: { alert: Alert | undefined; item: RundownItem }) {
  if (!alert) return <div class="bc-card"><h2>{item.headline}</h2></div>;
  const emergency = /emergency/i.test(alert.event) || item.speak?.startsWith("Attention. This is an emergency");
  const text = (alert.instruction || alert.description).replace(/\s+/g, " ").trim().slice(0, 460);
  const area = alert.areaDesc.split(";").map((s) => s.trim()).filter(Boolean).slice(0, 6).join(" · ");
  return (
    <div class={`bc-alert ${emergency ? "emergency" : /warning/i.test(alert.event) ? "warning" : "watch"}`}>
      <h2>{alert.event}</h2>
      <p class="bc-alert-area">{area}</p>
      {alert.expires && <p class="bc-alert-until">Until {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: rundown.value?.tz }).format(new Date(alert.expires))}</p>}
      <p class="bc-alert-text">{text}</p>
    </div>
  );
}

export function MainPanel({ r, region, forecaster = "" }: { r: Rundown; region: Region; forecaster?: string }) {
  const it = current.value;
  if (!it) return <div class="bc-card"><h2>{r.region}</h2></div>;
  switch (it.kind) {
    case "alert":
      return <AlertCard alert={r.alerts.find((a) => a.id === it.alertId)} item={it} />;
    case "radar": {
      const a = it.alertId ? r.alerts.find((x) => x.id === it.alertId) : undefined;
      return <LiveRadar bbox={region.bbox} polygon={it.view === "warning" ? (a?.geometry ?? null) : null} track={it.view === "warning" ? (it.track ?? null) : null} />;
    }
    case "segment":
      return (
        <div class="bc-city">
          <p class="bc-city-name">{it.city.name}, {it.city.state}</p>
          <p class="bc-city-temp">{Math.round(it.temp)}°</p>
          <p class="bc-city-desc">{it.desc}</p>
        </div>
      );
    case "outlook":
      return (
        <div class="bc-card">
          <p class="bc-kicker">Severe weather outlook</p>
          <h2>{it.spc === "NONE" || it.spc === "TSTM" ? "No significant severe weather expected today" : `${SPC_PHRASE[it.spc]} of severe weather today`}</h2>
          <p class="bc-sub">From the NOAA Storm Prediction Center, for the {r.region}.</p>
        </div>
      );
    case "map": {
      const p = products.value.find((x) => x.id === it.product);
      if (!p) return <div class="bc-card"><p class="bc-kicker">Forecaster graphic</p><h2>{it.headline}</h2></div>;
      return <div class="bc-studio"><ProductView product={p} fmt="wide" forecaster={forecaster} /></div>;
    }
    case "cam":
      return <div class="bc-card"><p class="bc-kicker">Live camera</p><h2>{it.headline}</h2></div>;
    case "host":
      return (
        <div class={`bc-card bc-host-card src-${it.source}`}>
          <p class="bc-kicker">{it.source === "you" || it.source === "ai" ? `${it.headline} · live from the studio` : it.headline}</p>
          <h2>{it.text}</h2>
        </div>
      );
    case "block":
      return <BlockView it={it} r={r} bbox={region.bbox} />;
    case "bulletin":
      return <BulletinCard b={r.bulletins.find((b) => b.id === it.bulletinId)} tz={r.tz} />;
  }
}

const LOC_W = 432;
const LOC_H = 196;

/** Region outline cache: county and state paths only change when the region box does. */
let locCache: { k: string; counties: string; borders: string } | null = null;
function locPaths(proj: Projector, b: Region["bbox"]): { counties: string; borders: string } {
  const k = `${b.south},${b.west},${b.north},${b.east}`;
  if (locCache?.k === k) return locCache;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const line = (ring: number[][], close: boolean) => ring.map(([lon, lat], i) => `${i ? "L" : "M"}${proj.xy(lon!, lat!).map(r1).join(" ")}`).join("") + (close ? "Z" : "");
  const counties = basemap.counties.map((c) => c.polys.map((rings) => rings.map((ring) => line(decodeRing(ring), true)).join("")).join("")).join("");
  const borders = basemap.borders.map((l) => line(decodeRing(l), false)).join("");
  locCache = { k, counties, borders };
  return locCache;
}

function polyPoints(g: PolygonGeom, proj: Projector): string {
  const ring = (g.type === "Polygon" ? (g.coordinates as number[][][])[0] : (g.coordinates as number[][][][])[0]?.[0]) ?? [];
  return ring.map(([lon, lat]) => proj.xy(lon!, lat!).map((n) => Math.round(n)).join(",")).join(" ");
}

/** Locator: the real county and state map, every alert area, and a pin on whatever is on screen. */
function Locator({ r, region }: { r: Rundown; region: Region }) {
  const it = current.value;
  const b = region.bbox;
  // widen the view east-west so the map fills the wide locator box instead of a narrow strip
  const kx = Math.cos((((b.south + b.north) / 2) * Math.PI) / 180);
  const latSpan = b.north - b.south + 0.3;
  const lonSpan = Math.max(b.east - b.west + 0.4, (latSpan * (LOC_W / LOC_H)) / kx);
  const midLon = (b.west + b.east) / 2;
  const view = { south: b.south - 0.15, west: midLon - lonSpan / 2, north: b.north + 0.15, east: midLon + lonSpan / 2 };
  const proj = makeProjector(view, { x: 0, y: 0, w: LOC_W, h: LOC_H });
  const paths = locPaths(proj, view);
  const f = proj.fit;

  const cityName = it?.kind === "segment" ? it.city.name : it?.kind === "block" ? (it.city || (["sevenDay", "hourly", "sun", "weekend"].includes(it.block) ? region.cities[0]?.name : undefined)) : undefined;
  const city = cityName ? region.cities.find((c) => c.name === cityName) : undefined;
  const alertId = it && (it.kind === "alert" || it.kind === "radar") ? it.alertId : undefined;
  const warn = alertId ? r.alerts.find((a) => a.id === alertId) : undefined;
  const regionWide = it?.kind === "radar" && it.view === "region";
  const allCities = it?.kind === "block" && !city;
  const pin = city ? proj.xy(city.lon, city.lat) : null;
  const [bx0, by0] = proj.xy(b.west, b.north);
  const [bx1, by1] = proj.xy(b.east, b.south);

  const caption = city ? `${city.name}, ${city.state}` : warn ? warn.event : regionWide || allCities ? r.region : it?.kind === "map" ? "Forecaster graphic" : r.region;

  return (
    <div class="bc-locwrap">
      <svg class="bc-locator" viewBox={`0 0 ${LOC_W} ${LOC_H}`} role="img" aria-label={`Locator map: ${caption}`}>
        <defs><clipPath id="loc-clip"><rect x={f.x} y={f.y} width={f.w} height={f.h} rx="8" /></clipPath></defs>
        <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="8" class="bc-loc-water" />
        <g clip-path="url(#loc-clip)">
          <path d={paths.counties} class="bc-loc-land" />
          <path d={paths.borders} class="bc-loc-border" />
          {r.alerts.filter((a) => a.geometry && a.id !== warn?.id).map((a) => (
            <polygon key={a.id} points={polyPoints(a.geometry!, proj)} class={/warning|emergency/i.test(a.event) ? "bc-loc-alert warn" : "bc-loc-alert"} />
          ))}
          {warn?.geometry && <polygon points={polyPoints(warn.geometry, proj)} class="bc-loc-warn" />}
          {regionWide && <rect x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} class="bc-loc-view" />}
          {region.cities.map((c) => {
            const [x, y] = proj.xy(c.lon, c.lat);
            return <circle key={c.name} cx={x} cy={y} r={allCities ? 4 : 2.6} class={allCities ? "bc-loc-dot on" : "bc-loc-dot"} />;
          })}
          {pin && (
            <g class="bc-loc-pin" transform={`translate(${pin[0]} ${pin[1]})`}>
              <circle r="14" class="bc-loc-ping" />
              <circle r="6.5" class="bc-loc-pin-dot" />
            </g>
          )}
        </g>
        <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="8" class="bc-loc-frame" />
      </svg>
      <p class="bc-loc-cap">{caption}</p>
    </div>
  );
}

export function RightRail({ r, region }: { r: Rundown; region: Region }) {
  return (
    <aside class="bc-rail">
      <div class="bc-rail-box bc-loc-box"><p class="bc-kicker">Locator</p><Locator r={r} region={region} /></div>
      <div class="bc-rail-box bc-next">
        <p class="bc-kicker">Up next{r.hold ? <span class="bc-hold">Holding: {r.hold}</span> : null}</p>
        <ul>{upNext.value.map((i) => <li key={i.key}>{i.headline}</li>)}</ul>
        <p class="bc-credit">Data: NWS · NOAA SPC · Iowa Environmental Mesonet · Open-Meteo</p>
      </div>
      <div class="bc-hostbox">{!(current.value?.kind === "block" && current.value.block === "ident") && <Host level={r.level} />}</div>
    </aside>
  );
}

export function LowerThird({ r }: { r: Rundown }) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...o, timeZone: r.tz }).format(new Date(clock.value));
  return (
    <footer class={`bc-lower lvl-${r.level.toLowerCase()}`}>
      <div class="bc-lower-brand"><Logo /></div>
      <div class="bc-lower-time"><b>{f({ hour: "numeric", minute: "2-digit" })}</b><span>{f({ weekday: "short", month: "short", day: "numeric" })}</span></div>
      <div class="bc-lower-alert">
        <span class="bc-lower-tag">TOP ALERT</span>
        <b>{r.topAlert}</b>
        <span class="bc-lower-status">{r.status}</span>
      </div>
    </footer>
  );
}

export function Crawl({ r }: { r: Rundown }) {
  const warn = r.level === "WARNING" || r.level === "EMERGENCY";
  const parts = [
    ...(warn ? r.alerts.filter((a) => /warning|emergency/i.test(a.event)).map((a) => `${a.event.toUpperCase()}: ${a.areaDesc}`) : []),
    ...(r.bulletins ?? []).map((b) => `SHELLY ${b.level.toUpperCase()}: ${b.title.toUpperCase()}${b.area ? ` (${b.area})` : ""}. ${b.body}`),
  ];
  if (!parts.length) return null;
  const text = parts.join("   •   ");
  return <div class={`bc-crawl${warn ? "" : " bul"}`} aria-hidden="true"><span>{text}</span></div>;
}
