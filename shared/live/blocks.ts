// SHELLY Live blocks: everything the forecaster can put in the rotation, the playlist that orders
// them, and the on-air control state (play next, hold, say, skip, bulletins).
// Nothing here is LLM text: block wording comes from templates; "say" and bulletins are typed by
// the forecaster in the admin.

export const BLOCK_IDS = [
  "radar", "cities", "tempsNow", "feelsNow", "highs", "lows", "tomorrow", "sevenDay", "hourly", "rainChance",
  "wind", "humidity", "extremes", "sun", "weekend", "outlook", "alertsBoard", "studio", "host", "ident", "message",
] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

export interface BlockInfo {
  label: string;
  hint: string;
  seconds: number;
  /** needs the regional weather data (skipped if it hasn't loaded) */
  wx?: boolean;
  /** has a city picker */
  city?: boolean;
  /** has a count */
  count?: boolean;
}

export const BLOCK_INFO: Record<BlockId, BlockInfo> = {
  radar: { label: "Regional radar", hint: "Animated radar over the whole region.", seconds: 20 },
  cities: { label: "City conditions", hint: "Big temperature cards, rotating through your cities.", seconds: 12, wx: true, count: true },
  tempsNow: { label: "Temperatures now map", hint: "Every city's current temperature on the map.", seconds: 14, wx: true },
  feelsNow: { label: "Feels-like map", hint: "Wind chill or heat index across the region.", seconds: 14, wx: true },
  highs: { label: "Today's highs map", hint: "Forecast highs for today.", seconds: 14, wx: true },
  lows: { label: "Tonight's lows map", hint: "Forecast lows for tonight.", seconds: 14, wx: true },
  tomorrow: { label: "Tomorrow's highs map", hint: "Forecast highs for tomorrow.", seconds: 14, wx: true },
  sevenDay: { label: "7-day forecast", hint: "Seven days for one city (model data).", seconds: 16, wx: true, city: true },
  hourly: { label: "Next 12 hours", hint: "Hour by hour temperature and rain chance for one city.", seconds: 15, wx: true, city: true },
  rainChance: { label: "Rain chances map", hint: "Today's chance of rain or snow in each city.", seconds: 13, wx: true },
  wind: { label: "Wind map", hint: "Wind speed, gusts and direction in each city.", seconds: 13, wx: true },
  humidity: { label: "Dew point map", hint: "How muggy or dry it feels, by dew point.", seconds: 13, wx: true },
  extremes: { label: "Warmest and coolest", hint: "A leaderboard of the warmest and coolest spots right now.", seconds: 13, wx: true },
  sun: { label: "Sun, moon and UV", hint: "Sunrise, sunset, day length, moon phase and UV.", seconds: 13, wx: true, city: true },
  weekend: { label: "Weekend outlook", hint: "Saturday and Sunday for one city.", seconds: 13, wx: true, city: true },
  outlook: { label: "Severe weather outlook", hint: "Today's SPC risk. Skipped on quiet days unless the region is elevated.", seconds: 12 },
  alertsBoard: { label: "Alerts board", hint: "Every active alert and your bulletins in one list. Skipped when there are none.", seconds: 14 },
  studio: { label: "Forecaster Studio graphics", hint: "Your published graphics. Count 0 shows all of them.", seconds: 16, count: true },
  host: { label: "Host talk break", hint: "A short line from the host (AI if it's on, otherwise built-in wording).", seconds: 14 },
  ident: { label: "Station ID", hint: "\"You're watching SHELLY\" with the mascot front and centre.", seconds: 8 },
  message: { label: "Your message", hint: "A slide with your own title and text. Optional: the host reads it.", seconds: 14 },
};

export interface PlaylistEntry {
  id: string;
  block: BlockId;
  on: boolean;
  seconds?: number;
  count?: number;
  /** city name for one-city blocks; blank = first city */
  city?: string;
  /** message block */
  title?: string;
  text?: string;
  /** message block: host reads the text */
  speak?: boolean;
}

const e = (id: string, block: BlockId, extra: Partial<PlaylistEntry> = {}): PlaylistEntry => ({ id, block, on: true, ...extra });

export const DEFAULT_PLAYLIST: PlaylistEntry[] = [
  e("p1", "radar"),
  e("p2", "cities", { count: 2 }),
  e("p3", "tempsNow"),
  e("p4", "studio", { count: 0 }),
  e("p5", "sevenDay"),
  e("p6", "outlook"),
  e("p7", "hourly"),
  e("p8", "cities", { count: 3 }),
  e("p9", "highs"),
  e("p10", "rainChance"),
  e("p11", "wind"),
  e("p12", "extremes"),
  e("p13", "sun"),
  e("p14", "host"),
  e("p15", "ident"),
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? undefined : Math.round(Math.min(hi, Math.max(lo, n)));
};

export function normalizeEntry(raw: unknown, i = 0): PlaylistEntry | null {
  if (!isObj(raw) || !(BLOCK_IDS as readonly unknown[]).includes(raw.block)) return null;
  const out: PlaylistEntry = { id: str(raw.id, 40) || `e${i}`, block: raw.block as BlockId, on: raw.on !== false };
  const seconds = int(raw.seconds, 5, 180);
  const count = int(raw.count, 0, 50);
  if (seconds !== undefined) out.seconds = seconds;
  if (count !== undefined) out.count = count;
  if (str(raw.city, 60)) out.city = str(raw.city, 60);
  if (str(raw.title, 80)) out.title = str(raw.title, 80);
  if (str(raw.text, 400)) out.text = str(raw.text, 400);
  if (raw.speak === true) out.speak = true;
  return out;
}

export function normalizePlaylist(raw: unknown): PlaylistEntry[] {
  if (!Array.isArray(raw)) return DEFAULT_PLAYLIST;
  const seen = new Set<string>();
  const out: PlaylistEntry[] = [];
  raw.slice(0, 60).forEach((r, i) => {
    const x = normalizeEntry(r, i);
    if (!x) return;
    if (seen.has(x.id)) x.id = `${x.id}-${i}`;
    seen.add(x.id);
    out.push(x);
  });
  return out;
}

// ── forecaster bulletins (your own alerts; never an NWS product) ──
export const BULLETIN_LEVELS = ["info", "advisory", "alert"] as const;
export type BulletinLevel = (typeof BULLETIN_LEVELS)[number];
export interface Bulletin {
  id: string;
  level: BulletinLevel;
  title: string;
  area: string;
  body: string;
  until: string;
  /** the host reads it aloud */
  speak: boolean;
  issued: string;
}

export function normalizeBulletin(raw: unknown, now = Date.now()): Bulletin | null {
  if (!isObj(raw)) return null;
  const title = str(raw.title, 80);
  const body = str(raw.body, 600);
  if (!title || !body) return null;
  const until = typeof raw.until === "string" && Number.isFinite(Date.parse(raw.until)) ? new Date(raw.until).toISOString() : new Date(now + 3 * 3600_000).toISOString();
  return {
    id: str(raw.id, 40) || `b${now.toString(36)}`,
    level: (BULLETIN_LEVELS as readonly unknown[]).includes(raw.level) ? (raw.level as BulletinLevel) : "info",
    title,
    area: str(raw.area, 120),
    body,
    until,
    speak: raw.speak !== false,
    issued: typeof raw.issued === "string" && Number.isFinite(Date.parse(raw.issued)) ? raw.issued : new Date(now).toISOString(),
  };
}

// ── on-air control ──
export interface LiveControl {
  /** play only this block until `until` (calm and elevated only; alerts always break through) */
  hold: { entry: PlaylistEntry; until: string } | null;
  /** play this block next, once */
  cue: { id: string; entry: PlaylistEntry; at: string } | null;
  /** the host says these words next (typed or approved by the forecaster) */
  say: { id: string; text: string; at: string; source: "you" | "ai" } | null;
  /** last jump command the page should obey */
  cmd: { id: string; kind: "top" | "skip" } | null;
  bulletins: Bulletin[];
}

export const EMPTY_CONTROL: LiveControl = { hold: null, cue: null, say: null, cmd: null, bulletins: [] };

/** cue and say live this long in the rundown; long enough to be picked up, short enough not to repeat */
export const ONE_SHOT_MS = 2 * 60_000;

/** Drop expired holds, one-shots and bulletins. */
export function activeControl(c: LiveControl | null, now: number): LiveControl {
  const x = c ?? EMPTY_CONTROL;
  return {
    hold: x.hold && Date.parse(x.hold.until) > now ? x.hold : null,
    cue: x.cue && Date.parse(x.cue.at) + ONE_SHOT_MS > now ? x.cue : null,
    say: x.say && Date.parse(x.say.at) + ONE_SHOT_MS > now ? x.say : null,
    cmd: x.cmd,
    bulletins: (x.bulletins ?? []).filter((b) => Date.parse(b.until) > now),
  };
}

// ── regional weather (one Open-Meteo multi-location request) ──
export interface CityNowFull {
  temp: number;
  feels: number;
  rh: number;
  dew: number;
  wind: number;
  gust: number;
  dir: number;
  code: number;
  isDay: boolean;
}
export interface CityDay {
  date: string;
  hi: number;
  lo: number;
  pop: number;
  code: number;
}
export interface CityHour {
  time: string;
  temp: number;
  pop: number;
  code: number;
}
export interface CityFull {
  name: string;
  state: string;
  lat: number;
  lon: number;
  now: CityNowFull;
  daily: CityDay[];
  hourly: CityHour[];
  sunrise: string;
  sunset: string;
  uv: number;
}
export interface RegionWx {
  at: string;
  cities: CityFull[];
}
