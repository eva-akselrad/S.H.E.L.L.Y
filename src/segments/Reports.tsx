import { reportTitle } from "../../shared/reports";
import { place, reportsNearby } from "../state/store";

const ICON = { tornado: "T", wind: "W", hail: "H" } as const;

/** Storm reports near you from the last 12 hours (NOAA SPC preliminary reports). */
export function Reports() {
  const list = reportsNearby.value;
  const tz = place.value?.tz;
  if (!list.length) return <p class="muted">No storm reports within 100 miles in the last 12 hours.</p>;
  const counts = { tornado: 0, wind: 0, hail: 0 };
  for (const r of list) counts[r.kind]++;
  return (
    <section class="seg seg-reports">
      <p class="rep-sum">
        {[counts.tornado && `${counts.tornado} tornado`, counts.wind && `${counts.wind} wind damage`, counts.hail && `${counts.hail} hail`]
          .filter(Boolean)
          .join(" · ")}{" "}
        <span class="muted">reports within 100 mi, last 12 h</span>
      </p>
      <ul class="reports">
        {list.slice(0, 8).map((r) => (
          <li key={`${r.time}-${r.lat}-${r.lon}`} class={`rep-${r.kind}`}>
            <span class="rep-icon" aria-hidden="true">{ICON[r.kind]}</span>
            <span class="rep-main">
              <b>{reportTitle(r)}</b>
              <span>
                {r.location}, {r.state} · {r.distanceMi} mi away
              </span>
              {r.comments && <span class="muted rep-c">{r.comments.slice(0, 140)}</span>}
            </span>
            <time>{new Date(r.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
