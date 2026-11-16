import { effect } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Logo, SearchBox } from "./components/Chrome";
import { applyThreatToMusic, musicOn, refreshMusic, startMusic } from "./music";
import { KioskShell } from "./shells/Kiosk";
import { PhoneShell } from "./shells/Phone";
import { WebShell } from "./shells/Web";
import { config, locateByCoords, mode, place, started, startCycling, startPollers, threat } from "./state/store";
import { Takeover } from "./takeover/Takeover";
import { announce } from "./tts";

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  startPollers();
  startCycling();
  effect(() => {
    const t = threat.value;
    applyThreatToMusic(t.level);
    announce(t.level, t.active, t.primary, started.value && config.value.tts, {
      ai: config.value.voice.engine === "ai",
      lat: place.value?.lat ?? 0,
      lon: place.value?.lon ?? 0,
    });
  });
  effect(() => {
    void musicOn.value;
    refreshMusic();
  });
}

export function App() {
  useEffect(wire, []);

  if (!started.value) return <Splash />;
  if (!place.value) return <PickLocation />;

  const m = mode.value;
  return (
    <div class={`app mode-${m} lvl-${threat.value.level.toLowerCase()}`}>
      {m === "kiosk" ? <KioskShell /> : m === "phone" ? <PhoneShell /> : <WebShell />}
      <Takeover />
    </div>
  );
}

/** One tap: unlocks audio + speech (browsers block both until a gesture). */
function Splash() {
  return (
    <div class="splash">
      <Logo />
      <p>Live weather that gets louder when the weather does.</p>
      <button
        type="button"
        class="primary"
        onClick={() => {
          started.value = true;
          void startMusic();
        }}
      >
        Start
      </button>
    </div>
  );
}

function PickLocation() {
  const [msg, setMsg] = useState("");
  const useGps = () => {
    if (!navigator.geolocation) return setMsg("Location isn't available — search instead.");
    navigator.geolocation.getCurrentPosition(
      (p) => void locateByCoords(p.coords.latitude, p.coords.longitude).catch(() => setMsg("SHELLY covers the United States only.")),
      () => setMsg("Couldn't get your location — search instead."),
    );
  };
  return (
    <div class="splash">
      <Logo />
      <p>Where should SHELLY watch the weather? (United States)</p>
      <button type="button" class="primary" onClick={useGps}>Use my location</button>
      <SearchBox />
      {msg && <p class="err">{msg}</p>}
    </div>
  );
}
