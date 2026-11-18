import { useState } from "preact/hooks";
import { BLOCK_IDS, BLOCK_INFO, BULLETIN_LEVELS, DEFAULT_PLAYLIST, type BlockId, type BulletinLevel, type LiveControl, type PlaylistEntry } from "../../shared/live/blocks";
import type { LiveCity } from "../../shared/config";
import type { Rundown } from "../../shared/live/rundown";
import { call } from "./api";
import { toast } from "./toast";
import { Card, Chip, Field, Segmented, Toggle } from "./ui";

interface ControlReply {
  control: LiveControl;
  rundown: Rundown | null;
}

const BUL_NAME: Record<BulletinLevel, string> = { info: "Bulletin", advisory: "Advisory", alert: "Alert" };

function CityPick({ cities, value, onChange }: { cities: LiveCity[]; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <select class="adm-input" style={{ width: "11rem" }} value={value ?? ""} onChange={(e) => onChange((e.target as HTMLSelectElement).value)} aria-label="City">
      <option value="">{cities[0] ? `${cities[0].name} (first city)` : "First city"}</option>
      {cities.slice(1).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select>
  );
}

/** Live buttons: everything here goes on air within a few seconds. */
export function OnAir({ control, cities, llmOn, onChange }: { control: LiveControl | null; cities: LiveCity[]; llmOn: boolean; onChange: (r: ControlReply) => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"you" | "ai">("you");
  const [ask, setAsk] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [block, setBlock] = useState<BlockId>("tempsNow");
  const [city, setCity] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [bul, setBul] = useState({ level: "info" as BulletinLevel, title: "", area: "", body: "", hours: 3, speak: true });

  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await call<ControlReply>("POST", "/api/admin/live/control", body);
    if (r.ok) {
      onChange(r.data);
      toast(r.data.rundown ? ok : "Saved, but the broadcast is switched off.");
    } else toast("That didn't go through.", "error");
    return r.ok;
  };

  const entry = (): PlaylistEntry => ({ id: "cue", block, on: true, ...(BLOCK_INFO[block].city && city ? { city } : {}) });

  const draft = async () => {
    if (!ask.trim()) return toast("Say what you want the line to be about.", "error");
    setDrafting(true);
    const r = await call<{ ok: boolean; text?: string; error?: string }>("POST", "/api/admin/live/ai-line", { prompt: ask });
    setDrafting(false);
    if (r.ok && r.data.ok && r.data.text) {
      setText(r.data.text);
      setSource("ai");
      toast("Draft ready. Read it, edit it if you like, then press Say it now.");
    } else toast(r.ok ? (r.data.error ?? "No reply") : "The AI request failed.", "error");
  };

  const say = async () => {
    if (!text.trim()) return toast("Type something for SHELLY to say.", "error");
    if (await act({ action: "say", text, source }, "SHELLY says it next")) {
      setText("");
      setSource("you");
    }
  };

  const pushBulletin = async () => {
    if (!bul.title.trim() || !bul.body.trim()) return toast("A bulletin needs a title and text.", "error");
    const r = await call<ControlReply>("POST", "/api/admin/live/bulletin", bul);
    if (r.ok) {
      onChange(r.data);
      setBul({ ...bul, title: "", area: "", body: "" });
      toast("Bulletin is on air");
    } else toast("Couldn't send the bulletin.", "error");
  };
  const removeBulletin = async (id: string) => {
    const r = await call<ControlReply>("DELETE", `/api/admin/live/bulletin?id=${encodeURIComponent(id)}`);
    if (r.ok) onChange(r.data);
  };

  const hold = control?.hold;
  return (
    <>
      <Card title="On air now" hint="These act on the broadcast within a few seconds. NWS warnings always break through a hold.">
        <div class="adm-row">
          <button type="button" class="adm-btn" onClick={() => void act({ action: "skip" }, "Skipped")}>Skip this item</button>
          <button type="button" class="adm-btn" onClick={() => void act({ action: "top" }, "Back to the top")}>Back to the top</button>
          {hold ? (
            <>
              <Chip kind="info">Holding {BLOCK_INFO[hold.entry.block].label} until {new Date(hold.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Chip>
              <button type="button" class="adm-btn" onClick={() => void act({ action: "release" }, "Hold released")}>Release hold</button>
            </>
          ) : null}
        </div>
      </Card>

      <Card title="Make SHELLY say something" hint="SHELLY reads your words next, on screen and out loud. Or have the AI write a line: it only fills the box, and nothing airs until you press Say it now.">
        <div class="adm-form">
          <Field label={source === "ai" ? "What SHELLY will say (AI draft, edit freely)" : "What SHELLY will say"}>
            <textarea class="adm-input" rows={3} maxLength={400} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="Good evening everyone! Clear skies tonight, a great night to look for the meteor shower." />
          </Field>
          <div class="adm-row">
            <button type="button" class="adm-btn primary" onClick={() => void say()}>Say it now</button>
            <span class="adm-hint">{text.length}/400</span>
          </div>
          <Field label="Ask the AI for a line" hint={llmOn ? "For example: welcome people who just tuned in, or a fun fact about November weather. Uses 1 AI request." : "Turn on the AI host below and save to use this."}>
            <div class="adm-row">
              <input class="adm-input grow" maxLength={300} value={ask} onInput={(e) => setAsk((e.target as HTMLInputElement).value)} placeholder="Welcome everyone who just joined the stream" />
              <button type="button" class="adm-btn" disabled={drafting || !llmOn} onClick={() => void draft()}>{drafting ? "Writing…" : "Write it"}</button>
            </div>
          </Field>
        </div>
      </Card>

      <Card title="Put a block on screen" hint="Play next shows it once, right away. Hold keeps only that block on screen until the time runs out or you release it.">
        <div class="adm-row">
          <select class="adm-input" style={{ width: "16rem" }} value={block} onChange={(e) => setBlock((e.target as HTMLSelectElement).value as BlockId)} aria-label="Block">
            {BLOCK_IDS.filter((b) => b !== "message").map((b) => <option key={b} value={b}>{BLOCK_INFO[b].label}</option>)}
          </select>
          {BLOCK_INFO[block].city && <CityPick cities={cities} value={city} onChange={setCity} />}
          <button type="button" class="adm-btn primary" onClick={() => void act({ action: "cue", entry: entry() }, "Playing next")}>Play next</button>
          <input class="adm-input narrow" type="number" min={1} max={240} value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value))} aria-label="Hold minutes" />
          <button type="button" class="adm-btn" onClick={() => void act({ action: "hold", entry: entry(), minutes }, `Holding for ${minutes} min`)}>Hold (min)</button>
        </div>
        <p class="adm-hint">{BLOCK_INFO[block].hint}</p>
      </Card>

      <Card title="Your bulletins" hint="Your own alerts, shown full screen, on the alerts board and in the crawl. They're labelled SHELLY and say they aren't official NWS alerts. They don't change the SHELLY index.">
        <div class="adm-form">
          <div class="adm-field">
            <span class="adm-label">Level</span>
            <Segmented label="Level" value={bul.level} onChange={(v) => setBul({ ...bul, level: v })} options={BULLETIN_LEVELS.map((l) => ({ value: l, label: BUL_NAME[l] }))} />
          </div>
          <Field label="Title"><input class="adm-input" maxLength={80} value={bul.title} onInput={(e) => setBul({ ...bul, title: (e.target as HTMLInputElement).value })} placeholder="Black ice likely on untreated roads" /></Field>
          <Field label="Area (optional)"><input class="adm-input" maxLength={120} value={bul.area} onInput={(e) => setBul({ ...bul, area: (e.target as HTMLInputElement).value })} placeholder="Lehigh Valley and the Poconos" /></Field>
          <Field label="Text"><textarea class="adm-input" rows={3} maxLength={600} value={bul.body} onInput={(e) => setBul({ ...bul, body: (e.target as HTMLTextAreaElement).value })} /></Field>
          <div class="adm-row">
            <Field label="Hours on air"><input class="adm-input narrow" type="number" min={0.25} max={48} step={0.25} value={bul.hours} onInput={(e) => setBul({ ...bul, hours: Number((e.target as HTMLInputElement).value) })} /></Field>
            <Toggle checked={bul.speak} onChange={(v) => setBul({ ...bul, speak: v })} label="SHELLY reads it out loud" />
          </div>
          <div class="adm-row"><button type="button" class="adm-btn primary" onClick={() => void pushBulletin()}>Put it on air</button></div>
          {(control?.bulletins ?? []).map((b) => (
            <div key={b.id} class="adm-row" style={{ justifyContent: "space-between" }}>
              <span><Chip kind={b.level === "alert" ? "danger" : b.level === "advisory" ? "warn" : "info"}>{BUL_NAME[b.level]}</Chip> <b>{b.title}</b> <span class="adm-hint">until {new Date(b.until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span></span>
              <button type="button" class="adm-btn small danger" onClick={() => void removeBulletin(b.id)}>Take down</button>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/** The rotation. Saved with the page's Save button. */
export function PlaylistEditor({ list, cities, onChange, onCue }: { list: PlaylistEntry[]; cities: LiveCity[]; onChange: (l: PlaylistEntry[]) => void; onCue: (e: PlaylistEntry) => void }) {
  const [add, setAdd] = useState<BlockId>("feelsNow");
  const patch = (i: number, p: Partial<PlaylistEntry>) => onChange(list.map((e, n) => (n === i ? { ...e, ...p } : e)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const total = list.filter((e) => e.on).reduce((s, e) => s + (e.seconds ?? BLOCK_INFO[e.block].seconds) * (e.block === "cities" ? e.count || 2 : 1), 0);

  return (
    <Card title="Rundown builder" hint="The order SHELLY plays on calm days. On watch days it adds watches and radar; during warnings these fill the gaps between warning read-outs. Press Save at the top to apply.">
      <p class="adm-hint">{list.filter((e) => e.on).length} blocks on · about {Math.round(total / 60)} min per loop (spoken items can run longer).</p>
      <ol class="adm-playlist">
        {list.map((e, i) => {
          const info = BLOCK_INFO[e.block];
          return (
            <li key={e.id} class={e.on ? "" : "off"}>
              <div class="adm-row">
                <input type="checkbox" checked={e.on} onChange={(ev) => patch(i, { on: (ev.target as HTMLInputElement).checked })} aria-label={`${info.label} on`} />
                <b style={{ minWidth: "13rem" }}>{info.label}</b>
                <input class="adm-input narrow" type="number" min={5} max={180} placeholder={String(info.seconds)} value={e.seconds ?? ""} onInput={(ev) => { const v = (ev.target as HTMLInputElement).value; patch(i, { seconds: v ? Number(v) : undefined }); }} aria-label="Seconds" title="Seconds on screen" />
                <span class="adm-hint">sec</span>
                {info.count && (
                  <>
                    <input class="adm-input narrow" type="number" min={0} max={50} value={e.count ?? (e.block === "cities" ? 2 : 0)} onInput={(ev) => patch(i, { count: Number((ev.target as HTMLInputElement).value) })} aria-label="How many" title={e.block === "studio" ? "0 = all published" : "How many cities"} />
                    <span class="adm-hint">{e.block === "studio" ? "graphics (0 = all)" : "cities"}</span>
                  </>
                )}
                {info.city && <CityPick cities={cities} value={e.city} onChange={(v) => patch(i, { city: v || undefined })} />}
                <span class="grow" />
                <button type="button" class="adm-btn small" onClick={() => onCue(e)} title="Play this next">Play next</button>
                <button type="button" class="adm-btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" class="adm-btn small" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Move down">↓</button>
                <button type="button" class="adm-btn small danger" onClick={() => onChange(list.filter((_, n) => n !== i))} aria-label="Remove">✕</button>
              </div>
              {e.block === "message" && (
                <div class="adm-form" style={{ marginTop: ".5rem" }}>
                  <input class="adm-input" maxLength={80} placeholder="Title" value={e.title ?? ""} onInput={(ev) => patch(i, { title: (ev.target as HTMLInputElement).value })} />
                  <textarea class="adm-input" rows={2} maxLength={400} placeholder="Your message" value={e.text ?? ""} onInput={(ev) => patch(i, { text: (ev.target as HTMLTextAreaElement).value })} />
                  <Toggle checked={!!e.speak} onChange={(v) => patch(i, { speak: v })} label="SHELLY reads it out loud" />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div class="adm-row">
        <select class="adm-input" style={{ width: "16rem" }} value={add} onChange={(ev) => setAdd((ev.target as HTMLSelectElement).value as BlockId)} aria-label="Block to add">
          {BLOCK_IDS.map((b) => <option key={b} value={b}>{BLOCK_INFO[b].label}</option>)}
        </select>
        <button type="button" class="adm-btn" onClick={() => onChange([...list, { id: `p${Date.now().toString(36)}`, block: add, on: true, ...(add === "cities" ? { count: 2 } : {}) }])}>Add block</button>
        <button type="button" class="adm-btn" onClick={() => { if (confirm("Put the rundown back to SHELLY's default order?")) onChange(DEFAULT_PLAYLIST); }}>Reset to default</button>
      </div>
      <p class="adm-hint">{BLOCK_INFO[add].hint}</p>
    </Card>
  );
}
