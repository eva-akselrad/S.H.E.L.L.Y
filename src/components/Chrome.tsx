import { useState } from "preact/hooks";
import { getDeviceLocation } from "../deviceLocation";
import { musicAllowed, musicOn, nextTrack, nowPlaying, toggleMusic } from "../music";
import { cycleTheme, theme } from "../theme";
import { alertsUpdated, announcements, locateByCoords, locateByQuery, online, place, threat } from "../state/store";

export function Logo() {
  return (
    <span class="logo">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <path d="M16 28c-6.6 0-12-4.7-12-10.5S9.4 6 16 6s10 3.8 10 8.5-3.6 7.5-8 7.5-6.5-2.4-6.5-5S13 11.5 15 11.5" />
      </svg>
      <b>SHELLY</b>
    </span>
  );
}

export function ThreatBadge() {
  const t = threat.value;
  return (
    <span class={`badge lvl-${t.level.toLowerCase()}`} title={t.reasons.join(", ")}>
      {t.level}
    </span>
  );
}

export function AnnouncementBar() {
  const list = announcements.value;
  if (list.length === 0) return null;
  return (
    <div class="notices" role="status">
      {list.map((a) => (
        <div class={`notice ${a.level === "warn" ? "warn" : "info"}`} key={a.id}>
          <span class="notice-tag">{a.level === "warn" ? "Attention" : "Notice"}</span>
          <span class="notice-text">{a.text}</span>
        </div>
      ))}
    </div>
  );
}

export function StatusLine() {
  if (!online.value) return <span class="offline">Offline — showing last data</span>;
  const u = alertsUpdated.value;
  return <span class="muted">{u ? `Alerts checked ${new Date(u).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</span>;
}

export function ThemeToggle() {
  const t = theme.value;
  const label = t === "auto" ? "Theme: auto" : t === "light" ? "Theme: light" : "Theme: dark";
  return (
    <button type="button" class="theme-toggle" onClick={cycleTheme} title="Switch between auto, light and dark" aria-label={label}>
      {t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark"}
    </button>
  );
}

export function MusicControl({ compact = false }: { compact?: boolean }) {
  if (!musicAllowed.value) return null;
  return (
    <span class="music">
      <button type="button" onClick={toggleMusic} aria-pressed={musicOn.value} aria-label={musicOn.value ? "Music on. Tap to turn off" : "Music off. Tap to turn on"}>
        {compact ? (musicOn.value ? "♪ On" : "♪ Off") : musicOn.value ? "Music on" : "Music off"}
      </button>
      {!compact && musicOn.value && nowPlaying.value && (
        <button type="button" onClick={nextTrack} title={nowPlaying.value}>Next</button>
      )}
    </span>
  );
}

export function SearchBox() {
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const go = async (e: Event) => {
    e.preventDefault();
    if (!q.trim()) return;
    try {
      setErr("");
      await locateByQuery(q.trim());
      setQ("");
    } catch {
      setErr("US locations only — try a city name or ZIP");
    }
  };
  const useMyLocation = () => {
    setErr("");
    getDeviceLocation()
      .then((f) => locateByCoords(f.lat, f.lon))
      .then(() => setQ(""))
      .catch((e: Error) =>
        setErr(e.message === "permission" || e.message === "denied" ? "Allow Location for SHELLY to use this." : e.message === "timeout" || e.message === "unavailable" ? "Couldn't get your location yet. Try again outside or with GPS on." : "SHELLY covers the United States only"),
      );
  };
  return (
    <form class="search" onSubmit={go}>
      <input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder={place.value?.name ?? "City or ZIP"} aria-label="Search for a US location" />
      <button type="submit">Go</button>
      <button type="button" onClick={useMyLocation} aria-label="Use my current location">My location</button>
      {err && <span class="err">{err}</span>}
    </form>
  );
}
