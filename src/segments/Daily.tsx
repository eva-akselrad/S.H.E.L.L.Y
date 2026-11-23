import { rainText, rangeText, snowText, type DayConfidence } from "../../shared/confidence";
import { wmoToWeather } from "../../shared/wx";
import { WxIcon } from "../components/Icon";
import { confidence, forecast } from "../state/store";

// Short on purpose: these sit in a narrow column on phones. High-confidence days get no pill at all.
const CONF_LABEL = { high: "", medium: "Less sure", low: "Uncertain" } as const;

interface Item {
  key: string;
  text: string;
  level: "medium" | "low";
  why: string;
}

/** The ranges worth showing for one day: only the elements the models are unsure about. */
function unsure(c: DayConfidence): Item[] {
  const out: Item[] = [];
  const p = c.parts;
  const add = (key: string, r: { level: string; why: string } | undefined, text: string) => {
    if (r && r.level !== "high" && text) out.push({ key, text, level: r.level as Item["level"], why: r.why });
  };
  if (!p) {
    // data cached before per-element ratings existed: the high's range, as before
    if (c.level !== "high") add("temp", c, `high ${rangeText(c.hi)}`);
    return out;
  }
  add("temp", p.temp, `high ${rangeText(c.hi)}`);
  const rain = rainText(c.precip, c.wetChance);
  add("rain", p.rain, rain ? `rain ${rain}` : "");
  if (c.gust) add("wind", p.wind, `gusts ${rangeText(c.gust, " mph")}`);
  if (c.dew) add("dew", p.dew, `dew pt ${rangeText(c.dew)}`);
  return out;
}

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
          const items = c ? unsure(c) : [];
          const pill = c && c.level !== "high";
          return (
            <li key={d.date}>
              <span class="d-name">{name}</span>
              <WxIcon icon={wx.icon} size={44} />
              <span class="d-desc">
                {wx.desc}
                {(snow || items.length > 0 || pill) && (
                  <span class="d-conf">
                    {pill && <span class={`conf c-${c.level}`} title={c.why}>{CONF_LABEL[c.level]}</span>}
                    {items.map((x) => (
                      <span key={x.key} class={`d-range r-${x.level}`} title={x.why}>{x.text}</span>
                    ))}
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
          Checked against {confidence.value.members} runs of the {confidence.value.model}. Days marked "less sure" or "uncertain" show the range for
          whatever the runs disagree on: the high, rain, gusts or dew point.
        </p>
      )}
    </section>
  );
}
