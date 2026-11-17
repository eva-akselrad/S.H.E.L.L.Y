import { rangeText, snowText } from "../../shared/confidence";
import { wmoToWeather } from "../../shared/wx";
import { WxIcon } from "../components/Icon";
import { confidence, forecast } from "../state/store";

// Short on purpose: these sit in a narrow column on phones. High-confidence days get no pill at all.
const CONF_LABEL = { high: "", medium: "Less sure", low: "Uncertain" } as const;

export function Daily() {
  const f = forecast.value;
  if (!f) return <p class="muted">Loading…</p>;
  const conf = new Map((confidence.value?.days ?? []).map((d) => [d.date, d]));
  return (
    <section class="seg seg-daily">
      <ul class="days">
        {f.daily.slice(0, 7).map((d, i) => {
          const wx = wmoToWeather(d.code);
          const name = i === 0 ? "Today" : new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
          const c = conf.get(d.date);
          const snow = c ? snowText(c.snow) : "";
          const hiRange = c && c.level !== "high" ? rangeText(c.hi) : "";
          return (
            <li key={d.date}>
              <span class="d-name">{name}</span>
              <WxIcon icon={wx.icon} size={44} />
              <span class="d-desc">
                {wx.desc}
                {(snow || hiRange || (c && c.level !== "high")) && (
                  <span class="d-conf">
                    {c && c.level !== "high" && <span class={`conf c-${c.level}`} title={c.why}>{CONF_LABEL[c.level]}</span>}
                    {hiRange && <span class="muted">high {hiRange}</span>}
                    {snow && <span class="d-snow">snow {snow}</span>}
                  </span>
                )}
              </span>
              <span class="d-pop">{d.pop > 0 ? `${d.pop}%` : ""}</span>
              <b>{Math.round(d.hi)}°</b>
              <span class="muted">{Math.round(d.lo)}°</span>
            </li>
          );
        })}
      </ul>
      {confidence.value && (
        <p class="muted small">
          Checked against {confidence.value.members} runs of the {confidence.value.model}. Days marked "less sure" or "uncertain" show the range.
        </p>
      )}
    </section>
  );
}
