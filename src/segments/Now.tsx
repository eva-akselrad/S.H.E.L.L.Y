import { heatIndex, windChill, windDir, wmoToWeather } from "../../shared/wx";
import { WxIcon } from "../components/Icon";
import { RainStrip } from "../components/RainStrip";
import { forecast, place, wear } from "../state/store";

export function Now() {
  const f = forecast.value;
  if (!f) return <p class="muted">Loading conditions…</p>;
  const c = f.current;
  const wx = wmoToWeather(c.code, c.isDay);
  const hi = heatIndex(c.temp, c.humidity);
  const wc = windChill(c.temp, c.windSpeed);
  const today = f.daily[0];
  return (
    <section class="seg seg-now">
      <div class="now-main">
        <WxIcon icon={wx.icon} size={140} />
        <div>
          <div class="big-temp">{Math.round(c.temp)}°</div>
          <div class="now-desc">{wx.desc}</div>
          <div class="muted">
            {place.value?.name}
            {place.value?.state ? `, ${place.value.state}` : ""}
          </div>
        </div>
      </div>
      <RainStrip />
      {wear.value && <p class="wear">{wear.value.line}</p>}
      <dl class="stats">
        <div><dt>Feels like</dt><dd>{Math.round(c.feelsLike)}°</dd></div>
        <div><dt>Wind</dt><dd>{windDir(c.windDir)} {Math.round(c.windSpeed)} mph{c.windGust > c.windSpeed + 5 ? `, gusts ${Math.round(c.windGust)}` : ""}</dd></div>
        <div><dt>Humidity</dt><dd>{Math.round(c.humidity)}%</dd></div>
        <div><dt>Dew point</dt><dd>{Math.round(c.dewPoint)}°</dd></div>
        <div><dt>Pressure</dt><dd>{c.pressure.toFixed(2)} inHg</dd></div>
        <div><dt>Visibility</dt><dd>{c.visibilityMi == null ? "--" : c.visibilityMi >= 10 ? "10+ mi" : `${c.visibilityMi.toFixed(1)} mi`}</dd></div>
        {hi !== null && <div><dt>Heat index</dt><dd>{hi}°</dd></div>}
        {wc !== null && <div><dt>Wind chill</dt><dd>{wc}°</dd></div>}
        {today && <div><dt>Today</dt><dd>{Math.round(today.hi)}° / {Math.round(today.lo)}°</dd></div>}
      </dl>
    </section>
  );
}
