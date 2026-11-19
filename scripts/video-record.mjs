// Records real SHELLY UI for the launch videos with headless Chrome over the DevTools protocol.
// Start the dev server first (npm run dev), then:  npm run video:record [-- shotName ...]
//
// Shots are listed in video/shots.mjs. Each is a still (PNG), a full-page still, or a clip of JPEG
// frames, stepped on Chrome's virtual clock so animations come out smooth at any frame rate.
//
// Safety, inside this one headless browser only (nothing is stored, sent or pushed anywhere):
// - "where am I" always answers Philadelphia, never the real IP location
// - every voice request (/api/tts, /api/live/tts) is refused, so no TTS credits are spent
// - shots marked testAlert get a simulator-shaped TEST alert (same labels as shared/simulate.ts)
// - shots marked studio get the demo Studio graphics from video/stage/fixtures.json
// - shots with sky: {code, isDay} relabel the current conditions to match the forced ?scene= sky
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SHOTS } from "../video/shots.mjs";

const BASE = process.env.APP_URL ?? "http://localhost:5173";
export const FOOTAGE = process.env.SHELLY_FOOTAGE ?? join(process.env.LOCALAPPDATA ?? tmpdir(), "shelly-video", "footage");
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && existsSync(p));
const PHILLY = "/api/location?q=Philadelphia%2C%20PA";
const STUDIO = JSON.parse(readFileSync(resolve("video/stage/fixtures.json"), "utf8"));
/** The demo Studio graphics, made current (they're only shown while valid). */
const studioNow = () => {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  return STUDIO.products.map((p) => ({
    ...p, validFrom: iso(now - 3600e3), validTo: iso(now + 3 * 86400e3), updated: iso(now),
    body: p.kind === "dayPlanner" ? { ...p.body, date: iso(now + 86400e3).slice(0, 10) } : p.body,
  }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The same TEST alert the admin simulator builds (shared/simulate.ts buildSimAlert), around the viewer. */
function testAlert(url, preset) {
  const u = new URL(url, BASE);
  const lat = Number(u.searchParams.get("lat"));
  const lon = Number(u.searchParams.get("lon"));
  const zones = (u.searchParams.get("zones") ?? "").split(",").filter(Boolean);
  const P = {
    tornado: ["Tornado Warning", "Extreme", "A severe thunderstorm capable of producing a tornado was located nearby, moving northeast.", "Move to an interior room on the lowest floor of a sturdy building. Avoid windows.", { tornadoDetection: "RADAR INDICATED" }],
    severe: ["Severe Thunderstorm Warning", "Severe", "60 mph wind gusts and quarter size hail are expected with this storm.", "Move indoors and stay away from windows.", { maxWindGust: "60 MPH", maxHailSize: "1.00" }],
  }[preset ?? "tornado"];
  const now = Date.now();
  const d = 0.12;
  return {
    id: `sim-video-${preset}`,
    event: P[0], severity: P[1], urgency: "Immediate", certainty: "Observed",
    headline: `TEST: ${P[0]}`,
    description: `THIS IS A TEST. ${P[2]}`,
    instruction: `THIS IS A TEST. ${P[3]}`,
    sent: new Date(now - 4 * 60e3).toISOString(),
    onset: new Date(now - 4 * 60e3).toISOString(),
    expires: new Date(now + 41 * 60e3).toISOString(),
    areaDesc: "Your area (test)",
    zones,
    geometry: { type: "Polygon", coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] },
    params: P[4],
  };
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.handlers = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.wait.has(m.id)) {
        const { res, rej } = this.wait.get(m.id);
        this.wait.delete(m.id);
        m.error ? rej(new Error(`${m.error.message}`)) : res(m.result);
      } else if (m.method) for (const h of this.handlers) h(m);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.wait.set(id, { res, rej }));
  }
  on(fn) { this.handlers.push(fn); }
  once(method, sessionId) {
    return new Promise((res) => {
      const h = (m) => { if (m.method === method && m.sessionId === sessionId) { this.handlers.splice(this.handlers.indexOf(h), 1); res(m.params); } };
      this.handlers.push(h);
    });
  }
}

async function launch() {
  const profile = join(tmpdir(), `shelly-rec-${process.pid}`);
  const port = 9300 + (process.pid % 500);
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
  let ver;
  for (let i = 0; i < 80 && !ver; i++) {
    await sleep(250);
    ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
  }
  if (!ver) throw new Error("Chrome didn't start");
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return { cdp: new CDP(ws), close: () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1500); } };
}

async function record(cdp, shot) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const w = shot.w ?? 1920, h = shot.h ?? 1080, dpr = shot.dpr ?? 1;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: !!shot.mobile }, s);
  if (shot.mobile) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, s);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] }, s);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `${BASE}/api/*` }] }, s);
  cdp.on(async (m) => {
    if (m.method !== "Fetch.requestPaused" || m.sessionId !== s) return;
    const { requestId, request } = m.params;
    const url = request.url;
    const path = new URL(url).pathname;
    const reply = (body, code = 200) => cdp.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }, s).catch(() => {});
    try {
      if (path === "/api/tts" || path.startsWith("/api/live/tts")) return reply({ error: "disabled_for_recording" }, 503);
      if (path === "/api/location" && new URL(url).searchParams.get("ip")) return cdp.send("Fetch.continueRequest", { requestId, url: BASE + PHILLY }, s).catch(() => {});
      if (path === "/api/alerts" && shot.testAlert) {
        const real = await fetch(url).then((r) => r.json());
        return reply({ ...real, alerts: [testAlert(url, shot.testAlert), ...real.alerts] });
      }
      if (path === "/api/forecast" && shot.sky) {
        // label the current conditions to match the forced ?scene= sky (temperatures stay real)
        const real = await fetch(url).then((r) => r.json());
        return reply({ ...real, current: { ...real.current, ...shot.sky } });
      }
      if (path === "/api/studio" && shot.studio) return reply(studioNow());
      if (path === "/api/config" && shot.config) {
        const real = await fetch(url).then((r) => r.json());
        return reply(shot.config(real));
      }
    } catch (e) { console.warn("  intercept failed", path, e.message); }
    cdp.send("Fetch.continueRequest", { requestId }, s).catch(() => {});
  });
  await cdp.send("Page.enable", {}, s);
  await cdp.send("Runtime.enable", {}, s);
  const loaded = cdp.once("Page.loadEventFired", s);
  await cdp.send("Page.navigate", { url: BASE + shot.url }, s);
  await loaded;
  await sleep(shot.settle ?? 5000); // real time for data to arrive
  if (shot.js) await cdp.send("Runtime.evaluate", { expression: shot.js, awaitPromise: true }, s);
  if (shot.jsWait) await sleep(shot.jsWait);

  const dir = join(FOOTAGE, shot.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (shot.type === "still" || shot.type === "page") {
    const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: shot.type === "page" }, s);
    writeFileSync(join(dir, "still.png"), Buffer.from(r.data, "base64"));
    console.log(`  ${shot.name}: still`);
  } else {
    const fps = shot.fps ?? 30;
    let n = 0;
    const step = async (ms) => {
      const done = cdp.once("Emulation.virtualTimeBudgetExpired", s);
      await cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance", budget: ms }, s);
      await done;
    };
    for (const part of shot.plan ?? [{ rec: shot.seconds ?? 4 }]) {
      if (part.js) await cdp.send("Runtime.evaluate", { expression: part.js, awaitPromise: false }, s);
      if (part.skip) for (let left = part.skip * 1000; left > 0; left -= 1000) await step(Math.min(1000, left));
      for (let i = 0; i < Math.round((part.rec ?? 0) * fps); i++) {
        await step(1000 / fps);
        const r = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92 }, s);
        writeFileSync(join(dir, `${String(++n).padStart(4, "0")}.jpg`), Buffer.from(r.data, "base64"));
      }
    }
    writeFileSync(join(dir, "clip.json"), JSON.stringify({ fps, frames: n, w: w * dpr, h: h * dpr }));
    console.log(`  ${shot.name}: ${n} frames`);
  }
  await cdp.send("Target.closeTarget", { targetId });
}

const want = new Set(process.argv.slice(2));
const list = SHOTS.filter((x) => !want.size || want.has(x.name) || [...want].some((w) => w.endsWith("*") && x.name.startsWith(w.slice(0, -1))));
console.log(`Recording ${list.length} shots to ${FOOTAGE}`);
const { cdp, close } = await launch();
try {
  for (const shot of list) {
    try { await record(cdp, shot); } catch (e) { console.error(`  ${shot.name}: FAILED ${e.message}`); }
  }
} finally { close(); }
