import { outlook } from "../state/store";

const COLOR: Record<string, string> = {
  NONE: "#3b4658", TSTM: "#2f9e44", MRGL: "#74b816", SLGT: "#f2c200", ENH: "#f76707", MDT: "#e03131", HIGH: "#d6336c",
};

export function Outlook() {
  const o = outlook.value;
  if (!o) return <p class="muted">Loading storm outlook…</p>;
  return (
    <section class="seg seg-outlook">
      <p class="muted">NOAA Storm Prediction Center convective outlook for your location</p>
      <ul class="spc">
        {o.days.map((d) => (
          <li key={d.day} style={{ "--c": COLOR[d.category] }}>
            <span>{d.day === 1 ? "Today" : d.day === 2 ? "Tomorrow" : "Day 3"}</span>
            <b>{d.label}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
