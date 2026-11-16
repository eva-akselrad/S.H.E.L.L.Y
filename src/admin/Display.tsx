import { useEffect, useState } from "preact/hooks";
import { MODES, SEGMENT_IDS, SPEAKERS, THEMES, type SiteConfig, type Speaker } from "../../shared/config";
import { SCENES } from "../../shared/scene";
import type { SegmentId } from "../../shared/scheduler";
import { SEGMENTS } from "../../shared/scheduler";
import type { Place } from "../../shared/types";
import { call, config, saveConfig } from "./api";
import { toast } from "./toast";
import { Card, Field, Page, Segmented, Toggle } from "./ui";

const TITLES: Record<SegmentId, string> = {
  now: "Right now",
  radar: "Radar",
  hourly: "Next 24 hours",
  daily: "Extended forecast",
  text: "Forecaster discussion (NWS text)",
  outlook: "Storm outlook (SPC)",
  air: "Air quality and pollen",
  almanac: "Sun and moon",
  note: "Forecaster note",
  studio: "Forecaster Studio graphics",
};
const DEFAULT_SECONDS = Object.fromEntries(SEGMENTS.map((s) => [s.id, s.seconds])) as Record<SegmentId, number>;

const MODE_LABEL = { auto: "Auto-detect", kiosk: "Kiosk / TV", web: "Desktop", phone: "Phone" } as const;
const THEME_LABEL = { auto: "Match device", light: "Light", dark: "Dark" } as const;

export function Display() {
  const c = config.value;
  const [draft, setDraft] = useState<SiteConfig>(c);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Place | null>(null);
  const [searching, setSearching] = useState(false);

  const [used, setUsed] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    void call<{ voice?: { used: number } }>("GET", "/api/admin/status").then((r) => {
      if (r.ok) setUsed(r.data.voice?.used ?? null);
    });
  }, []);

  const preview = async (speaker: Speaker) => {
    setPlaying(true);
    try {
      const res = await fetch("/api/admin/tts-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speaker }),
      });
      if (!res.ok) {
        toast(res.status === 429 ? "Daily voice cap reached" : "Voice preview failed", "error");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      void call<{ voice?: { used: number } }>("GET", "/api/admin/status").then((r) => {
        if (r.ok) setUsed(r.data.voice?.used ?? null);
      });
    } catch {
      toast("Could not play the preview", "error");
    } finally {
      setPlaying(false);
    }
  };

  const set = <K extends keyof SiteConfig>(k: K, v: SiteConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(c);

  const search = async (e: Event) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    const r = await call<Place>("GET", `/api/location?q=${encodeURIComponent(query.trim())}`);
    setSearching(false);
    if (r.ok) setFound(r.data);
    else {
      setFound(null);
      toast("No US location found for that search", "error");
    }
  };

  const setSeconds = (id: SegmentId, v: string) => {
    const next = { ...draft.segmentSeconds };
    if (v === "") delete next[id];
    else next[id] = Number(v);
    set("segmentSeconds", next);
  };
  const toggleSegment = (id: SegmentId, show: boolean) =>
    set("hiddenSegments", show ? draft.hiddenSegments.filter((x) => x !== id) : [...draft.hiddenSegments, id]);

  return (
    <Page
      title="Display settings"
      lead="Defaults applied to every screen. Visitors can still change their own theme and location."
      actions={
        <>
          {dirty && <button type="button" class="adm-btn" onClick={() => setDraft(c)}>Discard</button>}
          <button type="button" class="adm-btn primary" disabled={!dirty} onClick={() => void saveConfig(draft, "Display settings saved")}>Save changes</button>
        </>
      }
    >
      <Card title="Default location" hint="A new screen starts here instead of asking for a location. Great for a TV or a stream machine.">
        <p class="adm-current">
          {draft.defaultLocation ? <>Currently <b>{draft.defaultLocation.name}{draft.defaultLocation.state ? `, ${draft.defaultLocation.state}` : ""}</b></> : "No default set."}
          {draft.defaultLocation && <button type="button" class="adm-link" onClick={() => set("defaultLocation", null)}>Clear</button>}
        </p>
        <form class="adm-row" onSubmit={search}>
          <input class="adm-input grow" placeholder="City or ZIP" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} aria-label="Search for a US location" />
          <button class="adm-btn" type="submit" disabled={searching}>{searching ? "Searching…" : "Look up"}</button>
        </form>
        {found && (
          <div class="adm-found">
            <span><b>{found.name}{found.state ? `, ${found.state}` : ""}</b> <span class="adm-hint">NWS office {found.office}</span></span>
            <button type="button" class="adm-btn small primary" onClick={() => { set("defaultLocation", found); setFound(null); setQuery(""); }}>Use as default</button>
          </div>
        )}
      </Card>

      <Card title="Weather scenes" hint="The whole display takes on the mood of the weather outside: sunny sky, rain, snow, fog, thunderstorms with lightning, starry nights. Warnings and emergencies still take over the screen.">
        <Toggle checked={draft.scenes} onChange={(v) => set("scenes", v)} label="Change the look with the weather" hint="When on, the theme toggle is hidden because the sky decides the colors." />
        <span class="adm-label">Preview a scene</span>
        <div class="adm-row">
          {SCENES.map((s) => (
            <a key={s.id} class="adm-btn small" href={`/?scene=${s.id}`} target="_blank" rel="noreferrer">{s.label}</a>
          ))}
        </div>
      </Card>

      <div class="adm-cols">
        <Card title="Layout and theme">
          <div class="adm-form">
            <div class="adm-field">
              <span class="adm-label">Default layout</span>
              <Segmented label="Layout" value={draft.defaultMode} onChange={(v) => set("defaultMode", v)} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
              <span class="adm-hint">Visitors can always override with ?mode=kiosk, web or phone in the address.</span>
            </div>
            <div class="adm-field">
              <span class="adm-label">Default theme</span>
              <Segmented label="Theme" value={draft.defaultTheme} onChange={(v) => set("defaultTheme", v)} options={THEMES.map((t) => ({ value: t, label: THEME_LABEL[t] }))} />
              <span class="adm-hint">Used until a visitor picks their own with the theme button. The kiosk view is always dark.</span>
            </div>
          </div>
        </Card>

        <Card title="Alerts and sound">
          <div class="adm-form">
            <Toggle checked={draft.tts} onChange={(v) => set("tts", v)} label="Read warnings aloud" hint="Spoken text-to-speech for warnings and emergencies. Needs a tap on the Start screen to unlock audio." />
            <div class="adm-field">
              <span class="adm-label">Voice</span>
              <Segmented
                label="Voice engine"
                value={draft.voice.engine}
                onChange={(v) => set("voice", { ...draft.voice, engine: v })}
                options={[{ value: "ai", label: "Natural (AI)" }, { value: "browser", label: "Browser voice" }]}
              />
              <span class="adm-hint">Natural voices are generated on the server (about $0.03 per 1,000 characters, cached so each alert is only generated once). If it fails or hits the cap, viewers get the browser voice instead.</span>
            </div>
            {draft.voice.engine === "ai" && (
              <>
                <div class="adm-field">
                  <label class="adm-label" for="speaker">Speaker</label>
                  <div class="adm-row">
                    <select id="speaker" class="adm-input grow" value={draft.voice.speaker} onChange={(e) => set("voice", { ...draft.voice, speaker: (e.target as HTMLSelectElement).value as Speaker })}>
                      {SPEAKERS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                    <button type="button" class="adm-btn" disabled={playing} onClick={() => void preview(draft.voice.speaker)}>{playing ? "Playing…" : "Preview"}</button>
                  </div>
                </div>
                <div class="adm-field">
                  <label class="adm-label" for="cap">Daily character cap</label>
                  <input id="cap" class="adm-input narrow" type="number" min={0} max={200000} step={1000} value={draft.voice.dailyCharCap} onInput={(e) => set("voice", { ...draft.voice, dailyCharCap: Number((e.target as HTMLInputElement).value) })} />
                  <span class="adm-hint">
                    Hard limit per UTC day (a warning is roughly 500 characters, so 20,000 is about 40 fresh alerts).
                    {used !== null && <> Used today: <b>{used.toLocaleString()}</b>.</>}
                  </span>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card title="Segments" hint="Choose what appears in the rotation and for how long. The threat level can still shorten the loop or add radar when conditions get worse.">
        <div class="adm-table" role="table">
          <div class="adm-tr head" role="row"><span>Segment</span><span>Show</span><span>Seconds</span></div>
          {SEGMENT_IDS.map((id) => (
            <div class="adm-tr" role="row" key={id}>
              <span>{TITLES[id]}</span>
              <span>
                <input type="checkbox" role="switch" class="adm-check" disabled={id === "now"} checked={!draft.hiddenSegments.includes(id)} onChange={(e) => toggleSegment(id, (e.target as HTMLInputElement).checked)} aria-label={`Show ${TITLES[id]}`} />
              </span>
              <span>
                <input class="adm-input narrow" type="number" min={5} max={120} placeholder={String(DEFAULT_SECONDS[id])} value={draft.segmentSeconds[id] ?? ""} onInput={(e) => setSeconds(id, (e.target as HTMLInputElement).value)} aria-label={`Seconds for ${TITLES[id]}`} />
              </span>
            </div>
          ))}
        </div>
        <p class="adm-hint">Leave seconds empty for the default. "Right now" always stays on so the loop is never empty.</p>
      </Card>
    </Page>
  );
}
