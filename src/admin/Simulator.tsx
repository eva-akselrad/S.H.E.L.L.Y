import { useEffect, useState } from "preact/hooks";
import { buildSimAlert, CUSTOM_EVENTS, CUSTOM_SEVERITIES, SIM_PRESETS, simLabel, type CustomSim, type SimEntry, type SimPreset } from "../../shared/simulate";
import { alertLevel } from "../../shared/threat";
import { call } from "./api";
import { toast } from "./toast";
import { Card, Chip, Field, Page, Segmented, Toggle } from "./ui";
import { span } from "./util";

const DURATIONS = [
  { value: "2", label: "2 min" },
  { value: "5", label: "5 min" },
  { value: "15", label: "15 min" },
  { value: "60", label: "1 hour" },
];

const sample = (p: SimPreset) =>
  alertLevel(buildSimAlert({ id: "x", preset: p, created: "", expires: "" }, { lat: 0, lon: 0, zones: [] }));
const KIND = { CALM: "muted", ELEVATED: "warn", WARNING: "danger", EMERGENCY: "danger" } as const;

const BLANK: CustomSim = { event: "Tornado Warning", severity: "Extreme", description: "", instruction: "", tornadoObserved: false };

/** Admin-written test alert. It is always shown as a TEST, with the text typed here. */
function CustomAlert({ minutes, onStarted }: { minutes: string; onStarted: () => void }) {
  const [c, setC] = useState<CustomSim>(BLANK);
  const level = alertLevel(buildSimAlert({ id: "x", preset: "custom", custom: c, created: "", expires: "" }, { lat: 0, lon: 0, zones: [] }));
  const start = async (e: Event) => {
    e.preventDefault();
    const r = await call("POST", "/api/admin/simulate", { preset: "custom", custom: c, minutes: Number(minutes) });
    toast(r.ok ? "Custom test started" : "Could not start the test", r.ok ? "ok" : "error");
    if (r.ok) onStarted();
  };
  return (
    <Card title="Custom alert" hint="Write your own. The headline and text are always marked TEST. How it looks and sounds follows the event name and severity, like a real alert.">
      <form onSubmit={start}>
        <Field label="Event">
          <input class="adm-input" list="sim-events" maxLength={80} required value={c.event} onInput={(e) => setC({ ...c, event: (e.target as HTMLInputElement).value })} />
          <datalist id="sim-events">{CUSTOM_EVENTS.map((ev) => <option key={ev} value={ev} />)}</datalist>
        </Field>
        <Field label="Severity">
          <Segmented label="Severity" value={c.severity} onChange={(v) => setC({ ...c, severity: v })} options={CUSTOM_SEVERITIES.map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="What is happening">
          <textarea class="adm-input" rows={3} maxLength={600} value={c.description} onInput={(e) => setC({ ...c, description: (e.target as HTMLTextAreaElement).value })} placeholder="A severe thunderstorm capable of producing a tornado was located near..." />
        </Field>
        <Field label="What to do">
          <textarea class="adm-input" rows={2} maxLength={400} value={c.instruction} onInput={(e) => setC({ ...c, instruction: (e.target as HTMLTextAreaElement).value })} placeholder="Move to an interior room on the lowest floor." />
        </Field>
        <Toggle checked={!!c.tornadoObserved} onChange={(v) => setC({ ...c, tornadoObserved: v })} label="Tornado confirmed on the ground" hint="Only matters for tornado events (can raise it to an emergency look)." />
        <p class="adm-hint">Shows as the <b>{level.toLowerCase()}</b> level for {minutes} min.</p>
        <button type="submit" class="adm-btn primary">Start custom test</button>
      </form>
    </Card>
  );
}

/** Admin-written notification to the phones running the app and to web subscribers. */
function SendNotification() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [app, setApp] = useState(true);
  const [web, setWeb] = useState(true);
  const [busy, setBusy] = useState(false);
  const send = async (e: Event) => {
    e.preventDefault();
    if (!app && !web) return toast("Pick who should get it", "error");
    setBusy(true);
    const r = await call<{ app: boolean | null; web: { sent: number; total: number } | null }>("POST", "/api/admin/notify", { title, body, app, web });
    setBusy(false);
    if (!r.ok) return toast("Could not send", "error");
    const parts = [
      r.data.app === null ? "" : r.data.app ? "app: sent" : "app: failed",
      r.data.web ? `web: ${r.data.web.sent} of ${r.data.web.total}` : "",
    ].filter(Boolean);
    toast(`Sent (${parts.join(", ") || "nobody to send to"})`, r.data.app === false ? "error" : "ok");
    setTitle("");
    setBody("");
  };
  return (
    <Card title="Send a notification" hint="A plain message with your own words, sent to everyone right now. Use it for announcements, not for weather warnings (those come from the National Weather Service automatically).">
      <form onSubmit={send}>
        <Field label="Title">
          <input class="adm-input" maxLength={65} required value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="SHELLY update" />
        </Field>
        <Field label="Message">
          <textarea class="adm-input" rows={3} maxLength={240} required value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} placeholder="What you want people to read" />
        </Field>
        <Toggle checked={app} onChange={setApp} label="Phones with the SHELLY app" />
        <Toggle checked={web} onChange={setWeb} label="Web subscribers (browsers with alerts on)" />
        <p class="adm-hint">{title.length}/65 title · {body.length}/240 message</p>
        <button type="submit" class="adm-btn primary" disabled={busy}>{busy ? "Sending..." : "Send now"}</button>
      </form>
    </Card>
  );
}

export function Simulator() {
  const [active, setActive] = useState<SimEntry[]>([]);
  const [minutes, setMinutes] = useState("5");
  const [tick, setTick] = useState(Date.now());

  const load = async () => {
    const r = await call<SimEntry[]>("GET", "/api/admin/simulate");
    if (r.ok) setActive(r.data);
  };
  useEffect(() => {
    void load();
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = async (preset: SimPreset) => {
    const r = await call("POST", "/api/admin/simulate", { preset, minutes: Number(minutes) });
    toast(r.ok ? `${SIM_PRESETS[preset].label} test started` : "Could not start the test", r.ok ? "ok" : "error");
    void load();
  };
  const stop = async (id?: string) => {
    await call("DELETE", id ? `/api/admin/simulate?id=${encodeURIComponent(id)}` : "/api/admin/simulate");
    toast("Stopped");
    void load();
  };

  return (
    <Page
      title="Alert simulator"
      lead="Fire a realistic fake alert at every connected screen to check your stream layout, sound and takeovers. It auto-expires."
      actions={active.length > 0 && <button type="button" class="adm-btn danger" onClick={() => void stop()}>Stop all</button>}
    >
      <Card tone="warn">
        <p class="adm-callout">
          <b>This affects every live screen.</b> Test alerts are labelled "TEST" in the headline, but screens with sound on will
          read them aloud, music will duck, and the full-screen takeover will appear. Radar is drawn around each viewer's own location.
        </p>
      </Card>

      {active.length > 0 && (
        <Card title="Running now">
          <ul class="adm-items">
            {active.map((s) => (
              <li key={s.id}>
                <div>
                  <p>{simLabel(s)}</p>
                  <span class="adm-hint">ends in {span(Math.max(0, Math.round((new Date(s.expires).getTime() - tick) / 1000)))}</span>
                </div>
                <button type="button" class="adm-btn small" onClick={() => void stop(s.id)}>Stop</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Start a test">
        <div class="adm-field">
          <span class="adm-label">Duration</span>
          <Segmented label="Duration" value={minutes} onChange={setMinutes} options={DURATIONS} />
        </div>
        <div class="adm-presets">
          {(Object.keys(SIM_PRESETS) as SimPreset[]).map((p) => {
            const level = sample(p);
            return (
              <button key={p} type="button" class="adm-preset" onClick={() => void start(p)}>
                <b>{SIM_PRESETS[p].label}</b>
                <Chip kind={KIND[level]}>{level.toLowerCase()} level</Chip>
                <span class="adm-hint">{SIM_PRESETS[p].description}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <CustomAlert minutes={minutes} onStarted={() => void load()} />
      <SendNotification />
    </Page>
  );
}
