import { useEffect, useState } from "preact/hooks";
import type { LiveConfig } from "../../shared/config";
import type { Rundown } from "../../shared/live/rundown";
import { call, config, saveConfig } from "./api";
import { toast } from "./toast";
import { Card, Chip, Field, Page, Segmented, Toggle } from "./ui";
import { OnAir, PlaylistEditor } from "./LiveControls";
import type { LiveControl } from "../../shared/live/blocks";

interface LiveStatus {
  keySet: boolean;
  used: number;
  cap: number;
  rundown: Rundown | null;
  control: LiveControl | null;
}
interface TestResult {
  ok: boolean;
  text?: string;
  filtered?: string | null;
  model?: string;
  ms: number;
  error?: string;
  used: number;
  cap: number;
}

const cityLines = (c: LiveConfig): string => c.region.cities.map((x) => `${x.name}, ${x.state}, ${x.lat}, ${x.lon}`).join("\n");

function parseCities(text: string): LiveConfig["region"]["cities"] {
  return text
    .split("\n")
    .map((l) => l.split(",").map((s) => s.trim()))
    .filter((p) => p.length >= 4 && p[0])
    .map((p) => ({ name: p[0]!, state: p[1]!, lat: Number(p[2]), lon: Number(p[3]) }));
}

export function Live() {
  const [d, setD] = useState<LiveConfig>(config.value.live);
  const [forecaster, setForecaster] = useState(config.value.studio.forecasterName);
  const [cities, setCities] = useState(cityLines(config.value.live));
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setD(config.value.live);
    setCities(cityLines(config.value.live));
  }, [config.value]);
  const load = () => void call<LiveStatus>("GET", "/api/admin/live").then((r) => r.ok && setStatus(r.data));
  useEffect(load, []);

  const set = <K extends keyof LiveConfig>(k: K, v: LiveConfig[K]) => setD((x) => ({ ...x, [k]: v }));
  const setLlm = (patch: Partial<LiveConfig["llm"]>) => setD((x) => ({ ...x, llm: { ...x.llm, ...patch } }));

  const save = async () => {
    const ok = await saveConfig({ live: { ...d, region: { ...d.region, cities: parseCities(cities) } }, studio: { forecasterName: forecaster } }, "SHELLY Live saved");
    if (ok) {
      await call("POST", "/api/admin/live/refresh");
      load();
    }
  };

  const newToken = async () => {
    const r = await call<{ viewerToken: string }>("POST", "/api/admin/live/token");
    if (r.ok) {
      setD((x) => ({ ...x, viewerToken: r.data.viewerToken }));
      config.value = { ...config.value, live: { ...config.value.live, viewerToken: r.data.viewerToken } };
      toast("New viewer token created. Update the OBS URL.");
    }
  };

  const runTest = async () => {
    setTesting(true);
    const r = await call<TestResult>("POST", "/api/admin/live/llm-test");
    setTesting(false);
    if (r.ok) {
      setTest(r.data);
      load();
    } else toast("Test failed to run", "error");
  };

  const url = `${location.origin}/live?key=${d.viewerToken || "<create a token first>"}`;
  const r = status?.rundown;

  return (
    <Page
      title="SHELLY Live"
      lead="The 24/7 broadcast page. Alerts and warnings are always read from National Weather Service data; the AI host only adds calm-weather color."
      actions={<button type="button" class="adm-btn primary" onClick={() => void save()}>Save</button>}
    >
      {d.enabled ? (
        <OnAir
          control={status?.control ?? null}
          cities={d.region.cities}
          llmOn={d.llm.enabled && !!status?.keySet}
          onChange={(x) => setStatus((st) => (st ? { ...st, control: x.control, rundown: x.rundown ?? st.rundown } : st))}
        />
      ) : (
        <Card title="On air now" hint="Switch the broadcast on and save to use the live controls." >
          <p class="adm-hint">Say something, play or hold a block, skip, and your own bulletins all appear here once the broadcast is on.</p>
        </Card>
      )}

      <PlaylistEditor
        list={d.playlist}
        cities={d.region.cities}
        onChange={(l) => set("playlist", l)}
        onCue={(e) =>
          void call<{ control: LiveControl; rundown: Rundown | null }>("POST", "/api/admin/live/control", { action: "cue", entry: e }).then((x) => {
            if (x.ok) {
              setStatus((st) => (st ? { ...st, control: x.data.control, rundown: x.data.rundown ?? st.rundown } : st));
              toast("Playing next");
            } else toast("That didn't go through.", "error");
          })
        }
      />

      <Card title="Broadcast">
        <div class="adm-form">
          <Toggle checked={d.enabled} onChange={(v) => set("enabled", v)} label="Broadcast is on" hint="When off, the rundown is not produced and /live shows nothing." />
          <Field label="Watch-live link" hint="Your YouTube livestream address (https). While the broadcast is on, the website and app show a Watch live button that opens it. Leave blank for no button.">
            <input class="adm-input" type="url" maxLength={300} placeholder="https://www.youtube.com/watch?v=..." value={d.watchUrl} onInput={(e) => set("watchUrl", (e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Region name" hint="Spoken and shown on screen, for example Philadelphia region.">
            <input class="adm-input" value={d.region.name} onInput={(e) => setD((x) => ({ ...x, region: { ...x.region, name: (e.target as HTMLInputElement).value } }))} />
          </Field>
          <Field label="NWS office and sender text" hint="Alerts from this office count as in-region. Warnings from neighbors that overlap the region box also count.">
            <div class="adm-row">
              <input class="adm-input narrow" maxLength={4} value={d.region.office} onInput={(e) => setD((x) => ({ ...x, region: { ...x.region, office: (e.target as HTMLInputElement).value.toUpperCase() } }))} aria-label="Office code" />
              <input class="adm-input grow" value={d.region.senderMatch} onInput={(e) => setD((x) => ({ ...x, region: { ...x.region, senderMatch: (e.target as HTMLInputElement).value } }))} aria-label="Sender text" />
            </div>
          </Field>
          <Field label="Cities in the calm rotation" hint="One per line: name, state, latitude, longitude.">
            <textarea class="adm-input" rows={8} value={cities} onInput={(e) => setCities((e.target as HTMLTextAreaElement).value)} />
          </Field>
          <Field label="Forecaster name" hint="Credited on Forecaster Studio graphics.">
            <input class="adm-input" value={forecaster} onInput={(e) => setForecaster((e.target as HTMLInputElement).value)} />
          </Field>
        </div>
      </Card>

      <Card title="OBS address" hint="Add this as a Browser Source at 1920 by 1080. The token keeps the page unadvertised; it is not a password.">
        <input class="adm-input" readOnly value={url} onFocus={(e) => (e.target as HTMLInputElement).select()} aria-label="OBS browser source address" />
        <div class="adm-row">
          <button type="button" class="adm-btn" onClick={() => void newToken()}>{d.viewerToken ? "Replace token" : "Create token"}</button>
          {d.viewerToken && <a class="adm-btn" href={url} target="_blank" rel="noreferrer">Open</a>}
        </div>
      </Card>

      <Card title="AI host (optional)" hint="Writes only calm-period headlines and talk breaks. If it is off, fails, or hits the daily limit, SHELLY uses built-in wording.">
        <div class="adm-form">
          <Toggle checked={d.llm.enabled} onChange={(v) => setLlm({ enabled: v })} label="Use an AI model for host text" />
          <div>
            {status?.keySet ? <Chip kind="ok">API key set</Chip> : <Chip kind="warn">No API key. Add the secret LLM_API_KEY to the Worker.</Chip>}
          </div>
          <div class="adm-field">
            <span class="adm-label">Provider</span>
            <Segmented
              label="Provider"
              value={d.llm.provider}
              onChange={(v) => setLlm({ provider: v })}
              options={[{ value: "openrouter", label: "OpenRouter" }, { value: "openai-compatible", label: "Other (OpenAI-compatible)" }]}
            />
          </div>
          <Field label="Base URL" hint="A local model later only needs a new URL, model and key.">
            <input class="adm-input" value={d.llm.baseUrl} onInput={(e) => setLlm({ baseUrl: (e.target as HTMLInputElement).value })} />
          </Field>
          <Field label="Models, in fallback order (up to 3)" hint="One per line. On OpenRouter, free models end in :free.">
            <textarea class="adm-input" rows={3} value={d.llm.models.join("\n")} onInput={(e) => setLlm({ models: (e.target as HTMLTextAreaElement).value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3) })} />
          </Field>
          <Field label="Daily request cap" hint={`Used today: ${status?.used ?? "?"}. OpenRouter free models allow about 50 a day on a new account.`}>
            <input class="adm-input narrow" type="number" min={0} max={5000} value={d.llm.dailyRequestCap} onInput={(e) => setLlm({ dailyRequestCap: Number((e.target as HTMLInputElement).value) })} />
          </Field>
          <Field label={`Temperature ${d.llm.temperature}`}>
            <input type="range" min={0} max={1.5} step={0.1} value={d.llm.temperature} onInput={(e) => setLlm({ temperature: Number((e.target as HTMLInputElement).value) })} />
          </Field>
          <div class="adm-row">
            <button type="button" class="adm-btn" disabled={testing} onClick={() => void runTest()}>{testing ? "Testing…" : "Test (uses 1 request)"}</button>
            <span class="adm-hint">Save first so the test uses your latest settings.</span>
          </div>
          {test && (
            <div class="adm-note">
              {test.ok ? <Chip kind="ok">{test.ms} ms{test.model ? ` · ${test.model}` : ""}</Chip> : <Chip kind="danger">{test.error}</Chip>}
              {test.text && <p>{test.text}</p>}
              {test.ok && test.filtered === null && <p class="adm-hint">The output filter would have discarded this reply.</p>}
            </div>
          )}
        </div>
      </Card>

      <Card title="Host persona">
        <div class="adm-form">
          <Field label="Name">
            <input class="adm-input" value={d.host.name} onInput={(e) => setD((x) => ({ ...x, host: { ...x.host, name: (e.target as HTMLInputElement).value } }))} />
          </Field>
          <Field label={`Tone: ${d.host.tone < 0.34 ? "calm" : d.host.tone < 0.67 ? "warm" : "playful"}`} hint="Warnings are always serious, whatever this is set to.">
            <input type="range" min={0} max={1} step={0.05} value={d.host.tone} onInput={(e) => setD((x) => ({ ...x, host: { ...x.host, tone: Number((e.target as HTMLInputElement).value) } }))} />
          </Field>
          <Field label="Topics to avoid" hint="Comma separated.">
            <input class="adm-input" value={d.host.bannedTopics.join(", ")} onInput={(e) => setD((x) => ({ ...x, host: { ...x.host, bannedTopics: (e.target as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean) } }))} />
          </Field>
        </div>
      </Card>

      <Card title="Current rundown" hint="What the broadcast is playing, refreshed every minute.">
        <div class="adm-row">
          <button type="button" class="adm-btn" onClick={() => void call("POST", "/api/admin/live/refresh").then(load)}>Rebuild now</button>
          <button type="button" class="adm-btn" onClick={load}>Reload</button>
        </div>
        {r ? (
          <>
            <p>
              <Chip kind={r.level === "CALM" ? "ok" : r.level === "ELEVATED" ? "info" : "danger"}>{r.level}</Chip> Index {r.score.toFixed(2)} · {r.status} · {r.topAlert}
            </p>
            {r.drivers.length > 0 && <p class="adm-hint">Because of: {r.drivers.join(", ")}</p>}
            {r.hold && <p><Chip kind="info">Holding: {r.hold}</Chip></p>}
            <ol>
              {r.items.slice(0, 30).map((i) => (
                <li key={i.key}>{i.headline} <span class="adm-hint">· {i.kind === "block" ? i.block : i.kind} · {i.durationSec}s{i.kind === "host" ? ` · ${i.source}` : ""}{i.speak ? " · spoken" : ""}</span></li>
              ))}
            </ol>
          </>
        ) : (
          <p class="adm-hint">No rundown yet. Turn the broadcast on, save, and it appears within a minute.</p>
        )}
      </Card>
    </Page>
  );
}
