import { useState } from "preact/hooks";
import { detectMode } from "../mode";
import { readDismissed, shouldShowAppBanner, writeDismissed } from "../installApp";

/** Android browsers only: a dismissible nudge toward the SHELLY app. */
export function InstallApp() {
  const [hidden, setHidden] = useState(false);
  if (hidden || !shouldShowAppBanner({ ua: navigator.userAgent, mode: detectMode(), dismissedAt: readDismissed(), now: Date.now() })) return null;
  return (
    <section class="install-app" aria-label="Get the SHELLY app">
      <p>
        <b>Get the SHELLY app:</b> warnings for where you are, even with the app closed, and a home-screen widget.
      </p>
      <div class="install-app-actions">
        <a class="btn" href="/get-android/">Get the app</a>
        <button
          type="button"
          onClick={() => {
            writeDismissed(Date.now());
            setHidden(true);
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
