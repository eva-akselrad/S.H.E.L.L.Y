// Editors for the newer Forecaster Studio graphics.
import { useState } from "preact/hooks";
import { IMPACT_LEVELS, NOTE_ICONS, type Compare, type DayPlanner, type Impacts, type NoteCard, type Odds } from "../../shared/studio";
import { call, config } from "./api";
import { toast } from "./toast";
import { Card, Field, Segmented } from "./ui";

const ICON_NAME: Record<NoteCard["icon"], string> = { sun: "Sunny", partly: "Partly cloudy", cloud: "Cloudy", rain: "Rain", snow: "Snow", storm: "Storms", fog: "Fog", wind: "Wind", heat: "Heat", cold: "Cold" };
const WEATHER: [number, string][] = [[0, "Sunny / clear"], [2, "Partly cloudy"], [3, "Cloudy"], [45, "Fog"], [61, "Rain"], [80, "Showers"], [71, "Snow"], [66, "Freezing rain"], [95, "Thunderstorms"]];
const val = (e: Event) => (e.target as HTMLInputElement).value;

export const IMPACT_ROWS = ["Travel", "Power outages", "Flooding", "Outdoor plans", "Schools and events"];

export function NoteEditor({ body, onChange }: { body: NoteCard; onChange: (b: NoteCard) => void }) {
  const bullets = [...body.bullets, "", "", "", "", ""].slice(0, 5);
  return (
    <Card title="Forecast card" hint="Your headline and up to five short points, in your own words.">
      <div class="adm-form">
        <Field label="Headline"><input class="adm-input" maxLength={90} value={body.headline} onInput={(e) => onChange({ ...body, headline: val(e) })} placeholder="First flakes of the season Thursday night" /></Field>
        {bullets.map((b, i) => (
          <input key={i} class="adm-input" maxLength={90} value={b} placeholder={`Point ${i + 1}${i ? " (optional)" : ""}`}
            onInput={(e) => onChange({ ...body, bullets: bullets.map((x, n) => (n === i ? val(e) : x)).filter((x) => x.trim()) })} />
        ))}
        <div class="adm-row">
          <label class="adm-field"><span class="adm-label">Icon</span>
            <select class="adm-input" value={body.icon} onChange={(e) => onChange({ ...body, icon: (e.target as HTMLSelectElement).value as NoteCard["icon"] })}>
              {NOTE_ICONS.map((i) => <option key={i} value={i}>{ICON_NAME[i]}</option>)}
            </select>
          </label>
          <div class="adm-field"><span class="adm-label">Colour</span>
            <Segmented<"0" | "1" | "2" | "3"> label="Colour" value={String(body.tone) as "0" | "1" | "2" | "3"} onChange={(v) => onChange({ ...body, tone: Number(v) as NoteCard["tone"] })}
              options={[{ value: "0", label: "Calm" }, { value: "1", label: "Heads up" }, { value: "2", label: "Important" }, { value: "3", label: "Serious" }]} />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ImpactsEditor({ body, onChange }: { body: Impacts; onChange: (b: Impacts) => void }) {
  const lvl = (v: number, set: (n: Impacts["overall"]) => void) => (
    <select class="adm-input" style={{ width: "9rem" }} value={v} onChange={(e) => set(Number((e.target as HTMLSelectElement).value) as Impacts["overall"])}>
      {IMPACT_LEVELS.map((n, i) => <option key={n} value={i}>{n}</option>)}
    </select>
  );
  const patch = (i: number, p: Partial<Impacts["rows"][number]>) => onChange({ ...body, rows: body.rows.map((r, n) => (n === i ? { ...r, ...p } : r)) });
  return (
    <Card title="Impact scale" hint="Rate how much the event will affect daily life, overall and by category.">
      <div class="adm-form">
        <Field label="Event"><input class="adm-input" maxLength={80} value={body.event} onInput={(e) => onChange({ ...body, event: val(e) })} placeholder="Thursday night snow" /></Field>
        <div class="adm-row"><span class="adm-label">Overall</span>{lvl(body.overall, (n) => onChange({ ...body, overall: n }))}</div>
        {body.rows.map((r, i) => (
          <div key={i} class="adm-row">
            <input class="adm-input" style={{ width: "11rem" }} maxLength={30} value={r.label} onInput={(e) => patch(i, { label: val(e) })} aria-label="Category" />
            {lvl(r.level, (n) => patch(i, { level: n }))}
            <input class="adm-input grow" maxLength={80} value={r.note} placeholder="Short note (optional)" onInput={(e) => patch(i, { note: val(e) })} />
            <button type="button" class="adm-btn small danger" onClick={() => onChange({ ...body, rows: body.rows.filter((_, n) => n !== i) })} aria-label="Remove">✕</button>
          </div>
        ))}
        {body.rows.length < 6 && <div class="adm-row"><button type="button" class="adm-btn" onClick={() => onChange({ ...body, rows: [...body.rows, { label: "", level: 0, note: "" }] })}>Add a category</button></div>}
      </div>
    </Card>
  );
}

export function DayPlannerEditor({ body, onChange }: { body: DayPlanner; onChange: (b: DayPlanner) => void }) {
  const cities = config.value.live.region.cities;
  const [city, setCity] = useState(body.place || cities[0]?.name || "");
  const [day, setDay] = useState<"auto" | "0" | "1">("auto");
  const load = async () => {
    const q = new URLSearchParams({ city, ...(day === "auto" ? {} : { day }) });
    const r = await call<DayPlanner>("GET", `/api/admin/studio/day-planner?${q}`);
    if (r.ok) onChange(r.data);
    else toast("Couldn't load the model forecast.", "error");
  };
  const patch = (i: number, p: Partial<DayPlanner["parts"][number]>) => onChange({ ...body, parts: body.parts.map((x, n) => (n === i ? { ...x, ...p } : x)) });
  return (
    <Card title="Day planner" hint="Load a city from the model, then change anything you like.">
      <div class="adm-row">
        <select class="adm-input" style={{ width: "12rem" }} value={city} onChange={(e) => setCity((e.target as HTMLSelectElement).value)} aria-label="City">
          {cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <Segmented label="Day" value={day} onChange={setDay} options={[{ value: "auto", label: "Next day ahead" }, { value: "0", label: "Today" }, { value: "1", label: "Tomorrow" }]} />
        <button type="button" class="adm-btn" onClick={() => void load()}>Load from model</button>
      </div>
      {body.parts.map((p, i) => (
        <div key={i} class="adm-row">
          <b style={{ width: "6.5rem" }}>{p.label}</b>
          <input class="adm-input narrow" type="number" value={p.temp} onInput={(e) => patch(i, { temp: Number(val(e)) })} aria-label="Temperature" />
          <select class="adm-input" style={{ width: "10rem" }} value={WEATHER.some(([c]) => c === p.code) ? p.code : WEATHER.reduce((a, b) => (Math.abs(b[0] - p.code) < Math.abs(a[0] - p.code) ? b : a))[0]} onChange={(e) => patch(i, { code: Number((e.target as HTMLSelectElement).value) })} aria-label="Weather">
            {WEATHER.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <input class="adm-input narrow" type="number" min={0} max={100} value={p.pop} onInput={(e) => patch(i, { pop: Number(val(e)) })} aria-label="Rain chance" />
          <span class="adm-hint">%</span>
          <input class="adm-input grow" maxLength={60} value={p.note} placeholder="Note (optional)" onInput={(e) => patch(i, { note: val(e) })} />
        </div>
      ))}
      {body.parts.length === 0 && <p class="adm-hint">Press "Load from model" to begin.</p>}
    </Card>
  );
}

export function CompareEditor({ body, onChange }: { body: Compare; onChange: (b: Compare) => void }) {
  const load = async () => {
    const r = await call<Compare>("GET", "/api/admin/studio/compare");
    if (r.ok) onChange(r.data);
    else toast("Couldn't load the model highs.", "error");
  };
  const patch = (i: number, p: Partial<Compare["cities"][number]>) => onChange({ cities: body.cities.map((c, n) => (n === i ? { ...c, ...p } : c)) });
  return (
    <Card title="Today vs tomorrow" hint="Highs for every city in your rotation. Change any number before publishing.">
      <div class="adm-row"><button type="button" class="adm-btn" onClick={() => void load()}>Load from model</button></div>
      {body.cities.map((c, i) => (
        <div key={c.name} class="adm-row">
          <b style={{ width: "10rem" }}>{c.name}</b>
          <input class="adm-input narrow" type="number" value={c.today} onInput={(e) => patch(i, { today: Number(val(e)) })} aria-label={`${c.name} today`} />
          <span class="adm-hint">today</span>
          <input class="adm-input narrow" type="number" value={c.tomorrow} onInput={(e) => patch(i, { tomorrow: Number(val(e)) })} aria-label={`${c.name} tomorrow`} />
          <span class="adm-hint">tomorrow</span>
        </div>
      ))}
    </Card>
  );
}

export function OddsEditor({ body, onChange }: { body: Odds; onChange: (b: Odds) => void }) {
  const patch = (i: number, p: Partial<Odds["outcomes"][number]>) => onChange({ ...body, outcomes: body.outcomes.map((o, n) => (n === i ? { ...o, ...p } : o)) });
  return (
    <Card title="The odds" hint="Your chances for each outcome, and how sure you are.">
      <div class="adm-form">
        <Field label="Event"><input class="adm-input" maxLength={80} value={body.event} onInput={(e) => onChange({ ...body, event: val(e) })} placeholder="Snow, Philadelphia, Thursday night" /></Field>
        {body.outcomes.map((o, i) => (
          <div key={i} class="adm-row">
            <input class="adm-input grow" maxLength={50} value={o.label} onInput={(e) => patch(i, { label: val(e) })} placeholder="1 inch or more" aria-label="Outcome" />
            <input type="range" min={0} max={100} step={5} value={o.pct} onInput={(e) => patch(i, { pct: Number(val(e)) })} aria-label="Chance" />
            <b style={{ width: "3rem" }}>{o.pct}%</b>
            <button type="button" class="adm-btn small danger" onClick={() => onChange({ ...body, outcomes: body.outcomes.filter((_, n) => n !== i) })} aria-label="Remove">✕</button>
          </div>
        ))}
        {body.outcomes.length < 6 && <div class="adm-row"><button type="button" class="adm-btn" onClick={() => onChange({ ...body, outcomes: [...body.outcomes, { label: "", pct: 50 }] })}>Add an outcome</button></div>}
        <div class="adm-field"><span class="adm-label">Confidence</span>
          <Segmented label="Confidence" value={body.confidence} onChange={(v) => onChange({ ...body, confidence: v })} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
        </div>
        <Field label="Why (optional)"><input class="adm-input" maxLength={160} value={body.note} onInput={(e) => onChange({ ...body, note: val(e) })} placeholder="Models disagree on how far north the snow gets." /></Field>
      </div>
    </Card>
  );
}
