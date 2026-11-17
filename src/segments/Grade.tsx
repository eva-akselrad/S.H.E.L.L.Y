import { latestLine } from "../../shared/grade";
import { gradeHere } from "../state/store";

/** SHELLY's report card: yesterday's forecast vs what the nearest NWS station measured. */
export function Grade() {
  const g = gradeHere.value;
  if (!g?.latest) return <p class="muted">SHELLY starts grading itself after its first full day here.</p>;
  const d = new Date(`${g.latest.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return (
    <section class="seg seg-grade">
      <p class="grade-line">
        <span class="muted">{d}:</span> {latestLine(g.latest)}
      </p>
      {g.days30 >= 3 && (
        <dl class="stats">
          <div>
            <dt>Highs within 3°</dt>
            <dd>{g.hiWithin3}%</dd>
          </div>
          <div>
            <dt>Average miss, highs</dt>
            <dd>{g.hiMae}°</dd>
          </div>
          <div>
            <dt>Average miss, lows</dt>
            <dd>{g.loMae}°</dd>
          </div>
          <div>
            <dt>Tends to run</dt>
            <dd>{g.hiBias === null || Math.abs(g.hiBias) < 0.5 ? "On target" : g.hiBias > 0 ? `${g.hiBias}° warm` : `${Math.abs(g.hiBias)}° cool`}</dd>
          </div>
        </dl>
      )}
      <p class="muted small">
        Next-day forecasts over the last {g.days30} graded {g.days30 === 1 ? "day" : "days"}, checked against NWS station {g.station}.
      </p>
    </section>
  );
}
