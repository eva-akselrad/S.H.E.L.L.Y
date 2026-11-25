import { useEffect, useState } from "preact/hooks";
import { AnnouncementBar, Logo, StatusLine, ThreatBadge } from "../components/Chrome";
import { Freshness } from "../components/Freshness";
import { SoundOutput } from "../components/SoundOutput";
import { LightningChip } from "../components/LightningUi";
import { ActionCard, NearbyNotice, StaleBanner } from "../components/Safety";
import { SEGMENT_VIEWS } from "../segments";
import { currentSegment, goTo, paused } from "../state/store";

const W = 1920;
const H = 1080;

/** Fixed 16:9 stage scaled to fit; no controls, keyboard/remote only. */
export function KioskShell() {
  const [scale, setScale] = useState(Math.min(innerWidth / W, innerHeight / H));
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const onResize = () => setScale(Math.min(innerWidth / W, innerHeight / H));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goTo(1);
      else if (e.key === "ArrowLeft") goTo(-1);
      else if ((e.key === " " || e.key === "Enter") && !(e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement)) paused.value = !paused.value;
      else if (e.key === "s" || e.key === "S") setSettings((v) => !v);
      else if (e.key === "Escape") setSettings(false);
    };
    addEventListener("resize", onResize);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("resize", onResize);
      removeEventListener("keydown", onKey);
    };
  }, []);

  const seg = currentSegment.value;
  const View = SEGMENT_VIEWS[seg.id];
  return (
    <div class="kiosk-frame">
      <div class="stage" style={{ width: `${W}px`, height: `${H}px`, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <header class="topbar">
          <Logo />
          <h2>{seg.title}</h2>
          <ThreatBadge />
          <Clock />
        </header>
        <div class="kiosk-notices">
          <StaleBanner />
          <ActionCard compact />
          <LightningChip compact />
          <NearbyNotice />
          <AnnouncementBar />
        </div>
        <main key={seg.id} class="stage-main"><View /></main>
        {settings && (
          <div class="kiosk-settings" role="dialog" aria-label="Display settings">
            <SoundOutput />
            <button type="button" onClick={() => setSettings(false)}>Done</button>
            <span class="muted small">Press S to open or close this.</span>
          </div>
        )}
        <footer class="botbar"><StatusLine /><Freshness id={seg.id} />{paused.value && <span class="muted">Paused</span>}</footer>
      </div>
    </div>
  );
}

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <time class="clock">{t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time>;
}
