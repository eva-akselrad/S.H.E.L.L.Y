import { catLabel, catRank } from "../../shared/hazards";
import { hazards, place, snowDay, snowOdds } from "../state/store";

/** Rivers, tides, tropical storms and snow-day odds for where you are. */
export function Local() {
  const h = hazards.value;
  const s = snowDay.value;
  const tz = place.value?.tz;
  const t = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
  if (!h && !s) return <p class="muted">Loading local hazards…</p>;

  return (
    <section class="seg seg-local">
      {s && !snowOdds.value?.odds && (
        <div class="snowday">
          <b class="sd-odds">{s.odds}%</b>
          <span>
            <b>
              Snow day odds for {new Date(`${s.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })}
            </b>
            <span class="muted">{s.reasons.join(", ")}. Just for fun: your school district decides.</span>
          </span>
        </div>
      )}

      {h?.tropical.map((ts) => (
        <div key={ts.name} class="tropical">
          <b>
            {ts.kind} {ts.name}
            {ts.category ? ` (Category ${ts.category})` : ""}
          </b>
          <span>
            {ts.distanceMi} mi to your {ts.side}, {ts.windMph} mph winds, {ts.movement}.
          </span>
        </div>
      ))}

      {h && h.rivers.length > 0 && (
        <div class="rivers">
          <h3>Rivers and creeks</h3>
          <ul>
            {h.rivers.map((g) => {
              const worst = Math.max(catRank(g.category), catRank(g.forecastCategory));
              const pct = g.stage !== null && g.floodStage ? Math.min(100, Math.max(4, (g.stage / g.floodStage) * 100)) : null;
              return (
                <li key={g.lid} class={`river r-${worst}`}>
                  <span class="river-name">{g.name}</span>
                  <span class="river-stage">
                    <b>{g.stage?.toFixed(1)} ft</b>
                    {g.floodStage ? <span class="muted"> / flood {g.floodStage} ft</span> : null}
                  </span>
                  {pct !== null && (
                    <span class="gauge" aria-hidden="true">
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  )}
                  <span class="river-cat">
                    {catLabel(g.category)}
                    {catRank(g.forecastCategory) > catRank(g.category) ? `, forecast: ${catLabel(g.forecastCategory).toLowerCase()}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {h?.tides && h.tides.next.length > 0 && (
        <div class="tides">
          <h3>Tides at {h.tides.name}</h3>
          <ul>
            {h.tides.next.map((x) => (
              <li key={x.time}>
                <span>{x.type === "H" ? "High" : "Low"}</span>
                <b>{t(x.time)}</b>
                <span class="muted">{x.ft} ft</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
