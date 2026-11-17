import { useState } from "preact/hooks";
import { choose, outputs, outputsUnlocked, sinkId, sinkLabel, sinkSupported, unlockOutputs } from "../audioOut";

/** "Play sound on…" picker. Desktop header, and the TV overlay (press S). */
export function SoundOutput() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!sinkSupported()) return null;

  const unlock = async () => {
    setBusy(true);
    setErr("");
    try {
      await unlockOutputs();
    } catch {
      setErr("The browser didn't allow it. Allow it in the address bar, then try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!outputsUnlocked.value) {
    return (
      <span class="sound-out">
        <button type="button" disabled={busy} onClick={() => void unlock()} title="Send SHELLY's music and voice to another speaker, like a TV">
          {sinkLabel.value ? `Sound: ${short(sinkLabel.value)}` : "Play sound on…"}
        </button>
        {err && <span class="err">{err}</span>}
      </span>
    );
  }

  const saved = sinkId.value;
  const missing = saved && !outputs.value.some((o) => o.id === saved);
  return (
    <label class="sound-out">
      <span class="sound-label">Play sound on</span>
      <select value={missing ? "" : saved} onChange={(e) => choose((e.target as HTMLSelectElement).value)}>
        <option value="">This computer's default</option>
        {outputs.value.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {missing && <span class="muted small">Your chosen speaker isn't connected. Using the default until it's back.</span>}
    </label>
  );
}

const short = (s: string) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);
