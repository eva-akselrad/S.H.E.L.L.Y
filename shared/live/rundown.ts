import type { LiveCity, LiveConfig } from "../config";
import type { SegmentId } from "../scheduler";
import { alertScript, isSpokenAlert } from "../script";
import { isEmergency } from "../threat";
import type { Alert, SpcCategory, ThreatLevel } from "../types";
import { productActive, type StudioProduct } from "../studio";
import { isTor, type Counters, type Intensity } from "./intensity";
import { alertHeadline, cityHeadline, citySpeak, SPC_PHRASE, statusLine, talkBreak, topAlertLine } from "./templates";

export type RundownKind = "alert" | "radar" | "cam" | "map" | "segment" | "outlook" | "host";

interface Base {
  /** unique within a rundown (items can repeat) */
  key: string;
  durationSec: number;
  headline: string;
  /** spoken text; absent = silent */
  speak?: string;
}
export type RundownItem = Base &
  (
    | { kind: "alert"; alertId: string }
    | { kind: "radar"; view: "region" | "warning"; alertId?: string }
    | { kind: "cam"; camId: string }
    | { kind: "map"; product: string }
    | { kind: "segment"; id: SegmentId; city: LiveCity }
    | { kind: "outlook"; spc: SpcCategory }
    | { kind: "host"; text: string; source: "llm" | "template" }
  );

export interface CityWx extends LiveCity {
  temp: number;
  desc: string;
}

export interface RundownData {
  /** active alerts in the region */
  alerts: Alert[];
  spc: SpcCategory;
  cities: CityWx[];
  studio: StudioProduct[];
  cams: { id: string; title: string }[];
  /** optional LLM colour (calm periods only); falls back to templates */
  talkBreak?: string;
  headlines?: string[];
}

export interface Rundown {
  v: 1;
  generatedAt: string;
  region: string;
  tz: string;
  level: ThreatLevel;
  score: number;
  drivers: string[];
  counters: Counters;
  topAlert: string;
  status: string;
  /** rotating headline-bar text for calm periods (LLM or empty); WARNING+ always uses item headlines */
  headlines: string[];
  alerts: Alert[];
  items: RundownItem[];
}

const DEFAULT_SECONDS: Record<string, number> = { radar: 20, cam: 15, map: 16, segment: 12, outlook: 12, host: 14, watch: 10 };
const BUCKET_MS = 10 * 60 * 1000;

const rank = (a: Alert): number => (isEmergency(a) ? 3 : isTor(a) ? 2 : 1) * 1e13 + (Date.parse(a.sent) || 0);
export const isWarning = (a: Alert): boolean => /warning|emergency/i.test(a.event);

function rotate<T>(list: T[], by: number): T[] {
  if (!list.length) return list;
  const n = ((by % list.length) + list.length) % list.length;
  return [...list.slice(n), ...list.slice(0, n)];
}

export function buildRundown(intensity: Intensity, data: RundownData, cfg: LiveConfig, now: number): Rundown {
  const { region } = cfg;
  const secs = (k: string): number => cfg.itemSeconds[k] ?? DEFAULT_SECONDS[k] ?? 12;
  const bucket = Math.floor(now / BUCKET_MS);
  const level = intensity.level;
  const active = data.alerts.filter((a) => !a.expires || Date.parse(a.expires) > now);
  const warnings = active.filter(isWarning).sort((a, b) => rank(b) - rank(a));
  const watches = active.filter((a) => !isWarning(a));
  const top = warnings[0] ?? null;

  let n = 0;
  const key = (k: string): string => `${k}:${n++}`;

  const alertItem = (a: Alert): RundownItem => {
    const speak = isSpokenAlert(a) ? alertScript(a, isEmergency(a)) : undefined;
    return {
      key: key(`alert:${a.id}`),
      kind: "alert",
      alertId: a.id,
      headline: alertHeadline(a, region.tz),
      durationSec: speak ? Math.min(90, Math.max(20, Math.ceil(speak.length / 13) + 4)) : secs("watch"),
      ...(speak ? { speak } : {}),
    };
  };
  const warnRadar = (a: Alert): RundownItem => ({
    key: key("radar:w"), kind: "radar", view: "warning", alertId: a.id, headline: `RADAR: ${a.event.toUpperCase()}`, durationSec: secs("radar"),
  });
  const regionRadar = (): RundownItem => ({
    key: key("radar:r"), kind: "radar", view: "region", headline: `${region.name.toUpperCase()} RADAR`, durationSec: secs("radar"),
  });
  const cityItems = (count: number): RundownItem[] =>
    rotate(data.cities, bucket * 3)
      .slice(0, count)
      .map((c) => ({
        key: key(`city:${c.name}`), kind: "segment", id: "now", city: c, headline: cityHeadline(c.name, c.temp, c.desc),
        speak: citySpeak(c.name, c.temp, c.desc), durationSec: secs("segment"),
      }));
  const mapItems = (): RundownItem[] =>
    data.studio.filter((p) => productActive(p, now)).slice(0, 4).map((p) => ({
      key: key(`map:${p.id}`), kind: "map", product: p.id, headline: p.title.toUpperCase(), durationSec: secs("map"),
    }));
  const outlookItem = (): RundownItem => ({
    key: key("outlook"), kind: "outlook", spc: data.spc,
    headline: data.spc === "NONE" || data.spc === "TSTM" ? "SEVERE WEATHER OUTLOOK" : `SEVERE WEATHER OUTLOOK: ${SPC_PHRASE[data.spc].toUpperCase()} TODAY`,
    durationSec: secs("outlook"),
  });
  const hostItem = (): RundownItem => {
    const text = data.talkBreak || talkBreak(bucket, region.name);
    return { key: key("host"), kind: "host", text, source: data.talkBreak ? "llm" : "template", headline: `${cfg.host.name.toUpperCase()}`, speak: text, durationSec: Math.max(secs("host"), Math.ceil(text.length / 13) + 3) };
  };
  const camItems = (): RundownItem[] =>
    data.cams.slice(0, 2).map((c) => ({ key: key(`cam:${c.id}`), kind: "cam", camId: c.id, headline: c.title.toUpperCase(), durationSec: secs("cam") }));

  const items: RundownItem[] = [];
  const notableSpc = data.spc !== "NONE" && data.spc !== "TSTM";

  if (level === "EMERGENCY") {
    // full takeover: only the emergency and other warnings, with their radar
    const emer = warnings.filter(isEmergency);
    const list = (emer.length ? emer : warnings).slice(0, 4);
    for (const a of list) items.push(alertItem(a), warnRadar(a));
  } else if (level === "WARNING" && top) {
    const content: RundownItem[] = [];
    const cs = cityItems(4);
    const ms = mapItems();
    for (let i = 0; i < Math.max(cs.length, ms.length); i++) {
      if (cs[i]) content.push(cs[i]!);
      if (ms[i]) content.push(ms[i]!);
    }
    content.push(outlookItem());
    const cycle = warnings.slice(0, 3);
    items.push(alertItem(top), warnRadar(top));
    for (let i = 0; i < content.length; i += 3) {
      items.push(...content.slice(i, i + 3));
      const a = cycle[(i / 3 + 1) % cycle.length]!;
      items.push(alertItem(a), warnRadar(a));
    }
  } else if (level === "ELEVATED") {
    const content: RundownItem[] = [outlookItem(), ...cityItems(4), ...mapItems()];
    for (const w of watches.slice(0, 3)) content.splice(1, 0, alertItem(w));
    content.forEach((c, i) => {
      items.push(c);
      if (i % 2 === 0) items.push(regionRadar());
    });
  } else {
    // CALM: cities, radar, forecaster graphics, outlook, cams and an occasional talk break
    const cs = cityItems(5);
    const ms = mapItems();
    items.push(regionRadar());
    cs.slice(0, 2).forEach((c) => items.push(c));
    items.push(...ms);
    if (notableSpc) items.push(outlookItem());
    cs.slice(2).forEach((c) => items.push(c));
    items.push(...camItems());
    items.push(hostItem());
  }

  if (!items.length) items.push(regionRadar(), hostItem());

  return {
    v: 1,
    generatedAt: new Date(now).toISOString(),
    region: region.name,
    tz: region.tz,
    level,
    score: intensity.score,
    drivers: intensity.drivers,
    counters: intensity.counters,
    topAlert: topAlertLine(top, region.name, region.tz),
    status: statusLine(warnings.length, watches.length),
    headlines: level === "CALM" || level === "ELEVATED" ? (data.headlines ?? []) : [],
    alerts: [...warnings, ...watches].slice(0, 10),
    items,
  };
}
