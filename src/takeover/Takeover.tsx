import { Radar } from "../segments/Radar";
import { now, threat } from "../state/store";

export function countdown(expires: string | null, nowMs: number): string {
  if (!expires) return "";
  const s = Math.max(0, Math.floor((new Date(expires).getTime() - nowMs) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Full-screen severe-weather takeover. WARNING locks radar on the polygon; EMERGENCY suppresses everything else. */
export function Takeover() {
  const t = threat.value;
  if (t.rank < 2 || !t.primary) return null;
  const a = t.primary;
  const emergency = t.level === "EMERGENCY";
  const left = countdown(t.expiresAt, now.value);
  const instruction = (a.instruction || a.description).replace(/\s+/g, " ").trim();

  return (
    <div class={`takeover ${emergency ? "emergency" : "warning"}`} role="alertdialog" aria-live="assertive" aria-label={a.event}>
      <header>
        <span class="tk-level">{emergency ? "EMERGENCY" : "WARNING"}</span>
        <h1>{a.event}</h1>
        {left && <div class="tk-count" aria-label="Time remaining">{left}</div>}
      </header>
      {!emergency && <div class="tk-map"><Radar /></div>}
      <p class="tk-area">{a.areaDesc}</p>
      <p class="tk-text">{emergency ? instruction.slice(0, 600) : instruction.slice(0, 280)}</p>
      <div class="crawl" aria-hidden="true">
        <span>{t.active.map((x) => `${x.event} — ${x.headline}`).join("   •   ")}</span>
      </div>
    </div>
  );
}
