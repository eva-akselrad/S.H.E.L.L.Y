import { effect } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Logo, SearchBox } from "./components/Chrome";
import { applyThreatToMusic, musicOn, refreshMusic, setBackgroundPlay, startMusic } from "./music";
import { Scene } from "./scene/Scene";
import { KioskShell } from "./shells/Kiosk";
import { PhoneShell } from "./shells/Phone";
import { WebShell } from "./shells/Web";
import { config, locateByCoords, mode, place, startCycling, startPollers, threat } from "./state/store";
import { Takeover } from "./takeover/Takeover";
import { initPush, syncPush } from "./push";
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
    announce(t.level, t.active, t.primary, config.value.tts, {
      ai: config.value.voice.engine === "ai",
      lat: place.value?.lat ?? 0,
      lon: place.value?.lon ?? 0,
    });
  });
  effect(() => {
    void musicOn.value;
    refreshMusic();
  });
  // only a TV/kiosk keeps the music going when the page isn't on screen
  effect(() => setBackgroundPlay(mode.value === "kiosk"));
  if (mode.peek() !== "kiosk") void initPush();
  // keep the push subscription pointed at the place this device is watching
  effect(() => {
    const p = place.value;
    if (p) void syncPush(p);
  });
}

export function App() {
  useEffect(() => {
    wire();
    // No Start screen: begin right away. Audio the browser blocks is retried on the first
    // touch/key, or plays as-is with --autoplay-policy=no-user-gesture-required (kiosks).
    void startMusic();
  }, []);

  if (!place.value) return <PickLocation />;

  const m = mode.value;
  return (
    <>
      <Scene />
      <div class={`app mode-${m} lvl-${threat.value.level.toLowerCase()}`}>
      {m === "kiosk" ? <KioskShell /> : m === "phone" ? <PhoneShell /> : <WebShell />}
      <Takeover />
      </div>
    </>
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
