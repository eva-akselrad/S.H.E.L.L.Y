import { useEffect, useState } from "preact/hooks";
import { titleFromFile } from "../music";
import { config, saveConfig } from "./api";
import { Card, Field, Page, Toggle } from "./ui";

interface Track {
  title: string;
  file: string;
}

export function Music() {
  const c = config.value.music;
  const [enabled, setEnabled] = useState(c.enabled);
  const [volume, setVolume] = useState(Math.round(c.volume * 100));
  const [off, setOff] = useState<Set<string>>(new Set(c.disabledTracks));
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    void fetch("/music/playlist.json")
      .then((r) => r.json() as Promise<{ tracks: Track[] }>)
      .then((p) => setTracks(p.tracks))
      .catch(() => setTracks([]));
  }, []);

  const flip = (file: string, on: boolean) => {
    const next = new Set(off);
    if (on) next.delete(file);
    else next.add(file);
    setOff(next);
  };

  const dirty =
    enabled !== c.enabled || volume !== Math.round(c.volume * 100) || [...off].sort().join("|") !== [...c.disabledTracks].sort().join("|");

  return (
    <Page
      title="Music"
      lead="Background music while it is calm. It ducks when conditions worsen and goes silent for emergencies."
      actions={<button type="button" class="adm-btn primary" disabled={!dirty} onClick={() => void saveConfig({ music: { enabled, volume: volume / 100, disabledTracks: [...off] } }, "Music settings saved")}>Save changes</button>}
    >
      <div class="adm-cols">
        <Card title="Playback">
          <div class="adm-form">
            <Toggle checked={enabled} onChange={setEnabled} label="Background music" hint="Off hides the music controls for everyone." />
            <Field label={`Calm-weather volume: ${volume}%`} hint="Warnings and emergencies lower it automatically.">
              <input class="adm-range" type="range" min={0} max={100} value={volume} onInput={(e) => setVolume(Number((e.target as HTMLInputElement).value))} />
            </Field>
          </div>
        </Card>
        <Card title={`Tracks (${tracks.length - off.size} of ${tracks.length} on)`}>
          <ul class="adm-items compact">
            {tracks.map((t) => (
              <li key={t.file}>
                <span>{titleFromFile(t.file)}</span>
                <input type="checkbox" role="switch" class="adm-check" checked={!off.has(t.file)} onChange={(e) => flip(t.file, (e.target as HTMLInputElement).checked)} aria-label={`Play ${t.title}`} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
