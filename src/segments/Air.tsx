import { aqiLabel, pollenLevel } from "../../shared/wx";
import { air } from "../state/store";

export function Air() {
  const a = air.value;
  if (!a) return <p class="muted">Loading air quality…</p>;
  const l = a.aqi == null ? null : aqiLabel(a.aqi);
  return (
    <section class="seg seg-air">
      <div class="aqi" style={{ "--c": l?.color ?? "#64748b" }}>
        <span class="muted">Air quality index</span>
        <b>{a.aqi ?? "--"}</b>
        <span>{l?.label ?? "Unavailable"}</span>
      </div>
      {a.pollen.length > 0 && (
        <ul class="pollen">
          {a.pollen.map((p) => (
            <li key={p.type}>
              <span>{p.type}</span>
              <b>{pollenLevel(p.value).label}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
