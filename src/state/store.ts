import { computed, effect, signal } from "@preact/signals";
import { actionFor, urgencyRank } from "../../shared/actions";
import type { Confidence } from "../../shared/confidence";
import { DEFAULT_CONFIG, noteActive, type SiteConfig } from "../../shared/config";
import { etaToPoint, nearbyWarnings } from "../../shared/eta";
import type { GradedDay, GradeSummary } from "../../shared/grade";
import { hazardScore, snowDayOdds, type Hazards } from "../../shared/hazards";
import { alertHealth } from "../../shared/health";
import { localHour, localNow, rainNowcast } from "../../shared/nowcast";
import type { StormReport } from "../../shared/reports";
import { whatToWear } from "../../shared/wear";
import { snowDayRelevance, type SnowDayResponse } from "../../shared/snowday";
import { buildLoop } from "../../shared/scheduler";
import type { StudioProduct } from "../../shared/studio";
import { computeThreat } from "../../shared/threat";
import type { AirQuality, Alert, Announcement, Forecast, Outlook, Place, RadarFrames } from "../../shared/types";
import { api } from "../api";
import { configureMusic } from "../music";
import { detectMode, type Mode } from "../mode";
import { applyDefaultTheme } from "../theme";

// ── persistence (last-good cache so the display survives a network blip) ──
const LS = "shelly.v2.";
function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LS + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: ignore */
  }
}

export const place = signal<Place | null>(load<Place>("place"));
export const forecast = signal<Forecast | null>(load<Forecast>("forecast"));
export const alerts = signal<Alert[]>([]);
export const alertsUpdated = signal<string | null>(null);
export const outlook = signal<Outlook | null>(load<Outlook>("outlook"));
export const air = signal<AirQuality | null>(load<AirQuality>("air"));
export const radar = signal<RadarFrames | null>(null);
export const announcements = signal<Announcement[]>([]);
export const studioProducts = signal<StudioProduct[]>([]);
export const confidence = signal<Confidence | null>(load<Confidence>("confidence"));
export const reports = signal<{ fetchedAt: string; reports: (StormReport & { distanceMi: number })[] } | null>(null);
export const hazards = signal<Hazards | null>(load<Hazards>("hazards"));
export const snowOdds = signal<SnowDayResponse | null>(load<SnowDayResponse>("snowday"));
export const grade = signal<(GradeSummary & { history: GradedDay[] }) | null>(null);
/** when this screen last got an answer from /api/alerts (ms epoch) */
export const alertsOkAt = signal<number | null>(null);
export const online = signal(true);
export const lastError = signal<string | null>(null);

export const config = signal<SiteConfig>(load<SiteConfig>("config") ?? DEFAULT_CONFIG);
export const mode = signal<Mode>(detectMode());
export const paused = signal(false);
export const segIndex = signal(0);
/** There is no Start screen any more; kept so audio/speech can still be gated in tests. */
export const started = signal(true);
let ipTried = false;
export const now = signal(Date.now());

export const threat = computed(() => {
  const p = place.value;
  if (!p) return computeThreat({ alerts: [], point: { lat: 0, lon: 0, zones: [] } });
  const f = forecast.value;
  const cape = f ? Math.max(0, ...f.hourly.slice(0, 6).map((h) => h.cape)) : 0;
  return computeThreat({
    alerts: alerts.value,
    point: { lat: p.lat, lon: p.lon, zones: [p.forecastZone, p.countyZone, p.fireZone].filter((z): z is string => !!z) },
    outlook: outlook.value,
    nowcast: f?.nowcast,
    cape,
    now: new Date(now.value),
  });
});

/** Separate computed so the per-second clock doesn't rebuild the loop: it only changes when the note flips. */
export const noteOn = computed(() => noteActive(config.value, now.value));

// -- derived: safety, nowcast and comfort --
const tzNow = () => place.value?.tz ?? "America/New_York";
/** minute-resolution clock, so per-second ticks don't recompute everything */
const minute = computed(() => Math.floor(now.value / 60_000));

export const health = computed(() => alertHealth(alertsUpdated.value, alertsOkAt.value, now.value));

/** "What do I do right now" cards for the alerts covering the user, most urgent first. */
export const actionCards = computed(() => {
  void minute.value;
  const hr = localHour(tzNow());
  return threat.value.active
    .flatMap((a) => {
      const card = actionFor(a, hr, config.value.safety);
      return card ? [{ alert: a, card }] : [];
    })
    .sort((a, b) => urgencyRank(b.card.urgency) - urgencyRank(a.card.urgency));
});

/** Storm arrival at the user's location for the primary warning, when NWS gives storm motion. */
export const primaryEta = computed(() => {
  void minute.value;
  const p = place.value;
  const a = threat.value.primary;
  return p && a ? etaToPoint(a, p.lat, p.lon, Date.now()) : null;
});

/** Warnings close by that do NOT cover the user. */
export const nearby = computed(() => {
  void minute.value;
  const p = place.value;
  return p ? nearbyWarnings(alerts.value, p.lat, p.lon, Date.now()) : [];
});

export const rain = computed(() => {
  void minute.value;
  const f = forecast.value;
  return f ? rainNowcast(f.nowcast, localNow(tzNow()), f.hourly) : null;
});

export const wear = computed(() => {
  void minute.value;
  const f = forecast.value;
  if (!f || !config.value.wear || threat.value.rank >= 2) return null;
  return whatToWear(f, localNow(tzNow()));
});

export const snowDay = computed(() => {
  void minute.value;
  const f = forecast.value;
  return f ? snowDayOdds(f, threat.value.active, localNow(tzNow())) : null;
});

export const reportsNearby = computed(() => {
  const r = reports.value;
  if (!r) return [];
  const since = now.value - 12 * 3_600_000;
  return r.reports.filter((x) => x.distanceMi <= 100 && Date.parse(x.time) >= since);
});

/** The grades are for the site's default location; only show them there. */
export const gradeHere = computed(() => {
  const g = grade.value;
  const home = config.value.defaultLocation;
  const p = place.value;
  if (!g?.latest || !home || !p) return null;
  return Math.abs(home.lat - p.lat) < 0.05 && Math.abs(home.lon - p.lon) < 0.05 ? g : null;
});

/** 0..1 for the snow day segment: Nov 1 to Apr 15 only */
export const snowdayRelevance = computed(() => {
  void minute.value;
  return snowDayRelevance(snowOdds.value?.odds ?? null, localNow(tzNow()));
});

export const loop = computed(() =>
  buildLoop({
    forecast: forecast.value,
    aq: air.value,
    outlook: outlook.value,
    level: threat.value.level,
    note: noteOn.value,
    studio: studioProducts.value.length > 0,
    hidden: config.value.hiddenSegments,
    seconds: config.value.segmentSeconds,
    reportsNearby: reportsNearby.value.length,
    hazards: hazardScore(hazards.value, snowDay.value),
    graded: gradeHere.value !== null,
    snowday: snowdayRelevance.value,
  }),
);

export const currentSegment = computed(() => {
  const l = loop.value;
  return l[segIndex.value % l.length]!;
});

// ── loaders ──
async function guarded<T>(fn: () => Promise<T>, apply: (v: T) => void): Promise<void> {
  try {
    apply(await fn());
    online.value = true;
    lastError.value = null;
  } catch (e) {
    online.value = false;
    lastError.value = String(e);
  }
}

export async function setPlace(p: Place): Promise<void> {
  place.value = p;
  save("place", p);
  forecast.value = null;
  outlook.value = null;
  air.value = null;
  confidence.value = null;
  reports.value = null;
  hazards.value = null;
  snowOdds.value = null;
  await refreshAll();
}

export async function locateByCoords(lat: number, lon: number): Promise<void> {
  await setPlace(await api.locate(lat, lon));
}

export async function locateByQuery(query: string): Promise<void> {
  await setPlace(await api.search(query));
}

export const refresh = {
  studio: () =>
    guarded(
      () => api.studio(),
      (list) => {
        studioProducts.value = list;
      },
    ),
  alerts: () => {
    const p = place.value;
    return p
      ? guarded(
          () => api.alerts(p),
          (r) => {
            alerts.value = r.alerts;
            alertsUpdated.value = r.updated;
            alertsOkAt.value = Date.now();
          },
        )
      : Promise.resolve();
  },
  forecast: () => {
    const p = place.value;
    return p
      ? guarded(
          () => api.forecast(p),
          (f) => {
            forecast.value = f;
            save("forecast", f);
          },
        )
      : Promise.resolve();
  },
  outlook: () => {
    const p = place.value;
    return p
      ? guarded(
          () => api.outlook(p),
          (o) => {
            outlook.value = o;
            save("outlook", o);
          },
        )
      : Promise.resolve();
  },
  air: () => {
    const p = place.value;
    return p
      ? guarded(
          () => api.air(p),
          (a) => {
            air.value = a;
            save("air", a);
          },
        )
      : Promise.resolve();
  },
  radar: () =>
    guarded(
      () => api.radar(),
      (r) => {
        radar.value = r;
      },
    ),
  config: () =>
    guarded(
      () => api.config(),
      (c) => {
        config.value = c;
        save("config", c);
        applyDefaultTheme(c.defaultTheme);
        configureMusic(c.music);
        if (c.defaultMode !== "auto" && !new URLSearchParams(location.search).get("mode")) mode.value = c.defaultMode;
        if (!place.peek()) {
          if (c.defaultLocation) void setPlace(c.defaultLocation);
          else if (!ipTried) {
            ipTried = true;
            void api.whereami().then(setPlace).catch(() => undefined); // non-US/unknown: the picker stays up
          }
        }
      },
    ),
  announcements: () =>
    guarded(
      () => api.announcements(),
      (a) => {
        announcements.value = a;
      },
    ),
  confidence: () => {
    const p = place.value;
    return p
      ? guarded(
          () => api.confidence(p),
          (c) => {
            confidence.value = c;
            save("confidence", c);
          },
        )
      : Promise.resolve();
  },
  reports: () => {
    const p = place.value;
    return p
      ? guarded(
          () => api.reports(p),
          (r) => {
            reports.value = r;
          },
        )
      : Promise.resolve();
  },
  hazards: () => {
    const p = place.value;
    return p
      ? guarded(
          () => api.hazards(p),
          (h) => {
            hazards.value = h;
            save("hazards", h);
          },
        )
      : Promise.resolve();
  },
  snowday: () => {
    const p = place.value;
    return p
      ? guarded(
          () => api.snowday(p),
          (r) => {
            snowOdds.value = r;
            save("snowday", r);
          },
        )
      : Promise.resolve();
  },
  grade: () =>
    guarded(
      () => api.grade(),
      (g) => {
        grade.value = g;
      },
    ),
};

export async function refreshAll(): Promise<void> {
  await Promise.all(Object.values(refresh).map((f) => f()));
}

let pollersStarted = false;
export function startPollers(): void {
  if (pollersStarted) return;
  pollersStarted = true;
  void refreshAll();
  const every = (ms: number, fn: () => unknown) => setInterval(() => void fn(), ms);
  every(30_000, refresh.alerts); // alert latency target ≤ ~90 s
  every(5 * 60_000, refresh.forecast);
  every(30 * 60_000, refresh.outlook);
  every(30 * 60_000, refresh.air);
  every(2 * 60_000, refresh.radar);
  every(60_000, refresh.announcements);
  every(60_000, refresh.studio);
  every(60_000, refresh.config);
  every(60 * 60_000, refresh.confidence);
  every(3 * 60_000, refresh.reports);
  every(15 * 60_000, refresh.hazards);
  every(15 * 60_000, refresh.snowday);
  every(30 * 60_000, refresh.grade);
  every(1_000, () => {
    now.value = Date.now();
  });
  // coming back online or waking a sleeping tab: refresh immediately
  addEventListener("online", () => void refreshAll());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshAll();
  });
}

// ── segment cycling ──
export function startCycling(): void {
  let elapsed = 0;
  let lastId = "";
  setInterval(() => {
    const seg = currentSegment.value;
    if (seg.id !== lastId) {
      lastId = seg.id;
      elapsed = 0;
    }
    if (paused.value || mode.value === "phone") return;
    elapsed += 1;
    if (elapsed >= seg.seconds) {
      elapsed = 0;
      segIndex.value = (segIndex.value + 1) % loop.value.length;
    }
  }, 1000);
}

export function goTo(delta: number): void {
  const n = loop.value.length;
  segIndex.value = (segIndex.value + delta + n) % n;
}

// keep the index valid when the loop shrinks (e.g. threat drops back to CALM)
effect(() => {
  const n = loop.value.length;
  if (segIndex.peek() >= n) segIndex.value = 0;
});
