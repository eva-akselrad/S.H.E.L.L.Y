// SPC preliminary local storm reports (tornado / wind / hail), from the official NOAA CSV feeds:
// https://www.spc.noaa.gov/climo/reports/today.csv and yesterday.csv
// Each file holds three sections, each with its own header line:
//   Time,F_Scale,Location,County,State,Lat,Lon,Comments   (tornado)
//   Time,Speed,Location,County,State,Lat,Lon,Comments     (wind, mph or "UNK")
//   Time,Size,Location,County,State,Lat,Lon,Comments      (hail, hundredths of an inch)
// Time is HHMM UTC inside the SPC "convective day", which runs 12Z to 12Z.
import { haversineMi } from "./geo";

export interface StormReport {
  kind: "tornado" | "wind" | "hail";
  /** ISO time */
  time: string;
  /** "EF1", "65 mph", "1.75 in" or "" */
  magnitude: string;
  location: string;
  county: string;
  state: string;
  lat: number;
  lon: number;
  comments: string;
}

/**
 * @param dayStart the 12Z instant that starts this file's convective day (ms epoch)
 */
export function parseSpcReports(csv: string, dayStart: number): StormReport[] {
  const out: StormReport[] = [];
  let kind: StormReport["kind"] | null = null;
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("Time,")) {
      kind = line.includes("F_Scale") ? "tornado" : line.includes("Speed") ? "wind" : line.includes("Size") ? "hail" : null;
      continue;
    }
    if (!kind) continue;
    const f = line.split(",");
    if (f.length < 7) continue;
    const [hhmm, mag, location, county, state, latS, lonS] = f;
    const comments = f.slice(7).join(",").trim();
    if (!/^\d{3,4}$/.test(hhmm!)) continue;
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const hh = Number(hhmm!.padStart(4, "0").slice(0, 2));
    const mm = Number(hhmm!.padStart(4, "0").slice(2));
    // 1200..2359 is the first calendar day of the convective day, 0000..1159 the next
    const offsetMin = (hh >= 12 ? hh - 12 : hh + 12) * 60 + mm;
    out.push({
      kind,
      time: new Date(dayStart + offsetMin * 60_000).toISOString(),
      magnitude: magnitude(kind, (mag ?? "").trim()),
      location: (location ?? "").trim().slice(0, 60),
      county: (county ?? "").trim().slice(0, 40),
      state: (state ?? "").trim().slice(0, 2),
      lat,
      lon: lon > 0 ? -lon : lon,
      comments: comments.slice(0, 300),
    });
  }
  return out;
}

function magnitude(kind: StormReport["kind"], v: string): string {
  if (!v || v.toUpperCase() === "UNK") return "";
  if (kind === "tornado") return /^EF?\d$/i.test(v) ? v.toUpperCase().replace(/^F/, "EF") : "";
  if (kind === "wind") return /^\d+$/.test(v) ? `${Number(v)} mph` : "";
  return /^\d+$/.test(v) ? `${(Number(v) / 100).toFixed(2)} in` : "";
}

/** The 12Z instant that started the convective day containing `now`. */
export function convectiveDayStart(now: number): number {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  return now >= start ? start : start - 86_400_000;
}

/** Reports within `maxMi` of a point and newer than `hours`, newest first. */
export function nearbyReports(list: StormReport[], lat: number, lon: number, now: number, maxMi = 150, hours = 24): (StormReport & { distanceMi: number })[] {
  const since = now - hours * 3_600_000;
  return list
    .filter((r) => Date.parse(r.time) >= since && Date.parse(r.time) <= now + 600_000)
    .map((r) => ({ ...r, distanceMi: Math.round(haversineMi(lat, lon, r.lat, r.lon)) }))
    .filter((r) => r.distanceMi <= maxMi)
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

export function reportTitle(r: StormReport): string {
  const k = r.kind === "tornado" ? "Tornado" : r.kind === "wind" ? "Wind damage" : "Hail";
  return r.magnitude ? `${k} (${r.magnitude})` : k;
}
