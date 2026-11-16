import { wmoToWeather } from "../../shared/wx";
import { WxIcon } from "../components/Icon";
import { forecast } from "../state/store";

export function Daily() {
  const f = forecast.value;
  if (!f) return <p class="muted">Loading…</p>;
  return (
    <section class="seg seg-daily">
      <ul class="days">
        {f.daily.slice(0, 7).map((d, i) => {
          const wx = wmoToWeather(d.code);
          const name = i === 0 ? "Today" : new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
          return (
            <li key={d.date}>
              <span class="d-name">{name}</span>
              <WxIcon icon={wx.icon} size={44} />
              <span class="d-desc">{wx.desc}</span>
              <span class="d-pop">{d.pop > 0 ? `${d.pop}%` : ""}</span>
              <b>{Math.round(d.hi)}°</b>
              <span class="muted">{Math.round(d.lo)}°</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
