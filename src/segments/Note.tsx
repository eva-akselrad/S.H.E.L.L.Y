import { config } from "../state/store";

/** Free-text message from the forecaster (admin-written). */
export function Note() {
  const n = config.value.note;
  return (
    <section class="seg seg-note">
      {n.title && <h3>{n.title}</h3>}
      <p>{n.body}</p>
    </section>
  );
}
