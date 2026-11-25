import { useEffect, useState } from "preact/hooks";
import type { District, SnowDayConfig } from "../../shared/config";
import { BAND_LABEL, OUTCOMES, type BandRecord, type SnowLogEntry, type SnowOutcome } from "../../shared/snowday";
import type { Place } from "../../shared/types";
import { call, config, saveConfig } from "./api";
import { toast } from "./toast";
import { Card, Field, Page, Toggle } from "./ui";

interface LogState {
  log: SnowLogEntry[];
  record: BandRecord[];
}

const toughLabel = (t: number): string => (t < 0.25 ? "Closes quickly" : t < 0.5 ? "Closes a bit early" : t < 0.75 ? "Average to tough" : "Rarely closes");
const OUTCOME_LABEL: Record<SnowOutcome, string> = { open: "Open", delayed: "Delayed", closed: "Closed", remote: "Remote day" };

export function SnowDay() {
  const c = config.value;
  const [draft, setDraft] = useState<SnowDayConfig>(c.snowDay);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [newOff, setNewOff] = useState("");
  const [data, setData] = useState<LogState | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(c.snowDay);

  useEffect(() => {
    void call<LogState>("GET", "/api/admin/snowday/log").then((r) => r.ok && setData(r.data));
  }, []);

  const patch = (id: string, p: Partial<District>) => setDraft((d) => ({ ...d, districts: d.districts.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const add = () => {
    const home = c.defaultLocation;
    const id = `district-${Date.now().toString(36)}`;
    setDraft((d) => ({
      ...d,
      districts: [...d.districts, { id, name: "New district", lat: home?.lat ?? 39.95, lon: home?.lon ?? -75.16, toughness: 0.5, coldWindChillF: -10 }],
    }));
  };
  const lookup = async (id: string) => {
    if (!query.trim()) return;
    const r = await call<Place>("GET", `/api/location?q=${encodeURIComponent(query.trim())}`);
    if (!r.ok) return toast("No US location found for that search", "error");
    patch(id, { lat: r.data.lat, lon: r.data.lon });
    setTarget(null);
    setQuery("");
  };
  const addOff = () => {
    if (!/^\d{4}-\d\d-\d\d$/.test(newOff)) return;
    setDraft((d) => ({ ...d, daysOff: [...new Set([...d.daysOff, newOff])].sort() }));
    setNewOff("");
  };

  const snapshot = async (districtId: string) => {
    const r = await call<LogState>("POST", "/api/admin/snowday/log", { districtId });
    if (r.ok) {
      setData(r.data);
      toast("Recorded the current guess. Fill in what happened later.");
    } else toast(r.status === 400 ? "Save the district first" : "No forecast available right now", "error");
  };
  const setOutcome = async (id: string, actual: SnowOutcome | null) => {
    const r = await call<LogState>("PUT", "/api/admin/snowday/log", { id, actual });
    if (r.ok) setData(r.data);
  };
  const drop = async (id: string) => {
    const r = await call<LogState>("DELETE", `/api/admin/snowday/log?id=${encodeURIComponent(id)}`);
    if (r.ok) setData(r.data);
  };

  const saved = new Set(c.snowDay.districts.map((d) => d.id));

  return (
    <Page
      title="Snow day odds"
      lead="SHELLY's own guess at whether a school district closes, from the NWS forecast. It is an estimate, never the school's decision."
      actions={
        <>
          {dirty && <button type="button" class="adm-btn" onClick={() => setDraft(c.snowDay)}>Discard</button>}
          <button type="button" class="adm-btn primary" disabled={!dirty} onClick={() => void saveConfig({ snowDay: draft }, "Snow day settings saved")}>Save changes</button>
        </>
      }
    >
      <Card>
        <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="Show snow day odds" hint="Only appears November 1 to April 15, and only when snow or ice is in the forecast." />
      </Card>

      <Card title="Districts" hint="Each district sits at one point (the district office is fine) and gets its own toughness. A visitor within 25 miles sees the closest one. Add real districts here: SHELLY does not guess their policies.">
        {draft.districts.length === 0 && <p class="adm-hint">No districts. Visitors get a generic estimate for their own location.</p>}
        {draft.districts.map((d) => (
          <div key={d.id} class="adm-card inner">
            <div class="adm-row">
              <input class="adm-input grow" value={d.name} maxLength={60} aria-label="District name" onInput={(e) => patch(d.id, { name: (e.target as HTMLInputElement).value })} />
              <button type="button" class="adm-btn small" onClick={() => setDraft({ ...draft, districts: draft.districts.filter((x) => x.id !== d.id) })}>Remove</button>
            </div>
            <div class="adm-row">
              <Field label="Latitude">
                <input class="adm-input" type="number" step="0.0001" value={d.lat} onInput={(e) => patch(d.id, { lat: Number((e.target as HTMLInputElement).value) })} />
              </Field>
              <Field label="Longitude">
                <input class="adm-input" type="number" step="0.0001" value={d.lon} onInput={(e) => patch(d.id, { lon: Number((e.target as HTMLInputElement).value) })} />
              </Field>
              <button type="button" class="adm-btn small" onClick={() => setTarget(target === d.id ? null : d.id)}>Find by place name</button>
            </div>
            {target === d.id && (
              <form class="adm-row" onSubmit={(e) => { e.preventDefault(); void lookup(d.id); }}>
                <input class="adm-input grow" placeholder="Town or ZIP" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} aria-label="Search for a US place" />
                <button class="adm-btn" type="submit">Look up</button>
              </form>
            )}
            <Field label={`How quick to close: ${toughLabel(d.toughness)}`} hint="Left means this district closes at the first flurry. Right means it plows through almost anything.">
              <input type="range" min="0" max="1" step="0.05" value={d.toughness} onInput={(e) => patch(d.id, { toughness: Number((e.target as HTMLInputElement).value) })} />
            </Field>
            <Field label="Cold closure wind chill (°F)" hint="A wind chill at or below this adds to the odds. Rare in this area.">
              <input class="adm-input" type="number" min="-60" max="20" value={d.coldWindChillF} onInput={(e) => patch(d.id, { coldWindChillF: Number((e.target as HTMLInputElement).value) })} />
            </Field>
          </div>
        ))}
        <button type="button" class="adm-btn" onClick={add} disabled={draft.districts.length >= 12}>Add a district</button>
      </Card>

      <Card title="Days off" hint="Holidays and in-service days. The odds skip these, and on a day off SHELLY says there is no school tomorrow anyway. Weekends are already skipped.">
        <div class="adm-row">
          <input class="adm-input" type="date" value={newOff} onInput={(e) => setNewOff((e.target as HTMLInputElement).value)} aria-label="Add a day off" />
          <button type="button" class="adm-btn" onClick={addOff} disabled={!newOff}>Add</button>
        </div>
        <ul class="adm-list">
          {draft.daysOff.map((d) => (
            <li key={d} class="adm-row">
              <span class="grow">{new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
              <button type="button" class="adm-btn small" onClick={() => setDraft({ ...draft, daysOff: draft.daysOff.filter((x) => x !== d) })}>Remove</button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="SHELLY's snow day record" hint="Snapshot what SHELLY says the night before, then mark what really happened. The weights are not fit to this automatically. It is here so you can see how honest the bands are.">
        <div class="adm-row">
          {draft.districts.filter((d) => saved.has(d.id)).map((d) => (
            <button key={d.id} type="button" class="adm-btn small" onClick={() => void snapshot(d.id)}>Record now: {d.name}</button>
          ))}
        </div>
        {data && data.log.length > 0 && (
          <table class="adm-plain">
            <thead>
              <tr><th>School day</th><th>District</th><th>SHELLY said</th><th>What happened</th><th /></tr>
            </thead>
            <tbody>
              {data.log.slice(0, 40).map((e) => (
                <tr key={e.id}>
                  <td>{e.forDate}</td>
                  <td>{e.districtName}</td>
                  <td>{BAND_LABEL[e.band]} ({Math.round(e.closed * 100)}% closed)</td>
                  <td>
                    <select class="adm-input" value={e.actual ?? ""} aria-label="What happened" onChange={(ev) => void setOutcome(e.id, ((ev.target as HTMLSelectElement).value || null) as SnowOutcome | null)}>
                      <option value="">Not yet</option>
                      {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                    </select>
                  </td>
                  <td><button type="button" class="adm-btn small" onClick={() => void drop(e.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.record.some((r) => r.n > 0) && (
          <table class="adm-plain">
            <thead>
              <tr><th>Band</th><th>Days</th><th>Open</th><th>Delayed</th><th>Closed or remote</th></tr>
            </thead>
            <tbody>
              {data.record.filter((r) => r.n > 0).map((r) => (
                <tr key={r.band}><td>{BAND_LABEL[r.band]}</td><td>{r.n}</td><td>{r.open}</td><td>{r.delayed}</td><td>{r.closed}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.log.length === 0 && <p class="adm-hint">Nothing recorded yet.</p>}
      </Card>
    </Page>
  );
}
