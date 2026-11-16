import { useEffect, useState } from "preact/hooks";
import { DEFAULT_LIVE, type SiteConfig } from "../../shared/config";
import { applyThreatToMusic, configureMusic, setDucked, startMusic } from "../music";
import { AlertCounters, Crawl, HeadlineBar, IntensityGauge, LowerThird, MainPanel, RightRail } from "./Panels";
import { advance, clock, current, epoch, pollProducts, pollRadar, pollRundown, rundown, status } from "./state";
import { speakItem, stopVoice } from "./voice";
import "../styles/live.css";

const W = 1920;
const H = 1080;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** SHELLY Live: a fixed 1920x1080 stage, captured by an OBS Browser Source. No controls. */
export function Broadcast() {
  const [scale, setScale] = useState(Math.min(innerWidth / W, innerHeight / H));
  const [cfg, setCfg] = useState<SiteConfig | null>(null);

  useEffect(() => {
    const onResize = () => setScale(Math.min(innerWidth / W, innerHeight / H));
    addEventListener("resize", onResize);
    void fetch("/api/config")
      .then((r) => r.json() as Promise<SiteConfig>)
      .then((c) => {
        setCfg(c);
        configureMusic(c.music);
        void startMusic();
      })
      .catch(() => undefined);
    void pollRundown();
    void pollRadar();
    void pollProducts();
    const timers = [
      setInterval(() => void pollRundown(), 15_000),
      setInterval(() => void pollRadar(), 120_000),
      setInterval(() => void pollProducts(), 60_000),
      setInterval(() => (clock.value = Date.now()), 1000),
    ];
    return () => {
      removeEventListener("resize", onResize);
      timers.forEach(clearInterval);
    };
  }, []);

  const level = rundown.value?.level ?? "CALM";
  useEffect(() => applyThreatToMusic(level), [level]);

  // Play the current item: it lasts its duration, but never cuts off speech that is still running.
  const ai = cfg?.voice.engine === "ai";
  const speakOn = cfg?.tts !== false;
  useEffect(() => {
    const it = current.value;
    if (!it) return;
    let cancelled = false;
    const minMs = it.durationSec * 1000;
    const speech = it.speak && speakOn ? Promise.race([speakItem(it, ai), sleep(minMs + 25_000)]) : Promise.resolve();
    setDucked(!!it.speak && speakOn);
    void Promise.all([sleep(minMs), speech]).then(() => {
      if (!cancelled) advance();
    });
    return () => {
      cancelled = true;
      stopVoice();
      setDucked(false);
    };
  }, [epoch.value]);

  const r = rundown.value;
  const region = cfg?.live.region ?? DEFAULT_LIVE.region;

  return (
    <div class="bc-root" style={{ "--s": String(scale) } as never}>
      <div class={`bc-stage lvl-${level.toLowerCase()}`}>
        {r ? (
          <>
            <header class="bc-top">
              <AlertCounters r={r} />
              <HeadlineBar r={r} />
              <IntensityGauge r={r} />
            </header>
            <main class="bc-main">
              <section class={`bc-panel kind-${current.value?.kind ?? "none"}`}><MainPanel r={r} region={region} forecaster={cfg?.studio.forecasterName ?? ""} /></section>
              <RightRail r={r} region={region} />
            </main>
            <LowerThird r={r} />
            <Crawl r={r} />
          </>
        ) : (
          <div class="bc-standby">
            <h1>SHELLY</h1>
            <p>
              {status.value === "disabled" ? "The broadcast is switched off." : status.value === "forbidden" ? "This address needs its viewer key." : "Standing by for the first rundown…"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
