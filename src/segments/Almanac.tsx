import { fmtDayLength, moonPhase } from "../../shared/wx";
import { forecast, place } from "../state/store";

export function Almanac() {
  const d = forecast.value?.daily[0];
  const tz = place.value?.tz;
  const t = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const moon = moonPhase();
  return (
    <section class="seg seg-almanac">
      <dl class="stats">
        {d && <div><dt>Sunrise</dt><dd>{t(d.sunrise)}</dd></div>}
        {d && <div><dt>Sunset</dt><dd>{t(d.sunset)}</dd></div>}
        {d && <div><dt>Daylight</dt><dd>{fmtDayLength(d.sunrise, d.sunset)}</dd></div>}
        {d && <div><dt>UV peak</dt><dd>{Math.round(d.uvMax)}</dd></div>}
        <div><dt>Moon</dt><dd>{moon.name}</dd></div>
      </dl>
    </section>
  );
}
