import { forecast } from "../state/store";

export function Text() {
  const periods = forecast.value?.text.slice(0, 4) ?? [];
  if (periods.length === 0) return <p class="muted">No forecaster text available.</p>;
  return (
    <section class="seg seg-text">
      {periods.map((p) => (
        <article key={p.name}>
          <h3>{p.name}</h3>
          <p>{p.detailed}</p>
        </article>
      ))}
    </section>
  );
}
