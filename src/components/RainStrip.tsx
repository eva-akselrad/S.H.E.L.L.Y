import { rain } from "../state/store";

/** "Rain likely in about 15 min" plus a 15-minute bar strip for the next few hours. */
export function RainStrip() {
  const r = rain.value;
  if (!r || r.kind === "none") return null;
  const label = (t: string) => {
    const d = new Date(t.length === 16 ? `${t}:00` : t);
    return d.getMinutes() === 0 ? d.toLocaleTimeString("en-US", { hour: "numeric" }) : "";
  };
  return (
    <div class={`rainstrip k-${r.kind} t-${r.type}`}>
      <p class="rain-line">{r.sentence}</p>
      {r.kind !== "dry" && (
        <div class="rain-bars" role="img" aria-label={r.sentence}>
          {r.bars.map((b) => (
            <span key={b.time} class="rb">
              <i style={{ height: `${Math.max(b.wet ? 12 : 3, b.level * 100)}%` }} class={b.wet ? "wet" : ""} />
              <small>{label(b.time)}</small>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
