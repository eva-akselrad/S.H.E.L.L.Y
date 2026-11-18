import { config } from "../state/store";

/** Shown only while the broadcast is on and the admin has set a link (e.g. the YouTube livestream). */
export function WatchLive() {
  const { enabled, watchUrl } = config.value.live;
  if (!enabled || !watchUrl) return null;
  return (
    <a class="watch-live" href={watchUrl} target="_blank" rel="noopener noreferrer">
      <span class="watch-live-dot" aria-hidden="true" /> Watch SHELLY live
    </a>
  );
}
