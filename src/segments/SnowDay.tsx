import { BAND_LABEL, displayPct, type SnowBand } from "../../shared/snowday";
import { snowOdds } from "../state/store";

const BAND_TONE: Record<SnowBand, number> = { none: 0, low: 1, some: 2, good: 3, high: 4, very_high: 5 };

const dayName = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });

/** SHELLY's guess at a school closure. Honest labels: an estimate, never the school's decision. */
export function SnowDay() {
  const r = snowOdds.value;
  const o = r?.odds;
  if (!o) return <p class="muted">Checking the winter forecast…</p>;

  const pct = displayPct(o.closed);
  const delayPct = displayPct(o.delayed);
  const tone = BAND_TONE[o.band];
  const facts = o.facts;
  const chips: string[] = [];
  if (facts.snowIn >= 0.1) chips.push(`Snow ${facts.snowIn} in.`);
  if (facts.iceIn >= 0.01) chips.push(`Ice ${facts.iceIn} in.`);
  if (facts.coldF !== null) chips.push(`Wind chill ${facts.coldF}°F`);
  if (facts.rush) chips.push("Falling at bus time");
  const wide = o.range !== null && o.range[1] - o.range[0] >= 2.5;
  const name = r.district?.name ?? "Your area";

  return (
    <section class={`seg seg-snowday sdo-tone-${tone}`}>
      <p class="sdo-kicker">
        {name}, {dayName(o.forDate)}
      </p>
      <div class="sdo-main">
        <div class="sdo-gauge" role="img" aria-label={`Chance of no in-person school: ${pct === null ? BAND_LABEL[o.band] : `${pct} percent`}`}>
          <b class="sdo-num">{pct === null ? BAND_LABEL[o.band] : `${pct}%`}</b>
          <span class="sdo-sub">{pct === null ? "chance of no school" : `${BAND_LABEL[o.band]} chance of no school`}</span>
          <span class="sdo-bar" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
              <i key={n} class={tone >= n ? "on" : ""} />
            ))}
          </span>
        </div>
        <div class="sdo-detail">
          {o.reasons.length > 0 && (
            <ul class="sdo-reasons">
              {o.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {delayPct !== null && delayPct >= 10 && <p class="sdo-delay">Chance of a 2-hour delay: about {delayPct}%</p>}
          {chips.length > 0 && (
            <ul class="sdo-chips" aria-label="What's in the forecast">
              {chips.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {wide && o.range && (
            <p class="sdo-range">
              Forecast snow runs from {o.range[0]} to {o.range[1]} in. The models disagree, so this could swing.
            </p>
          )}
          {o.note && <p class="sdo-note">{o.note}</p>}
        </div>
      </div>
      <p class="sdo-label">SHELLY's guess, not your school's decision. Check your district's alerts.</p>
      {/* sponsor slot: a "presented by" line goes here later */}
    </section>
  );
}
