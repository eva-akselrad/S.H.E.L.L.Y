import { useEffect, useState } from "preact/hooks";
import { buildSimAlert, SIM_PRESETS, type SimEntry, type SimPreset } from "../../shared/simulate";
import { alertLevel } from "../../shared/threat";
import { call } from "./api";
import { toast } from "./toast";
import { Card, Chip, Page, Segmented } from "./ui";
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
                  <p>{SIM_PRESETS[s.preset].label}</p>
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
    </Page>
  );
}
