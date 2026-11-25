// /report: printable storm damage report. Only lat/lon is sent to SHELLY's server, never the typed address.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { DamageReport, ReportItem } from "../shared/damage";
import { MAX_LISTED, MIN_DATE, clockRange } from "../shared/damage";
import { Logo, ThemeToggle } from "./components/Chrome";
import { checkAdmin, isAdmin } from "./adminSession";
import { getDeviceLocation } from "./deviceLocation";
import { ReportMap } from "./reportMap";
import "./styles/main.css";

// sponsor slot (a "presented by" line would go here; nothing is built for it)

const NOAA_STORM_EVENTS = "https://www.ncdc.noaa.gov/stormevents/";

interface Spot {
  lat: number;
  lon: number;
  label: string;
}

type Load = { state: "idle" } | { state: "loading" } | { state: "ok"; report: DamageReport } | { state: "err"; msg: string };

const localToday = (): string => new Intl.DateTimeFormat("en-CA", { dateStyle: "short" }).format(new Date());

const ERRORS: Record<string, string> = {
  bad_location: "That location isn't in the United States.",
  bad_date: "That date isn't valid.",
  too_old: "Reports only go back to January 1, 2003.",
  future: "That date hasn't happened yet.",
};

function paramsFromUrl(): { spot: Spot | null; date: string; days: number } {
  const q = new URLSearchParams(location.search);
  const lat = Number(q.get("lat"));
  const lon = Number(q.get("lon"));
  const ok = q.has("lat") && q.has("lon") && Number.isFinite(lat) && Number.isFinite(lon);
  return {
    spot: ok ? { lat, lon, label: (q.get("name") ?? "").slice(0, 80) || `${lat.toFixed(4)}, ${lon.toFixed(4)}` } : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "") ? q.get("date")! : localToday(),
    days: Math.min(3, Math.max(1, Number(q.get("days")) || 1)),
  };
}

/** Street-address lookup runs in the browser against OpenStreetMap Nominatim, so SHELLY's own server never sees the address. */
async function geocodeAddress(text: string): Promise<Spot | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(text)}`);
  if (!res.ok) throw new Error("lookup failed");
  const r = ((await res.json()) as { lat: string; lon: string }[])[0];
  return r ? { lat: Math.round(Number(r.lat) * 1e4) / 1e4, lon: Math.round(Number(r.lon) * 1e4) / 1e4, label: text.trim() } : null;
}

function longDate(d: string, days: number): string {
  const fmt = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (days <= 1) return fmt(d);
  const end = new Date(Date.parse(`${d}T12:00:00Z`) + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return `${fmt(d)} to ${fmt(end)}`;
}

const when = (iso: string, tz: string): string =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });

function qualifier(r: ReportItem): string {
  if (r.measure === "measured") return "(measured)";
  if (r.measure === "estimated") return "(estimated)";
  return "";
}

function ReportView({ report, spot, days }: { report: DamageReport; spot: Spot; days: number }) {
  const listed = report.reports.slice(0, MAX_LISTED);
  const extra = report.reports.length - listed.length;
  const multi = days > 1;
  const t = (iso: string) => (multi ? when(iso, report.tz) : new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: report.tz }));
  return (
    <article class="rp-sheet">
      <header class="rp-head">
        <h1>
          Storm report for {spot.label}, {longDate(report.date, days)}
        </h1>
        <p class="rp-sub">
          Location {report.point.lat.toFixed(4)}, {report.point.lon.toFixed(4)} · times in {report.tz.replace("_", " ")} · prepared{" "}
          {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} by SHELLY
        </p>
      </header>

      <p class="rp-summary">{report.summary}</p>

      <div class="rp-cols">
        <div class="rp-col">
          <h2>Warnings covering this address</h2>
          {report.warnings.length ? (
            <ul class="rp-list">
              {report.warnings.map((w) => (
                <li key={`${w.wfo}${w.eventid}`}>
                  <b>{w.name}</b> · NWS {w.wfo}
                  <br />
                  {multi ? `${when(w.issue, report.tz)} to ${when(w.expire, report.tz)}` : clockRange(w.issue, w.expire, report.tz)}
                  {w.windTag ? ` · wind up to ${w.windTag} mph` : ""}
                  {w.hailTag ? ` · hail up to ${w.hailTag} in.` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p class="rp-none">None found for this exact point.</p>
          )}

          <h2>Peak wind gusts at nearby stations</h2>
          {report.gusts.length ? (
            <ul class="rp-list">
              {report.gusts.map((g) => (
                <li key={g.station}>
                  <b>{g.mph} mph</b> at {g.station} · {g.distanceMi} mi {g.direction} · {t(g.time)}
                </li>
              ))}
            </ul>
          ) : (
            <p class="rp-none">No gust data within 30 miles.</p>
          )}
        </div>
        <ReportMap report={report} listed={listed} />
      </div>

      <h2>Storm reports within 10 miles (flooding within 5)</h2>
      {listed.length ? (
        <table class="rp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>What</th>
              <th>Where</th>
              <th>Time</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((r, i) => (
              <tr key={`${r.time}${r.lat}${r.lon}${r.kind}`}>
                <td>{i + 1}</td>
                <td>
                  <b>{r.label}</b> {qualifier(r)}
                  {r.remark && <div class="rp-remark">{r.remark.slice(0, 90)}</div>}
                </td>
                <td>
                  {r.distanceMi} mi {r.direction}
                  {r.place && <div class="rp-remark">{r.place}</div>}
                </td>
                <td>{t(r.time)}</td>
                <td>{r.origin === "spc" ? "SPC preliminary" : r.source || "NWS"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="rp-none">No hail, wind, tornado or flood reports within range.</p>
      )}
      {extra > 0 && <p class="rp-none">Plus {extra} more farther away, not listed.</p>}

      <footer class="rp-foot">
        <p>
          <b>Not an official NWS document.</b> Storm reports are preliminary and can be incomplete. For an official record, see NOAA's Storm Events Database, usually updated within 75 days:{" "}
          <a href={NOAA_STORM_EVENTS}>{NOAA_STORM_EVENTS}</a>
        </p>
        <p>Radar-estimated hail size is not included yet. Data: Iowa Environmental Mesonet, NWS, NOAA SPC.</p>
      </footer>
    </article>
  );
}

function ReportPage() {
  checkAdmin();
  if (isAdmin.value === null) return <div class="report-page" />;
  if (!isAdmin.value)
    return (
      <div class="report-page">
        <header class="rp-top">
          <Logo />
          <ThemeToggle />
        </header>
        <p class="rp-form">
          The storm damage report is limited to the SHELLY admin for now. <a href="/admin/">Sign in</a>, then come back to this page.
        </p>
      </div>
    );
  return <ReportBody />;
}

function ReportBody() {
  const init = paramsFromUrl();
  const [spot, setSpot] = useState<Spot | null>(init.spot);
  const [date, setDate] = useState(init.date);
  const [days, setDays] = useState(init.days);
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [shown, setShown] = useState<{ spot: Spot; days: number } | null>(null);

  async function run(s: Spot) {
    setLoad({ state: "loading" });
    try {
      const res = await fetch(`/api/damage?lat=${s.lat}&lon=${s.lon}&date=${date}&days=${days}`);
      const j = (await res.json()) as DamageReport & { error?: string };
      if (!res.ok) throw new Error(ERRORS[j.error ?? ""] ?? "Couldn't build the report. Try again in a minute.");
      setShown({ spot: s, days });
      setLoad({ state: "ok", report: j });
    } catch (e) {
      setLoad({ state: "err", msg: e instanceof Error ? e.message : "Couldn't build the report." });
    }
  }

  // arriving from a link that already names a place: build the report straight away
  useEffect(() => {
    if (init.spot) void run(init.spot);
  }, []);

  async function submit(e: Event) {
    e.preventDefault();
    if (!address.trim()) {
      if (spot) void run(spot);
      else setNote("Type an address, or use your location.");
      return;
    }
    setNote("Looking up the address...");
    try {
      const s = await geocodeAddress(address);
      if (!s) return setNote("Couldn't find that address. Try adding the town and state.");
      setNote("");
      setSpot(s);
      void run(s);
    } catch {
      setNote("The address lookup is unavailable right now. Use your location instead.");
    }
  }

  async function useMyLocation() {
    setNote("Finding you...");
    try {
      const fix = await getDeviceLocation();
      const s = { lat: Math.round(fix.lat * 1e4) / 1e4, lon: Math.round(fix.lon * 1e4) / 1e4, label: "my location" };
      setNote("");
      setSpot(s);
      void run(s);
    } catch {
      setNote("Couldn't get your location. Type an address instead.");
    }
  }

  return (
    <div class="report-page">
      <header class="rp-top no-print">
        <Logo />
        <ThemeToggle />
      </header>

      <form class="rp-form no-print" onSubmit={submit}>
        <h1>Storm damage report</h1>
        <p class="muted">A one-page summary of the warnings, storm reports and wind gusts near an address on a date, for insurance claims and contractors.</p>
        <label>
          Address
          <input type="text" autocomplete="street-address" placeholder={spot ? spot.label : "123 Main St, Jenkintown PA"} value={address} onInput={(e) => setAddress((e.target as HTMLInputElement).value)} />
        </label>
        <div class="rp-row">
          <label>
            Date
            <input type="date" min={MIN_DATE} max={localToday()} value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} required />
          </label>
          <label>
            Days
            <select value={days} onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}>
              <option value={1}>That day</option>
              <option value={2}>That day and the next</option>
              <option value={3}>That day and the next 2</option>
            </select>
          </label>
        </div>
        <div class="rp-row">
          <button type="submit" class="btn">Make report</button>
          <button type="button" onClick={useMyLocation}>Use my location</button>
        </div>
        {note && (
          <p class="muted" role="status">
            {note}
          </p>
        )}
        <p class="muted rp-privacy">
          Your address is looked up by OpenStreetMap straight from your browser. SHELLY's server only ever receives the map coordinates, and doesn't save the report.
        </p>
      </form>

      {load.state === "loading" && (
        <p class="no-print" role="status">
          Building your report...
        </p>
      )}
      {load.state === "err" && (
        <p class="no-print rp-err" role="alert">
          {load.msg}
        </p>
      )}
      {load.state === "ok" && shown && (
        <>
          <ReportView report={load.report} spot={shown.spot} days={shown.days} />
          <div class="rp-actions no-print">
            <button type="button" class="btn" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}

render(<ReportPage />, document.getElementById("app")!);
