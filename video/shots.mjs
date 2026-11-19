// Shot list for scripts/video-record.mjs (npm run video:record). Every URL is the real app on local dev.
// type: "clip" (default, JPEG frames on the virtual clock), "still" (PNG), "page" (full-page PNG)
// testAlert: "tornado" | "severe" adds the simulator's TEST alert; studio: true serves the demo graphics.
// Locations are always Philadelphia (the recorder overrides the IP lookup).

const SCENES = ["clear-day", "partly-day", "fog", "drizzle", "rain", "storm", "sleet", "snow", "heat", "cloudy", "clear-night", "partly-night"];
// WMO code + day/night that match each forced scene, so the label agrees with the sky
const SKY = {
  "clear-day": { code: 0, isDay: true }, "partly-day": { code: 2, isDay: true }, fog: { code: 45, isDay: true },
  drizzle: { code: 53, isDay: true }, rain: { code: 63, isDay: true }, storm: { code: 95, isDay: true },
  sleet: { code: 67, isDay: true }, snow: { code: 73, isDay: true }, heat: { code: 0, isDay: true },
  cloudy: { code: 3, isDay: true }, "clear-night": { code: 0, isDay: false }, "partly-night": { code: 2, isDay: false },
};
const STUDIO = ["demo-note", "demo-impacts", "demo-odds", "demo-planner", "demo-compare", "demo-risk", "demo-snow"];
const OUTFITS = ["shades,happy", "winter,curious", "umbrella,focused", "sleepy", "worried", "none,happy,wave"];

export const SHOTS = [
  // ---- skies: the real TV layout under every scene, and the bare sky layer ----
  ...SCENES.map((sc) => ({ name: `kiosk_${sc}`, url: `/?mode=kiosk&scene=${sc}`, seconds: 3, sky: SKY[sc] })),
  ...["rain", "storm", "snow"].map((sc) => ({ name: `sky_${sc}`, url: `/video/stage/?shot=storm&scene=${sc}`, seconds: 4, dpr: 1, settle: 2500 })),

  // ---- every screen ----
  { name: "web_clear", url: "/?mode=web&scene=partly-day", w: 1440, h: 900, seconds: 3, sky: SKY["partly-day"] },
  { name: "phone_clear", url: "/?mode=phone&scene=partly-day", w: 390, h: 844, dpr: 3, mobile: true, seconds: 3, sky: SKY["partly-day"] },
  { name: "web_page", url: "/?mode=web&scene=partly-day", w: 1440, h: 900, type: "page", sky: SKY["partly-day"] },
  { name: "phone_page", url: "/?mode=phone&scene=partly-day", w: 390, h: 844, dpr: 3, mobile: true, type: "page", sky: SKY["partly-day"] },

  // ---- warnings: simulator-shaped TEST alerts only ----
  { name: "kiosk_takeover", url: "/?mode=kiosk&scene=storm", testAlert: "tornado", seconds: 5, settle: 7000 },
  { name: "web_takeover", url: "/?mode=web&scene=storm", w: 1440, h: 900, testAlert: "tornado", seconds: 3, settle: 7000 },
  { name: "web_takeover_page", url: "/?mode=web&scene=storm", w: 1440, h: 900, testAlert: "tornado", type: "page", settle: 7000 },
  { name: "phone_takeover", url: "/?mode=phone&scene=storm", w: 390, h: 844, dpr: 3, mobile: true, testAlert: "tornado", seconds: 3, settle: 7000 },

  // ---- Android download page (the app itself can only be filmed on a phone) ----
  { name: "phone_getandroid", url: "/get-android/", w: 390, h: 844, dpr: 3, mobile: true, type: "page" },

  // ---- SHELLY Live: the real broadcast, voice requests refused, demo Studio graphics in the rotation ----
  { name: "live_show", url: "/live?host=none,happy", studio: true, settle: 8000, plan: [{ rec: 5 }, { skip: 25 }, { rec: 5 }, { skip: 25 }, { rec: 5 }, { skip: 25 }, { rec: 5 }, { skip: 25 }, { rec: 5 }, { skip: 25 }, { rec: 5 }] },
  { name: "live_wave", url: "/live?host=none,happy,wave", studio: true, settle: 8000, seconds: 6 },
  ...OUTFITS.map((h) => ({ name: `host_${h.split(",")[0]}${h.includes(",") ? "_" + h.split(",")[1] : ""}`, url: `/video/stage/?shot=host&host=${h}`, dpr: 2, type: "still", settle: 2500 })),
  { name: "host_swim", url: "/video/stage/?shot=host&host=happy", dpr: 1, seconds: 4, settle: 2500 },

  // ---- Forecaster Studio: each demo graphic at full size ----
  ...STUDIO.map((id) => ({ name: `studio_${id.slice(5)}`, url: `/video/stage/?shot=studio&id=${id}`, type: "still", settle: 3000 })),
];
