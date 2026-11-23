import { latestLine, rainLine, windLine, type Stat } from "../../shared/grade";
import { gradeHere } from "../state/store";

const miss = (s: Stat, unit: string, digits = 0) => (s.mae === null ? null : `${digits ? s.mae.toFixed(digits) : s.mae}${unit}`);

/** SHELLY's report card: yesterday's forecast vs what the nearest NWS station measured. */
export function Grade() {
  const g = gradeHere.value;
  if (!g?.latest) return <p class="muted">SHELLY starts grading itself after its first full day here.</p>;
  const d = new Date(`${g.latest.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const extra = [rainLine(g.latest), windLine(g.latest)].filter(Boolean);
  // older summaries (before rain/wind grading) lack these fields
  const dew = g.dew ? miss(g.dew, "°") : null;
  const gust = g.gust ? miss(g.gust, " mph") : null;
  const rainRight = g.rain?.right ?? null;
  const rainHours = g.hourly?.rainRight ?? null;
  const tiles: [string, string | null][] = [
    ["Highs within 3°", g.hiWithin3 === null ? null : `${g.hiWithin3}%`],
    ["Average miss, highs", g.hiMae === null ? null : `${g.hiMae}°`],
    ["Average miss, lows", g.loMae === null ? null : `${g.loMae}°`],
    ["Tends to run", g.hiBias === null || Math.abs(g.hiBias) < 0.5 ? "On target" : g.hiBias > 0 ? `${g.hiBias}° warm` : `${Math.abs(g.hiBias)}° cool`],
    ["Rain calls right", rainRight === null ? null : `${rainRight}%`],
    ["Rain hours right", rainHours === null ? null : `${Math.round(rainHours)}%`],
    ["Average miss, gusts", gust],
    ["Average miss, dew point", dew],
  ];
  const shown = tiles.filter((t): t is [string, string] => t[1] !== null);
  const hourlyTemp = g.hourly?.n ? g.hourly.temp : null;
  return (
    <section class="seg seg-grade">
      <p class="grade-line">
        <span class="muted">{d}:</span> {latestLine(g.latest)}
      </p>
      {extra.map((line) => (
        <p key={line} class="grade-sub">{line}</p>
      ))}
      {g.days30 >= 3 && (
        <dl class="stats">
          {shown.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p class="muted small">
        Next-day forecasts over the last {g.days30} graded {g.days30 === 1 ? "day" : "days"}, checked against NWS station {g.station}.
        {hourlyTemp !== null &&
          ` Hour by hour, the temperature is off by ${hourlyTemp}° on average${g.hourly.wind !== null ? ` and the wind by ${g.hourly.wind} mph` : ""}.`}
        {g.lead3 && g.lead3.n >= 3 && g.lead3.hiMae !== null && ` Three days out, highs miss by ${g.lead3.hiMae}°.`}
      </p>
    </section>
  );
}
