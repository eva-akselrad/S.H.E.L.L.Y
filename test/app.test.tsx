// @vitest-environment happy-dom
import { render } from "preact";
import { afterEach, expect, test, vi } from "vitest";
import type { Alert, Forecast, Place } from "../shared/types";

vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 500 })));
vi.mock("../src/segments/Radar", () => ({ Radar: () => <div class="radar-stub" /> }));

const place: Place = {
  lat: 31, lon: -97, name: "Waco", state: "TX", tz: "America/Chicago", office: "FWD", gridX: 1, gridY: 1,
  forecastZone: "TXZ1", countyZone: "TXC1", fireZone: "TXZ1",
};
const ring = [[-98, 30], [-96, 30], [-96, 32], [-98, 32], [-98, 30]];
const tornadoWarning = (params: Alert["params"] = {}): Alert => ({
  id: "tor1", event: "Tornado Warning", severity: "Extreme", urgency: "Immediate", certainty: "Likely",
  headline: "Tornado Warning issued", description: "Take cover now.", instruction: "Move to an interior room.",
  sent: new Date().toISOString(), onset: null, expires: new Date(Date.now() + 20 * 60_000).toISOString(),
  areaDesc: "Waco; McLennan", zones: ["TXC1"], geometry: { type: "Polygon", coordinates: [ring] }, params,
});
const forecast: Forecast = {
  fetchedAt: "", hourly: [], daily: [], nowcast: [], text: [],
  current: {
    temp: 70, feelsLike: 70, humidity: 50, dewPoint: 50, windSpeed: 5, windGust: 8, windDir: 90, pressure: 30,
    visibilityMi: 10, uv: 3, cloud: 10, code: 0, isDay: true, precip: 0, time: "",
  },
};

async function mount() {
  const store = await import("../src/state/store");
  const { App } = await import("../src/app");
  store.place.value = place;
  store.forecast.value = forecast;
  
  store.mode.value = "web";
  const root = document.createElement("div");
  document.body.append(root);
  render(<App />, root);
  return { store, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
});

test("calm: no takeover", async () => {
  const { root } = await mount();
  expect(root.querySelector(".takeover")).toBeNull();
});

test("Tornado Warning fixture shows the WARNING takeover", async () => {
  const { store, root } = await mount();
  store.alerts.value = [tornadoWarning()];
  await Promise.resolve();
  const el = root.querySelector(".takeover.warning");
  expect(el).not.toBeNull();
  expect(el?.textContent).toContain("Tornado Warning");
  expect(root.querySelector(".tk-count")?.textContent).toMatch(/^\d+:\d{2}$/);
});

test("observed tornado escalates to the EMERGENCY takeover", async () => {
  const { store, root } = await mount();
  store.alerts.value = [tornadoWarning({ tornadoDetection: "OBSERVED" })];
  await Promise.resolve();
  expect(root.querySelector(".takeover.emergency")).not.toBeNull();
});
