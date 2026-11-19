// Shoots the stills the video renders use, from the capture stage (video/stage/), with headless Chrome.
// Start the dev server first (npm run dev, port 5173), then: npm run video:capture
// Writes 3840x2160 PNGs to video/footage/signal/. No rundown, no voice, no TTS credits.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BASE = process.env.STAGE_URL ?? "http://localhost:5173/video/stage/";
const OUT = resolve("video/footage/signal");
const CHROME = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("No Chrome or Edge found; set CHROME to its path");
mkdirSync(OUT, { recursive: true });

// file name (no dots besides .png: Chrome rejects them) -> stage query, virtual time in ms
const SHOTS = [
  ...["100", "75", "50", "30", "15", "04"].map((l) => [`eyes_${l}`, `shot=eyes&lid=${l === "100" ? "1" : `0.${l}`}`, 2500]),
  ["storm_1", "shot=storm&scene=storm", 2700],
  ["storm_2", "shot=storm&scene=storm", 3400],
  ["storm_3", "shot=storm&scene=storm", 4100],
  ["host", "shot=host", 2500],
];

for (const [name, query, budget] of SHOTS) {
  // a fresh profile per shot: back-to-back runs on one profile fail on its lock
  const profile = join(tmpdir(), `shelly-capture-${name}`);
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    `--user-data-dir=${profile}`, "--window-size=1920,1080", "--force-device-scale-factor=2",
    `--virtual-time-budget=${budget}`, `--screenshot=${join(OUT, `${name}.png`)}`, `${BASE}?${query}`,
  ], { stdio: "ignore", timeout: 90_000 });
  rmSync(profile, { recursive: true, force: true });
  console.log(`  ${name}.png`);
}
