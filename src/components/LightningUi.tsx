import { agoWords, clockTime, distanceWords, type Flash, type LightningState, lightningActive, lightningAdvice, lightningHeadline, LIGHTNING_NOTE, ringSummary } from "../../shared/lightning";
import { lightning, lightningState, place, now } from "../state/store";

/** The chip: its words carry the meaning, color only adds to it. Hidden on a dry day. */
export function LightningChip({ compact = false }: { compact?: boolean }) {
  const s = lightningState.value;
  const p = place.value;
  if (!s || !p || !lightningActive(s)) return null;
  const t = now.value;
  const tz = p.tz;
  const advice = lightningAdvice(s, tz);
  // sponsor slot: a "presented by" line would go here (not built yet)
  return (
    <div class={`lightning-chip lt-${s.stale ? "stale" : s.level}${compact ? " compact" : ""}`} role="status" aria-live="polite">
      <span class="lt-tag">{s.stale ? "Delayed" : s.level === "danger" ? "Danger" : s.level === "nearby" ? "Nearby" : "Wait"}</span>
      <b>{lightningHeadline(s, t)}.</b>
      {advice && <span>{advice}</span>}
    </div>
  );
}

const R = 90; // px for 30 miles
const CX = 100;
const MI_LAT = 69.0;

function place2xy(lat0: number, lon0: number, f: Flash): [number, number, number] {
  const dyMi = (f[0] - lat0) * MI_LAT;
  const dxMi = (f[1] - lon0) * MI_LAT * Math.cos((lat0 * Math.PI) / 180);
  return [CX + (dxMi / 30) * R, CX - (dyMi / 30) * R, Math.hypot(dxMi, dyMi)];
}

/** Rings at 5, 10 and 25 mi; flashes fade with age. You are the dot in the middle. */
export function RingMap({ flashes, lat, lon, state, at }: { flashes: Flash[]; lat: number; lon: number; state: LightningState; at: number }) {
  const dots = flashes
    .map((f) => ({ f, xy: place2xy(lat, lon, f) }))
    .filter((d) => d.xy[2] <= 30.5)
    .sort((a, b) => a.f[2] - b.f[2]);
  return (
    <svg class="lt-ring" viewBox="0 0 200 200" role="img" aria-label={ringSummary(state, at)}>
      {[5, 10, 25].map((mi) => (
        <g key={mi}>
          <circle cx={CX} cy={CX} r={(mi / 30) * R} class={`lt-r${mi === 10 ? " r10" : ""}`} />
          <text x={CX + 3} y={CX - (mi / 30) * R - 2} class="lt-rl">{mi} mi</text>
        </g>
      ))}
      <line x1={CX} y1={6} x2={CX} y2={14} class="lt-north" />
      <text x={CX + 4} y={14} class="lt-rl">N</text>
      {dots.map(({ f, xy }) => {
        const age = (at - f[2]) / 60_000;
        const fresh = age <= 10;
        return <circle key={`${f[0]},${f[1]},${f[2]}`} cx={xy[0]} cy={xy[1]} r={fresh ? 4 : 2.8} class={`lt-dot${fresh ? " fresh" : ""}`} style={{ opacity: String(Math.max(0.35, 1 - age / 45)) }} />;
      })}
      <circle cx={CX} cy={CX} r={3.5} class="lt-me" />
    </svg>
  );
}

export function LightningPanel() {
  const r = lightning.value;
  const s = lightningState.value;
  const p = place.value;
  const t = now.value;
  if (!r || !p) return <p class="muted">Checking for lightning…</p>;
  if (!r.available || !s) return <p class="muted">Lightning isn't tracked here yet.</p>;
  const mins = s.allClearAt ? Math.max(0, Math.ceil((s.allClearAt - t) / 60_000)) : null;
  return (
    <section class={`seg seg-lightning lt-${s.stale ? "stale" : s.level}`}>
      <div class="lt-main">
        <div class="lt-big">
          {mins !== null ? (
            <>
              <b class="lt-num">{mins}</b>
              <span class="lt-sub">min until all clear (at {clockTime(s.allClearAt!, p.tz)}), if no more lightning within 10 mi</span>
            </>
          ) : s.nearestMi !== null && !s.stale ? (
            <>
              <b class="lt-num">{s.nearestMi < 3 ? "Overhead" : distanceWords(s.nearestMi).replace("about ", "~")}</b>
              <span class="lt-sub">closest flash, {s.nearestAt ? agoWords(t - s.nearestAt) : ""}</span>
            </>
          ) : (
            <b class="lt-num small">Data delayed</b>
          )}
        </div>
        <div class="lt-ringwrap">
          <RingMap flashes={r.flashes} lat={p.lat} lon={p.lon} state={s} at={t} />
        </div>
      </div>
      <p class="lt-line"><b>{lightningHeadline(s, t)}.</b> {lightningAdvice(s, p.tz)}</p>
      <p class="lt-note muted">{LIGHTNING_NOTE} {s.count25 ? `${s.count25} flashes within about 25 mi in the last 15 min.` : ""}</p>
    </section>
  );
}
