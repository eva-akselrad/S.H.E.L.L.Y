import { ProductView } from "../studio/ProductView";
import { config, now, studioProducts } from "../state/store";

/** One Forecaster Studio graphic, rotating through whatever is published and valid. */
export function Studio() {
  const list = studioProducts.value.filter((p) => Date.parse(p.validTo) > now.value);
  if (list.length === 0) return <section class="seg"><p class="muted">No forecaster graphics right now.</p></section>;
  const p = list[Math.floor(now.value / 16_000) % list.length]!;
  return (
    <section class="seg seg-studio">
      <ProductView product={p} fmt="wide" forecaster={config.value.studio.forecasterName} />
    </section>
  );
}
