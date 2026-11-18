import type { LiveCity, LiveConfig } from "../config";
import type { SegmentId } from "../scheduler";
import { alertScript, isSpokenAlert } from "../script";
import { isEmergency } from "../threat";
import type { Alert, SpcCategory, ThreatLevel } from "../types";
import { productActive, type StudioProduct } from "../studio";
import { activeControl, BLOCK_INFO, type BlockId, type Bulletin, type LiveControl, type PlaylistEntry, type RegionWx } from "./blocks";
import { blockText } from "./blocktext";
import { isTor, type Counters, type Intensity } from "./intensity";
import { parseMotion, trackHeadline, trackScript, trackStorm, type TrackTown } from "./track";
import { TOWNS } from "./towns";
import { alertHeadline, cityHeadline, citySpeak, SPC_PHRASE, statusLine, talkBreak, topAlertLine } from "./templates";

export type RundownKind = "alert" | "radar" | "cam" | "map" | "segment" | "outlook" | "host" | "block" | "bulletin";

interface Base {
  /** unique within a rundown (items can repeat) */
  key: string;
  durationSec: number;
  headline: string;
  /** spoken text; absent = silent */
  speak?: string;
  /** set on things the forecaster sent (say, play next): the page plays each of these once */
  oneShot?: string;
}
export type RundownItem = Base &
  (
    | { kind: "alert"; alertId: string }
    | { kind: "radar"; view: "region" | "warning"; alertId?: string; track?: { origin: [number, number]; end: [number, number]; bearingDeg: number; towns: TrackTown[] } }
    | { kind: "cam"; camId: string }
    | { kind: "map"; product: string }
    | { kind: "segment"; id: SegmentId; city: LiveCity; temp: number; desc: string }
    | { kind: "outlook"; spc: SpcCategory }
    /** source: llm/template = automatic colour; you = typed by the forecaster; ai = AI line the forecaster approved */
    | { kind: "host"; text: string; source: "llm" | "template" | "you" | "ai" }
    | { kind: "block"; block: BlockId; city?: string; title?: string; text?: string }
    | { kind: "bulletin"; bulletinId: string }
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
  /** regional weather for the data blocks; blocks that need it are skipped without it */
  wx?: RegionWx | null;
  /** forecaster's on-air controls */
  control?: LiveControl | null;
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
  wx: RegionWx | null;
  bulletins: Bulletin[];
  /** the page jumps when this id changes */
  cmd: LiveControl["cmd"];
  /** label of the held block, if a hold is on */
  hold: string | null;
}

const DEFAULT_SECONDS: Record<string, number> = { radar: 20, cam: 15, map: 16, segment: 12, outlook: 12, host: 14, watch: 10, bulletin: 16 };
const BUCKET_MS = 10 * 60 * 1000;
/** rough speaking rate used to stretch an item so speech is never cut off */
const speakSecs = (text: string, pad = 4): number => Math.ceil(text.length / 13) + pad;

const rank = (a: Alert): number => (isEmergency(a) ? 3 : isTor(a) ? 2 : 1) * 1e13 + (Date.parse(a.sent) || 0);
export const isWarning = (a: Alert): boolean => /warning|emergency/i.test(a.event);

function rotate<T>(list: T[], by: number): T[] {
  if (!list.length) return list;
  const n = ((by % list.length) + list.length) % list.length;
  return [...list.slice(n), ...list.slice(0, n)];
}

const BULLETIN_TAG = { info: "SHELLY BULLETIN", advisory: "SHELLY ADVISORY", alert: "SHELLY ALERT" } as const;

export function buildRundown(intensity: Intensity, data: RundownData, cfg: LiveConfig, now: number): Rundown {
  const { region } = cfg;
  const secs = (k: string): number => cfg.itemSeconds[k] ?? BLOCK_INFO[k as BlockId]?.seconds ?? DEFAULT_SECONDS[k] ?? 12;
  const bucket = Math.floor(now / BUCKET_MS);
  const level = intensity.level;
  const active = data.alerts.filter((a) => !a.expires || Date.parse(a.expires) > now);
  const warnings = active.filter(isWarning).sort((a, b) => rank(b) - rank(a));
  const watches = active.filter((a) => !isWarning(a));
  const top = warnings[0] ?? null;
  const ctl = activeControl(data.control ?? null, now);
  const wx = data.wx && data.wx.cities.length ? data.wx : null;
  const notableSpc = data.spc !== "NONE" && data.spc !== "TSTM";
  const calmish = level === "CALM" || level === "ELEVATED";

  let n = 0;
  const key = (k: string): string => `${k}:${n++}`;
  let cityCursor = 0;

  const alertItem = (a: Alert): RundownItem => {
    const speak = isSpokenAlert(a) ? alertScript(a, isEmergency(a)) : undefined;
    return {
      key: key(`alert:${a.id}`),
      kind: "alert",
      alertId: a.id,
      headline: alertHeadline(a, region.tz),
      durationSec: speak ? Math.min(90, Math.max(20, speakSecs(speak))) : secs("watch"),
      ...(speak ? { speak } : {}),
    };
  };
  const warnRadar = (a: Alert): RundownItem => {
    const base = { key: key("radar:w"), kind: "radar" as const, view: "warning" as const, alertId: a.id, headline: `RADAR: ${a.event.toUpperCase()}`, durationSec: secs("radar") };
    const m = parseMotion(a.params.eventMotionDescription);
    // the track is pure NWS motion data + geometry; no LLM involved
    if (!m) return base;
    const info = trackStorm(m, TOWNS, now, a.expires);
    if (!info.towns.length) return base;
    return {
      ...base,
      headline: trackHeadline(info),
      speak: trackScript(info),
      durationSec: Math.max(base.durationSec, speakSecs(trackScript(info))),
      track: { origin: info.origin, end: info.end, bearingDeg: info.bearingDeg, towns: info.towns },
    };
  };
  const regionRadar = (s?: number): RundownItem => ({
    key: key("radar:r"), kind: "radar", view: "region", headline: `${region.name.toUpperCase()} RADAR`, durationSec: s ?? secs("radar"),
  });
  const cityItems = (count: number, s?: number): RundownItem[] => {
    const list = rotate(data.cities, bucket * 3 + cityCursor).slice(0, count);
    cityCursor += count;
    return list.map((c) => ({
      key: key(`city:${c.name}`), kind: "segment", id: "now", city: c, temp: c.temp, desc: c.desc, headline: cityHeadline(c.name, c.temp, c.desc),
      speak: citySpeak(c.name, c.temp, c.desc), durationSec: s ?? secs("segment"),
    }));
  };
  const studioItems = (count: number, s?: number): RundownItem[] => {
    const list = data.studio.filter((p) => productActive(p, now));
    return (count > 0 ? list.slice(0, count) : list).map((p) => ({
      key: key(`map:${p.id}`), kind: "map", product: p.id, headline: p.title.toUpperCase(), durationSec: s ?? secs("map"),
    }));
  };
  const outlookItem = (s?: number): RundownItem => ({
    key: key("outlook"), kind: "outlook", spc: data.spc,
    headline: notableSpc ? `SEVERE WEATHER OUTLOOK: ${SPC_PHRASE[data.spc].toUpperCase()} TODAY` : "SEVERE WEATHER OUTLOOK",
    durationSec: s ?? secs("outlook"),
  });
  const hostItem = (s?: number): RundownItem => {
    const text = data.talkBreak || talkBreak(bucket, region.name);
    return { key: key("host"), kind: "host", text, source: data.talkBreak ? "llm" : "template", headline: cfg.host.name.toUpperCase(), speak: text, durationSec: Math.max(s ?? secs("host"), speakSecs(text, 3)) };
  };
  const bulletinItem = (b: Bulletin): RundownItem => {
    const spokenTag = { info: "A SHELLY bulletin", advisory: "A SHELLY advisory", alert: "A SHELLY alert" }[b.level];
    const speak = b.speak ? `${spokenTag} from the forecaster${b.area ? ` for ${b.area}` : ""}. ${b.title}. ${b.body}` : undefined;
    return {
      key: key(`bulletin:${b.id}`), kind: "bulletin", bulletinId: b.id, headline: `${BULLETIN_TAG[b.level]}: ${b.title}`.toUpperCase(),
      durationSec: speak ? Math.min(90, Math.max(secs("bulletin"), speakSecs(speak))) : secs("bulletin"),
      ...(speak ? { speak } : {}),
    };
  };

  /** One playlist entry to zero or more items. `force` plays blocks that would otherwise skip themselves. */
  const entryItems = (e: PlaylistEntry, force = false): RundownItem[] => {
    const s = e.seconds;
    switch (e.block) {
      case "radar":
        return [regionRadar(s)];
      case "cities":
        return cityItems(e.count || 2, s);
      case "studio":
        return studioItems(e.count ?? 0, s);
      case "outlook":
        return notableSpc || level !== "CALM" || force ? [outlookItem(s)] : [];
      case "host":
        return calmish ? [hostItem(s)] : [];
      case "ident":
        return [{ key: key("ident"), kind: "block", block: "ident", headline: `YOU'RE WATCHING ${cfg.host.name.toUpperCase()} LIVE`, durationSec: s ?? secs("ident") }];
      case "message": {
        if (!e.title && !e.text) return [];
        const speak = e.speak && e.text ? `${e.title ? `${e.title}. ` : ""}${e.text}` : undefined;
        return [{
          key: key(`msg:${e.id}`), kind: "block", block: "message", headline: (e.title || "A NOTE FROM THE FORECASTER").toUpperCase(),
          ...(e.title ? { title: e.title } : {}), ...(e.text ? { text: e.text } : {}),
          durationSec: Math.max(s ?? secs("message"), speak ? speakSecs(speak) : 0), ...(speak ? { speak } : {}),
        }];
      }
      case "alertsBoard":
        return active.length || ctl.bulletins.length || force
          ? [{ key: key("board"), kind: "block", block: "alertsBoard", headline: "ACTIVE ALERTS AND BULLETINS", durationSec: s ?? secs("alertsBoard") }]
          : [];
      default: {
        const t = blockText(e.block, wx, e.city, region.name, now);
        if (!t) return [];
        return [{
          key: key(`blk:${e.block}`), kind: "block", block: e.block, ...(e.city ? { city: e.city } : {}), headline: t.headline,
          ...(t.speak ? { speak: t.speak } : {}),
          durationSec: Math.max(s ?? secs(e.block), t.speak ? speakSecs(t.speak) : 0),
        }];
      }
    }
  };

  const playlist = cfg.playlist.filter((e) => e.on);
  const held = ctl.hold && level !== "WARNING" && level !== "EMERGENCY" ? ctl.hold.entry : null;
  const content = (excludeTalk: boolean): RundownItem[] =>
    (held ? [held] : playlist)
      .filter((e) => !excludeTalk || (e.block !== "host" && e.block !== "ident"))
      .flatMap((e) => entryItems(e, !!held));
  const bulletins = level === "EMERGENCY" ? [] : ctl.bulletins;

  const items: RundownItem[] = [];

  if (level === "EMERGENCY") {
    // full takeover: only the emergency and other warnings, with their radar
    const emer = warnings.filter(isEmergency);
    const list = (emer.length ? emer : warnings).slice(0, 4);
    for (const a of list) items.push(alertItem(a), warnRadar(a));
  } else if (level === "WARNING" && top) {
    // warnings lead and repeat every three content items; the forecaster's playlist fills the gaps
    const fill = [...bulletins.map(bulletinItem), ...content(true)];
    if (!fill.some((i) => i.kind === "outlook")) fill.push(outlookItem());
    const cycle = warnings.slice(0, 3);
    items.push(alertItem(top), warnRadar(top));
    for (let i = 0; i < fill.length; i += 3) {
      items.push(...fill.slice(i, i + 3));
      const a = cycle[(i / 3 + 1) % cycle.length]!;
      items.push(alertItem(a), warnRadar(a));
    }
  } else if (level === "ELEVATED") {
    // watches and the outlook first, then the playlist with radar after every other item
    const body = content(false).filter((i) => !(i.kind === "radar" && i.view === "region") && i.kind !== "outlook");
    const lead: RundownItem[] = [...bulletins.map(bulletinItem), outlookItem(), ...watches.slice(0, 3).map(alertItem)];
    [...lead, ...body].forEach((c, i) => {
      items.push(c);
      if (i % 2 === 0) items.push(regionRadar());
    });
  } else {
    // CALM: the forecaster's playlist, bulletins every few items
    const body = content(false);
    if (bulletins.length) {
      const b = bulletins.map(bulletinItem);
      items.push(...b);
      body.forEach((c, i) => {
        items.push(c);
        if (i % 5 === 4) items.push(...bulletins.map(bulletinItem));
      });
    } else items.push(...body);
  }

  if (!items.length) items.push(regionRadar(), hostItem());

  // one-shots go to the front: what the forecaster asked for plays next
  const front: RundownItem[] = [];
  if (ctl.say) {
    const text = ctl.say.text;
    front.push({ key: key(`say:${ctl.say.id}`), oneShot: ctl.say.id, kind: "host", text, source: ctl.say.source, headline: cfg.host.name.toUpperCase(), speak: text, durationSec: Math.max(8, speakSecs(text, 3)) });
  }
  if (ctl.cue && level !== "EMERGENCY") front.push(...entryItems(ctl.cue.entry, true).map((i) => ({ ...i, oneShot: ctl.cue!.id })));
  items.unshift(...front);

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
    headlines: calmish && !held ? (data.headlines ?? []) : [],
    alerts: [...warnings, ...watches].slice(0, 10),
    items,
    wx,
    bulletins,
    cmd: ctl.cmd,
    hold: held ? BLOCK_INFO[held.block].label : null,
  };
}
