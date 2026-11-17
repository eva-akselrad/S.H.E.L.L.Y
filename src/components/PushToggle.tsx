import { disablePush, enablePush, pushState, pushWatches, setPushWatches } from "../push";
import { place } from "../state/store";

/** "Alert me" control for web and phone. Hidden when push isn't set up on the server or browser. */
export function PushToggle() {
  const s = pushState.value;
  const p = place.value;
  if (s === "unsupported" || s === "unconfigured" || !p) return null;
  if (s === "denied") return <span class="muted push-note">Notifications are blocked in this browser's settings.</span>;
  return (
    <span class="push">
      <button
        type="button"
        aria-pressed={s === "on"}
        disabled={s === "busy"}
        onClick={() => void (s === "on" ? disablePush() : enablePush(p))}
        title={`Warnings whose area covers ${p.name} are sent to this device, day or night.`}
      >
        {s === "on" ? "Alerts on" : "Alert me"}
      </button>
      {s === "on" && (
        <label class="push-watch">
          <input type="checkbox" checked={pushWatches.value} onChange={(e) => setPushWatches((e.target as HTMLInputElement).checked, p)} />
          Watches too (not 10 PM–7 AM)
        </label>
      )}
    </span>
  );
}
