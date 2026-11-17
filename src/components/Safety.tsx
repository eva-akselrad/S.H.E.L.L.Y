import { healthMessage } from "../../shared/health";
import { etaLine, nearbyLine } from "../../shared/eta";
import { actionCards, health, nearby, place, primaryEta, threat } from "../state/store";

/** Loud, on every screen, whenever alert data can't be trusted. Never fail silently. */
export function StaleBanner() {
  const h = health.value;
  if (h.ok) return null;
  return (
    <div class="stale" role="alert">
      <span class="stale-tag">Alerts may be delayed</span>
      <span>{healthMessage(h)}</span>
    </div>
  );
}

/**
 * "What do I do right now". The takeover covers WARNING and EMERGENCY, so this shows the
 * watch/advisory card (ELEVATED). `compact` is one line for the kiosk.
 */
export function ActionCard({ compact = false }: { compact?: boolean }) {
  const t = threat.value;
  if (t.rank >= 2) return null;
  const top = actionCards.value[0];
  if (!top) return null;
  const { card, alert } = top;
  if (compact) {
    return (
      <div class={`action compact u-${card.urgency}`} role="status">
        <b>{alert.event}:</b> {card.title} {card.steps[0]}
      </div>
    );
  }
  return (
    <section class={`action u-${card.urgency}`} aria-label={`What to do: ${alert.event}`}>
      <header>
        <span class="action-tag">{alert.event}</span>
        <h3>{card.title}</h3>
      </header>
      <ol>
        {card.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </section>
  );
}

/** "Tornado Warning 4 mi to your west. It does not cover you right now." */
export function NearbyNotice() {
  if (threat.value.rank >= 2) return null;
  const n = nearby.value[0];
  if (!n) return null;
  return (
    <div class={`nearby ${n.eta ? "coming" : ""}`} role="status">
      {nearbyLine(n)}
    </div>
  );
}

/** Storm ETA for the takeover. */
export function EtaBanner() {
  const e = primaryEta.value;
  if (!e) return null;
  return (
    <div class="eta" role="status">
      <b>{etaLine(e, place.value?.tz)}</b>
      <span>
        Moving {e.direction} at {e.speedMph} mph.
      </span>
    </div>
  );
}
