import { useEffect, useState } from "preact/hooks";
import { updateMessage } from "../installApp";
import { appBridge, parseAppPermissions, parseAppPrefs } from "../native";

/** "App alerts" controls. Only shows inside the SHELLY Android app (native alerts replace web push there). */
export function AppAlerts() {
  const app = appBridge();
  const [prefs, setPrefs] = useState(() => parseAppPrefs(app?.getAlertPrefs()));
  const [open, setOpen] = useState(false);
  const [upd, setUpd] = useState<{ text: string; needsPermission: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [perm, setPerm] = useState(() => parseAppPermissions(app?.permissionStatus()));
  // coming back from a Settings screen: re-read what the user granted
  useEffect(() => {
    if (!app) return;
    const refresh = () => setPerm(parseAppPermissions(app.permissionStatus()));
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [app]);
  if (!app) return null;

  const checkUpdate = () => {
    setChecking(true);
    setUpd(null);
    const done = (e: Event) => {
      window.removeEventListener("shelly-update", done);
      clearTimeout(timer);
      setChecking(false);
      setUpd(updateMessage((e as CustomEvent<{ outcome?: string }>).detail?.outcome, app.version()));
    };
    const timer = setTimeout(() => {
      window.removeEventListener("shelly-update", done);
      setChecking(false);
      setUpd({ text: "Checking in the background. If there is an update, it installs by itself.", needsPermission: false });
    }, 20_000);
    window.addEventListener("shelly-update", done);
    app.checkForUpdate?.();
  };

  const save = (next: typeof prefs) => {
    setPrefs(next);
    app.setAlertPrefs(JSON.stringify(next));
  };
  const quiet = prefs.quietStart !== null && prefs.quietEnd !== null;
  const allSet = perm.notifications && perm.location && perm.background;

  // Once the required permissions are granted the panel folds away; the optional checkboxes never keep it open.
  if (allSet && !open) {
    return (
      <button type="button" class="app-alerts-chip" onClick={() => setOpen(true)} aria-expanded={false}>
        App alerts: on · Settings
      </button>
    );
  }

  return (
    <section class="app-alerts" aria-label="App alerts">
      <b>App alerts</b>
      <p class="muted app-alerts-note">
        {allSet
          ? "Warnings for where you are, even with the app closed."
          : !perm.notifications
            ? "Notifications are off, so warnings can't reach you."
            : !perm.location
              ? "Location is off, so SHELLY can't tell where you are."
              : "Set Location to \"Allow all the time\" so warnings work with the app closed."}
      </p>
      <label class="push-watch">
        <input type="checkbox" checked={prefs.watches} onChange={(e) => save({ ...prefs, watches: (e.target as HTMLInputElement).checked })} />
        Watches and advisories too
      </label>
      <label class="push-watch">
        <input type="checkbox" checked={prefs.lightning} onChange={(e) => save({ ...prefs, lightning: (e.target as HTMLInputElement).checked })} />
        Lightning within about 10 miles of me (quiet notification, not an NWS alert)
      </label>
      <label class="push-watch">
        <input
          type="checkbox"
          checked={quiet}
          onChange={(e) => save((e.target as HTMLInputElement).checked ? { ...prefs, quietStart: 22, quietEnd: 7 } : { ...prefs, quietStart: null, quietEnd: null })}
        />
        Quiet hours for watches and lightning, 10 PM to 7 AM (warnings always come through)
      </label>
      <span class="app-alerts-buttons">
        <button type="button" onClick={() => app.runSetup()}>Check setup</button>
        <button type="button" onClick={() => app.openNotificationSettings()}>Warning sound settings</button>
        {allSet && <button type="button" onClick={() => setOpen(false)}>Done</button>}
      </span>
      <span class="app-alerts-buttons">
        <button type="button" onClick={checkUpdate} disabled={checking}>{checking ? "Checking..." : "Check for updates"}</button>
        {upd?.needsPermission && <button type="button" onClick={() => app.openInstallSettings?.()}>Open settings</button>}
      </span>
      <p class="muted app-alerts-note" role="status">{upd ? upd.text : `SHELLY app version ${app.version()}`}</p>
    </section>
  );
}
