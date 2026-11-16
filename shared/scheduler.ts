import { heatIndex, windChill } from "./wx";
import type { AirQuality, Forecast, Outlook, ThreatLevel } from "./types";

export type SegmentId = "now" | "hourly" | "daily" | "radar" | "outlook" | "air" | "almanac" | "text";

export interface SegmentCtx {
  forecast: Forecast | null;
  aq: AirQuality | null;
  outlook: Outlook | null;
  level: ThreatLevel;
}

interface SegmentDef {
  id: SegmentId;
  title: string;
  seconds: number;
  relevance: (c: SegmentCtx) => number; // 0..1
}

export const SEGMENTS: SegmentDef[] = [
  { id: "now", title: "Right now", seconds: 12, relevance: () => 1 },
  {
    id: "radar",
    title: "Radar",
    seconds: 14,
    relevance: (c) => {
      const f = c.forecast;
      if (!f) return 0.5;
      const wet = f.nowcast.some((n) => n.precip > 0.1) || f.current.precip > 0;
      return wet ? 1 : 0.45;
    },
  },
  { id: "hourly", title: "Next 24 hours", seconds: 14, relevance: () => 0.9 },
  { id: "daily", title: "Extended forecast", seconds: 14, relevance: () => 0.85 },
  {
    id: "text",
    title: "Forecaster discussion",
    seconds: 14,
    relevance: (c) => ((c.forecast?.text.length ?? 0) > 0 ? 0.6 : 0),
  },
  {
    id: "outlook",
    title: "Storm outlook",
    seconds: 10,
    relevance: (c) => {
      const cat = c.outlook?.days[0]?.category ?? "NONE";
      return cat === "NONE" || cat === "TSTM" ? 0.15 : 0.9;
    },
  },
  {
    id: "air",
    title: "Air & pollen",
    seconds: 10,
    relevance: (c) => {
      const a = c.aq;
      if (!a) return 0;
      const pollenHigh = a.pollen.some((p) => p.value > 50);
      if (pollenHigh || (a.aqi ?? 0) > 100) return 0.9;
      return (a.aqi ?? 0) > 50 ? 0.5 : 0.25;
    },
  },
  {
    id: "almanac",
    title: "Sun & moon",
    seconds: 10,
    relevance: (c) => {
      const cur = c.forecast?.current;
      if (cur && (heatIndex(cur.temp, cur.humidity) ?? 0) > 100) return 0.7;
      if (cur && windChill(cur.temp, cur.windSpeed) !== null) return 0.7;
      return 0.4;
    },
  },
];

export interface LoopItem {
  id: SegmentId;
  title: string;
  seconds: number;
}

/** Build the loop of segments from threat level and per-segment relevance. */
export function buildLoop(ctx: SegmentCtx): LoopItem[] {
  const threshold = { CALM: 0.2, ELEVATED: 0.45, WARNING: 0.9, EMERGENCY: 0.9 }[ctx.level];
  const scale = { CALM: 1, ELEVATED: 0.7, WARNING: 0.6, EMERGENCY: 0.6 }[ctx.level];

  let items = SEGMENTS.filter((s) => s.relevance(ctx) >= threshold).map((s) => ({
    id: s.id,
    title: s.title,
    seconds: Math.max(5, Math.round(s.seconds * scale)),
  }));

  if (ctx.level !== "CALM") {
    const radar = SEGMENTS.find((s) => s.id === "radar")!;
    if (!items.some((i) => i.id === "outlook") && ctx.outlook) {
      const o = SEGMENTS.find((s) => s.id === "outlook")!;
      items.push({ id: o.id, title: o.title, seconds: Math.round(o.seconds * scale) });
    }
    // radar every other segment while elevated
    const withRadar: LoopItem[] = [];
    items.filter((i) => i.id !== "radar").forEach((i, n) => {
      withRadar.push(i);
      if (n % 2 === 0) withRadar.push({ id: radar.id, title: radar.title, seconds: Math.round(radar.seconds * scale) });
    });
    items = withRadar;
  }

  if (items.length === 0) items = [{ id: "now", title: "Right now", seconds: 12 }];
  return items;
}
