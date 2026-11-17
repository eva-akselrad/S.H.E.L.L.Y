import { useEffect, useState } from "preact/hooks";
import { appBridge, parseAppPermissions, parseAppPrefs } from "../native";

/** "App alerts" controls. Only shows inside the SHELLY Android app (native alerts replace web push there). */
export function AppAlerts() {
  const app = appBridge();
  const [prefs, setPrefs] = useState(() => parseAppPrefs(app?.getAlertPrefs()));
  const [open, setOpen] = useState(false);
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
        <input
          type="checkbox"
          checked={quiet}
          onChange={(e) => save((e.target as HTMLInputElement).checked ? { ...prefs, quietStart: 22, quietEnd: 7 } : { ...prefs, quietStart: null, quietEnd: null })}
        />
        Quiet hours for watches, 10 PM to 7 AM (warnings always come through)
      </label>
      <span class="app-alerts-buttons">
        <button type="button" onClick={() => app.runSetup()}>Check setup</button>
        <button type="button" onClick={() => app.openNotificationSettings()}>Warning sound settings</button>
        {allSet && <button type="button" onClick={() => setOpen(false)}>Done</button>}
      </span>
    </section>
  );
}
