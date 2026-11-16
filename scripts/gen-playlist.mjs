// Regenerates public/music/playlist.json from the files in public/music.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "public", "music");
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mp3")).sort((a, b) => a.localeCompare(b));
const tracks = files.map((file) => ({ title: file.replace(/\.mp3$/i, "").replace(/_/g, "/"), file }));
writeFileSync(
  join(dir, "playlist.json"),
  JSON.stringify({ name: "SHELLY background music", tracks }, null, 2) + "\n",
);
console.log(`playlist.json: ${tracks.length} tracks`);
