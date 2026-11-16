import { computed, effect, signal } from "@preact/signals";
import { DEFAULT_CONFIG, noteActive, type SiteConfig } from "../../shared/config";
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
