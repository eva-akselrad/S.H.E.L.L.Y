import { useEffect, useRef, useState } from "preact/hooks";
import type { ThreatLevel } from "../../../shared/types";
import { current, mouth, rundown, speaking } from "../state";
import { hostState, moodFor, outfitFor, parseHostPreview, quipFor, type Trick } from "./personality";
export { hostState, moodFor, outfitFor, quipFor } from "./personality";

/**
 * SHELLY the sea turtle: the default host. Everything about the mascot lives in this folder
 * behind <Host />, so a different character can replace it without touching anything else.
 *
 * Personality:
 * - mood follows the threat level: happy (calm), curious (elevated), focused (warning), worried (emergency)
 * - dresses for the weather in the first city: shades, beanie and scarf, umbrella, or a nightcap late at night
 * - idle tricks on calm days: looks around, waves, tilts, hops, double-blinks, a little sparkle
 * - reacts to what's on screen with a short speech bubble (never during warnings)
 * - mouth follows the voice; nods while talking
 */

const GLOW: Record<ThreatLevel, string> = { CALM: "var(--calm)", ELEVATED: "var(--elevated)", WARNING: "var(--warning)", EMERGENCY: "var(--emergency)" };
/** ?host=… look override for filming (see parseHostPreview). Read once; cosmetic only. */
const PREVIEW = parseHostPreview(typeof location === "undefined" ? "" : location.search);
const TRICKS: Trick[] = ["look", "lookR", "wave", "tilt", "hop", "blink2", "sparkle", "look", "wave"];

function localHour(tz: string | undefined): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

export function Host({ level, offAir = false, big = false }: { level: ThreatLevel; offAir?: boolean; big?: boolean }) {
  const state = hostState(level, speaking.value, offAir);
  // a real warning always wins over the filming preview
  const look = level === "WARNING" || level === "EMERGENCY" ? {} : PREVIEW;
  const mood = look.mood ?? moodFor(level);
  const r = rundown.value;
  const first = r?.wx?.cities[0]?.now ?? null;
  const outfit = look.outfit ?? outfitFor(first, localHour(r?.tz), level);
  const calm = state === "idle" || state === "talking";
  const open = state === "talking" || (state === "serious" && speaking.value) ? mouth.value : 0;

  // random blinks (more natural than a fixed CSS loop)
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        loop();
      }, 2200 + Math.random() * 4200);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // idle tricks every 7-13 s on calm days, never while talking or during warnings
  const [trick, setTrick] = useState<Trick>("none");
  const busy = useRef(false);
  busy.current = !calm || speaking.value || outfit === "sleepy";
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        if (!busy.current) {
          setTrick(PREVIEW.trick ?? TRICKS[Math.floor(Math.random() * TRICKS.length)]!);
          setTimeout(() => setTrick("none"), 1800);
        }
        loop();
      }, PREVIEW.trick ? 4000 : 7000 + Math.random() * 6000);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // a reaction bubble when the screen changes (about half the time, calm periods only)
  const [quip, setQuip] = useState<string | null>(null);
  const it = current.value;
  useEffect(() => {
    if (!calm || big) return setQuip(null);
    const q = quipFor(it, outfit);
    if (!q || Math.random() < 0.45) return setQuip(null);
    const show = setTimeout(() => setQuip(q), 600);
    const hide = setTimeout(() => setQuip(null), 5200);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [it?.key, calm]);

  const cls = [`host`, `host-${state}`, `mood-${mood}`, `fit-${outfit}`, `trick-${trick}`, speaking.value ? "speaking" : "", blink || trick === "blink2" ? "blink" : "", big ? "host-big" : ""].join(" ");
  const eyeOpen = mood === "worried" ? 13 : mood === "focused" ? 9 : 11;

  return (
    <div class={cls} style={{ "--glow": GLOW[level], "--mouth": String(open) } as never} role="img" aria-label={`SHELLY, the sea turtle host, looking ${mood}`}>
      {quip && !speaking.value && <span class="host-bubble" key={quip}>{quip}</span>}
      <svg viewBox="0 0 340 270" aria-hidden="true">
        <defs>
          <radialGradient id="host-shell" cx="45%" cy="35%" r="70%">
            <stop offset="0" stop-color="#2bb592" />
            <stop offset="1" stop-color="#16725f" />
          </radialGradient>
          <radialGradient id="host-skin" cx="40%" cy="35%" r="70%">
            <stop offset="0" stop-color="#6ee6b8" />
            <stop offset="1" stop-color="#34bf8d" />
          </radialGradient>
        </defs>
        <ellipse cx="180" cy="248" rx="120" ry="12" fill="#000" opacity=".25" class="host-shadow" />
        <g class="host-body">
          {/* back flippers */}
          <ellipse cx="120" cy="226" rx="30" ry="15" fill="#2fae8a" />
          <ellipse cx="262" cy="222" rx="30" ry="15" fill="#2fae8a" />
          <path d="M300 186 q26 6 30 22 q-22 0 -36 -10z" fill="#2fae8a" />
          {/* shell */}
          <path d="M84 196 C84 108 132 62 192 62 C252 62 300 108 300 196 Z" fill="var(--glow)" opacity=".26" class="host-halo" />
          <path d="M94 198 C94 116 138 74 192 74 C246 74 290 116 290 198 Z" fill="url(#host-shell)" />
          <path d="M94 198 C120 206 264 206 290 198" stroke="#f3d9a4" stroke-width="10" fill="none" stroke-linecap="round" />
          <g fill="none" stroke="#0f5f52" stroke-width="3.5" stroke-linecap="round" opacity=".75">
            <path d="M192 76 V196 M142 92 Q170 132 168 196 M242 92 Q214 132 216 196 M106 146 Q150 154 192 146 Q234 154 278 146" />
          </g>
          <g fill="#48c9a0" opacity=".85">
            <circle cx="192" cy="118" r="15" /><circle cx="146" cy="168" r="11" /><circle cx="238" cy="168" r="11" />
          </g>
          {/* front flipper (waves) */}
          <g class="host-flipper">
            <path d="M118 182 q-46 6 -62 34 q34 4 70 -18z" fill="#3ecf9a" />
          </g>
          {/* head */}
          <g class="host-head">
            <path d="M118 150 q-10 30 10 44" stroke="#3ecf9a" stroke-width="30" stroke-linecap="round" fill="none" />
            <ellipse cx="88" cy="132" rx="56" ry="50" fill="url(#host-skin)" />
            {/* cheeks */}
            <ellipse cx="58" cy="152" rx="11" ry="6" fill="#ff8a65" class="host-cheek" />
            <ellipse cx="116" cy="152" rx="9" ry="5" fill="#ff8a65" class="host-cheek" />
            {/* eyes */}
            <g class="host-eyes">
              <g class="host-eye"><ellipse cx="72" cy="122" rx="12" ry={eyeOpen + 2} fill="#fff" /><g class="host-pupil"><circle cx="70" cy="124" r="6.5" fill="#16202e" /><circle cx="67.5" cy="120.5" r="2.2" fill="#fff" /></g></g>
              <g class="host-eye"><ellipse cx="106" cy="122" rx="12" ry={eyeOpen + 2} fill="#fff" /><g class="host-pupil"><circle cx="104" cy="124" r="6.5" fill="#16202e" /><circle cx="101.5" cy="120.5" r="2.2" fill="#fff" /></g></g>
            </g>
            {/* brows */}
            <g class="host-brows" stroke="#1d6b55" stroke-width="4.5" stroke-linecap="round" fill="none">
              <path class="brow-l" d="M60 102 Q72 96 84 101" />
              <path class="brow-r" d="M94 101 Q106 96 118 102" />
            </g>
            {/* mouth: smile, o, flat or worried; the talking mouth opens with --mouth */}
            <g class="host-mouths" stroke="#16202e" stroke-width="4.5" stroke-linecap="round" fill="none">
              <path class="m-happy" d="M74 148 Q89 162 104 148" />
              <ellipse class="m-curious" cx="89" cy="153" rx="6" ry="7" fill="#16202e" stroke="none" />
              <path class="m-focused" d="M76 153 L102 153" />
              <path class="m-worried" d="M76 157 Q89 147 102 157" />
            </g>
            <ellipse class="host-mouth" cx="89" cy="153" rx="13" ry="4" fill="#16202e" />
          </g>

          {/* outfits */}
          <g class="fit fit-shades-g">
            <rect x="56" y="110" width="30" height="20" rx="7" fill="#16202e" />
            <rect x="92" y="110" width="30" height="20" rx="7" fill="#16202e" />
            <path d="M86 118 h6 M56 116 l-14 -6" stroke="#16202e" stroke-width="4" stroke-linecap="round" />
            <path d="M62 114 l8 0" stroke="#ffffff88" stroke-width="3" stroke-linecap="round" />
          </g>
          <g class="fit fit-winter-g">
            <path d="M40 104 Q86 52 136 102 Z" fill="#ff8a65" />
            <rect x="36" y="96" width="104" height="16" rx="8" fill="#f3ede4" />
            <circle cx="88" cy="58" r="12" fill="#f3ede4" />
            <path d="M70 176 q30 16 62 0 l4 16 q-34 16 -70 0z" fill="#3d8bff" />
            <path d="M118 186 l8 34 l14 -4 l-8 -30z" fill="#3d8bff" />
          </g>
          <g class="fit fit-umbrella-g">
            <path d="M150 80 V20" stroke="#16202e" stroke-width="5" stroke-linecap="round" />
            <path d="M60 30 Q150 -40 240 30 Q217 18 195 30 Q172 18 150 30 Q128 18 105 30 Q83 18 60 30 Z" fill="#ff8a65" />
            <path d="M150 80 q0 14 -12 14" stroke="#16202e" stroke-width="5" fill="none" stroke-linecap="round" />
            <g class="host-drops" fill="#7cc3ff">
              <path d="M40 60 q4 8 0 10 q-4 -2 0 -10z" /><path d="M260 70 q4 8 0 10 q-4 -2 0 -10z" /><path d="M280 40 q4 8 0 10 q-4 -2 0 -10z" />
            </g>
          </g>
          <g class="fit fit-sleepy-g">
            <path d="M38 100 Q80 50 136 100 Z" fill="#6a5cff" />
            <path d="M136 100 q20 -10 18 -40" stroke="#6a5cff" stroke-width="12" fill="none" stroke-linecap="round" />
            <circle cx="154" cy="58" r="10" fill="#f3ede4" />
            <text x="160" y="44" class="host-z">z</text>
            <text x="180" y="24" class="host-z z2">z</text>
          </g>

          {/* sparkle trick */}
          <g class="host-sparkle" fill="#ffd23f">
            <path d="M30 70 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4z" />
            <path d="M150 40 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3z" />
          </g>
        </g>
      </svg>
      {state === "offair" && <span class="host-tag">Forecaster live</span>}
    </div>
  );
}
