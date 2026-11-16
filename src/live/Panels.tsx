import type { LiveConfig } from "../../shared/config";
import type { Rundown, RundownItem } from "../../shared/live/rundown";
import { SPC_PHRASE } from "../../shared/live/templates";
import type { Alert } from "../../shared/types";
import { Logo } from "../components/Chrome";
import { Host } from "./host/Host";
import { LiveRadar } from "./LiveRadar";
import { project } from "./player";
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
        <b>{r.score.toFixed(2)}</b>
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
      return <LiveRadar bbox={region.bbox} polygon={it.view === "warning" ? (a?.geometry ?? null) : null} />;
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
        <div class="bc-card bc-host-card">
          <p class="bc-kicker">{it.headline}</p>
          <h2>{it.text}</h2>
        </div>
      );
  }
}

/** Schematic locator: region outline, city dots, and a pin on the city or warning in view. */
function Locator({ r, region }: { r: Rundown; region: Region }) {
  const it = current.value;
  const pin = it?.kind === "segment" ? project(it.city.lon, it.city.lat, region.bbox) : null;
  const warn = it && (it.kind === "alert" || (it.kind === "radar" && it.view === "warning")) ? r.alerts.find((a) => a.id === (it as { alertId?: string }).alertId) : undefined;
  return (
    <svg class="bc-locator" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Locator map">
      <rect x="1" y="1" width="98" height="98" rx="4" class="bc-loc-frame" />
      {region.cities.map((c) => {
        const p = project(c.lon, c.lat, region.bbox);
        return <circle key={c.name} cx={p.x * 100} cy={p.y * 100} r="1.4" class="bc-loc-dot" />;
      })}
      {warn?.geometry && (
        <polygon
          class="bc-loc-warn"
          points={
            ((warn.geometry.type === "Polygon" ? (warn.geometry.coordinates as number[][][])[0] : (warn.geometry.coordinates as number[][][][])[0]?.[0]) ?? [])
              .map(([lon, lat]) => {
                const p = project(lon!, lat!, region.bbox);
                return `${p.x * 100},${p.y * 100}`;
              })
              .join(" ")
          }
        />
      )}
      {pin && <circle cx={pin.x * 100} cy={pin.y * 100} r="3.2" class="bc-loc-pin" />}
    </svg>
  );
}

export function RightRail({ r, region }: { r: Rundown; region: Region }) {
  return (
    <aside class="bc-rail">
      <div class="bc-rail-box"><p class="bc-kicker">Locator</p><Locator r={r} region={region} /></div>
      <div class="bc-rail-box bc-next">
        <p class="bc-kicker">Up next</p>
        <ul>{upNext.value.map((i) => <li key={i.key}>{i.headline}</li>)}</ul>
        <p class="bc-credit">Data: NWS · NOAA SPC · RainViewer · Open-Meteo</p>
      </div>
      <div class="bc-hostbox"><Host level={r.level} /></div>
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
  if (r.level !== "WARNING" && r.level !== "EMERGENCY") return null;
  const text = r.alerts.filter((a) => /warning|emergency/i.test(a.event)).map((a) => `${a.event.toUpperCase()}: ${a.areaDesc}`).join("   •   ");
  return <div class="bc-crawl" aria-hidden="true"><span>{text}</span></div>;
}
