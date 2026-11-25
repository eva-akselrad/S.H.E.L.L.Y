import type * as Leaflet from "leaflet";

export const EXPLAIN = "SHELLY moves today's storms forward along their path. It can't see new storms forming or old ones dying.";

export interface LoopSlots {
  /** frames before "now", then "now" itself (the last past frame) */
  past: number;
  /** minutes ahead of each future frame */
  leads: number[];
}

export interface FutureControl {
  /** highlight slot i (0..past-1 are past, then future) */
  update(i: number): void;
  setLeads(leads: number[]): void;
  destroy(): void;
}

/**
 * Past | Now | Future timeline and the "Future (estimate)" badge, as a Leaflet control so Leaflet and Preact never share DOM.
 * `explain: "button"` gives an interactive "?"; "line" prints the sentence (for the broadcast page, which nobody can click).
 */
export function addFutureControl(L: typeof Leaflet, map: Leaflet.Map, past: number, explain: "button" | "line"): FutureControl {
  let leads: number[] = [];
  const root = L.DomUtil.create("div", "fr-control");
  L.DomEvent.disableClickPropagation(root);
  const top = L.DomUtil.create("div", "fr-top", root);
  const badge = L.DomUtil.create("div", "fr-badge", top);
  const q = L.DomUtil.create("button", "fr-q", top);
  const bar = L.DomUtil.create("div", "fr-bar", root);
  const labels = L.DomUtil.create("div", "fr-labels", root);
  labels.innerHTML = "<span>Past</span><span>Now</span><span>Future</span>";
  let tip: HTMLElement | null = null;
  if (explain === "line") {
    const p = L.DomUtil.create("div", "fr-explain", root);
    p.textContent = EXPLAIN;
  }

  const build = () => {
    bar.innerHTML = "";
    for (let n = 0; n < past; n++) {
      const c = L.DomUtil.create("i", n === past - 1 ? "fr-cell now" : "fr-cell past", bar);
      c.dataset.i = String(n);
    }
    leads.forEach((m, n) => {
      const c = L.DomUtil.create("i", "fr-cell future", bar);
      c.dataset.i = String(past + n);
      c.title = `+${m} min (estimate)`;
    });
    labels.style.display = leads.length ? "" : "none";
    q.style.display = leads.length && explain === "button" ? "" : "none";
  };
  build();
  badge.style.display = "none";
  q.type = "button";
  q.textContent = "?";
  q.style.display = "none";
  q.setAttribute("aria-label", "What is the future radar?");
  if (explain === "button") {
    q.onclick = () => {
      if (tip) { tip.remove(); tip = null; return; }
      tip = document.createElement("div");
      tip.className = "fr-tip";
      tip.textContent = EXPLAIN;
      root.append(tip);
    };
  }

  const Ctl = L.Control.extend({ onAdd: () => root });
  const ctl = new Ctl({ position: "topleft" });
  ctl.addTo(map);

  return {
    setLeads(l) {
      leads = l;
      build();
    },
    update(i) {
      bar.querySelectorAll<HTMLElement>(".fr-cell").forEach((c) => c.classList.toggle("on", Number(c.dataset.i) === i));
      const fut = i >= past ? leads[i - past] : undefined;
      badge.style.display = fut ? "" : "none";
      if (fut) {
        badge.textContent = "";
        const t = document.createElement("span");
        t.textContent = `Future (estimate) · +${fut} min`;
        badge.append(t);
      }
    },
    destroy() {
      ctl.remove();
    },
  };
}
