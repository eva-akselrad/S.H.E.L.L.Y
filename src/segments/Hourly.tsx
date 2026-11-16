import { wmoToWeather } from "../../shared/wx";
import { WxIcon } from "../components/Icon";
import { forecast, place } from "../state/store";

export function Hourly() {
  const f = forecast.value;
  if (!f) return <p class="muted">Loading…</p>;
  const tz = place.value?.tz;
  const rows = f.hourly.filter((h) => new Date(h.time).getTime() > Date.now() - 3600_000).slice(0, 24);
  const temps = rows.map((r) => r.temp);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  return (
    <section class="seg seg-hourly">
      <ul class="hours">
        {rows.map((h) => {
          const wx = wmoToWeather(h.code);
          const t = new Date(h.time).toLocaleTimeString("en-US", { hour: "numeric", timeZone: tz });
          const pct = max === min ? 50 : ((h.temp - min) / (max - min)) * 100;
          return (
            <li key={h.time}>
              <span class="h-time">{t}</span>
              <WxIcon icon={wx.icon} size={36} />
              <span class="h-bar"><i style={{ height: `${20 + pct * 0.8}%` }} /></span>
              <b>{Math.round(h.temp)}°</b>
              <span class="muted">{h.pop > 0 ? `${h.pop}%` : ""}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
