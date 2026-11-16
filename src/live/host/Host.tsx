import type { ThreatLevel } from "../../../shared/types";
import { mouth, speaking } from "../state";

/**
 * SHELLY the sea turtle: the default host. Everything about the mascot lives in this folder
 * behind <Host />, so a different character can replace it without touching anything else.
 * States: idle (blink + bob), talking (mouth follows the voice), serious (WARNING and up:
 * still, shell glows in the threat color), offair (forecaster live).
 */
export type HostState = "idle" | "talking" | "serious" | "offair";

export function hostState(level: ThreatLevel, isSpeaking: boolean, offAir = false): HostState {
  if (offAir) return "offair";
  if (level === "WARNING" || level === "EMERGENCY") return "serious";
  return isSpeaking ? "talking" : "idle";
}

const GLOW: Record<ThreatLevel, string> = { CALM: "var(--calm)", ELEVATED: "var(--elevated)", WARNING: "var(--warning)", EMERGENCY: "var(--emergency)" };

export function Host({ level, offAir = false }: { level: ThreatLevel; offAir?: boolean }) {
  const state = hostState(level, speaking.value, offAir);
  const open = state === "talking" || (state === "serious" && speaking.value) ? mouth.value : 0;
  return (
    <div class={`host host-${state}`} style={{ "--glow": GLOW[level], "--mouth": String(open) } as never} role="img" aria-label="SHELLY, the sea turtle host">
      <svg viewBox="0 0 320 260" aria-hidden="true">
        <g class="host-bob">
          {/* back flippers */}
          <ellipse cx="86" cy="208" rx="30" ry="16" fill="#2fae8a" />
          <ellipse cx="236" cy="208" rx="30" ry="16" fill="#2fae8a" />
          {/* front flipper */}
          <g class="host-wave">
            <ellipse cx="258" cy="150" rx="40" ry="16" transform="rotate(-28 258 150)" fill="#3ecf9a" />
          </g>
          {/* shell */}
          <path d="M60 180 C60 96 112 56 170 56 C228 56 280 96 280 180 Z" fill="var(--glow)" opacity=".28" class="host-halo" />
          <path d="M70 182 C70 104 116 66 170 66 C224 66 270 104 270 182 Z" fill="#1f8f78" />
          <g fill="none" stroke="#0f5f52" stroke-width="3" stroke-linecap="round" opacity=".8">
            <path d="M170 66 V182 M120 84 Q150 124 150 182 M220 84 Q190 124 190 182 M82 134 Q130 142 170 134 Q210 142 258 134" />
          </g>
          <g fill="#2fae8a" opacity=".9">
            <circle cx="170" cy="112" r="14" /><circle cx="128" cy="150" r="10" /><circle cx="212" cy="150" r="10" />
          </g>
          {/* head */}
          <ellipse cx="86" cy="140" rx="48" ry="42" fill="#3ecf9a" />
          <g class="host-eyes">
            <ellipse cx="74" cy="128" rx="9" ry="11" fill="#fff" />
            <ellipse cx="102" cy="128" rx="9" ry="11" fill="#fff" />
            <circle cx="76" cy="130" r="5" fill="#16202e" />
            <circle cx="104" cy="130" r="5" fill="#16202e" />
          </g>
          <ellipse cx="62" cy="152" rx="7" ry="4" fill="#ff8a65" opacity=".55" />
          {/* mouth: height follows --mouth */}
          <ellipse class="host-mouth" cx="90" cy="156" rx="13" ry="3" fill="#16202e" />
        </g>
      </svg>
      {state === "offair" && <span class="host-tag">Forecaster live</span>}
    </div>
  );
}
