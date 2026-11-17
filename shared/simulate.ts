import type { Alert, AlertParams } from "./types";

export const SIM_PRESETS = {
  "tornado-emergency": {
    label: "Tornado Emergency",
    event: "Tornado Warning",
    severity: "Extreme",
    headline: "Tornado Emergency",
    description:
      "This is a PARTICULARLY DANGEROUS SITUATION. A confirmed large and extremely dangerous tornado is on the ground.",
    instruction: "TAKE COVER NOW. Move to a basement or an interior room on the lowest floor of a sturdy building.",
    params: { tornadoDetection: "OBSERVED", tornadoDamageThreat: "CATASTROPHIC" } as AlertParams,
  },
  "tornado-warning": {
    label: "Tornado Warning",
    event: "Tornado Warning",
    severity: "Extreme",
    headline: "Tornado Warning",
    description: "A severe thunderstorm capable of producing a tornado was located nearby, moving northeast.",
    instruction: "Move to an interior room on the lowest floor of a sturdy building. Avoid windows.",
    params: { tornadoDetection: "RADAR INDICATED" } as AlertParams,
  },
  "severe-thunderstorm-warning": {
    label: "Severe Thunderstorm Warning",
    event: "Severe Thunderstorm Warning",
    severity: "Severe",
    headline: "Severe Thunderstorm Warning",
    description: "60 mph wind gusts and quarter size hail are expected with this storm.",
    instruction: "Move indoors and stay away from windows.",
    params: { maxWindGust: "60 MPH", maxHailSize: "1.00" } as AlertParams,
  },
  "flash-flood-warning": {
    label: "Flash Flood Warning",
    event: "Flash Flood Warning",
    severity: "Severe",
    headline: "Flash Flood Warning",
    description: "Heavy rain is causing flash flooding of creeks and low-lying areas.",
    instruction: "Turn around, don't drown. Move to higher ground.",
    params: { flashFloodDamageThreat: "CONSIDERABLE" } as AlertParams,
  },
  "winter-storm-warning": {
    label: "Winter Storm Warning",
    event: "Winter Storm Warning",
    severity: "Severe",
    headline: "Winter Storm Warning",
    description: "Heavy snow expected. Total accumulations of 8 to 12 inches.",
    instruction: "Travel could be very difficult to impossible.",
    params: {} as AlertParams,
  },
  "tornado-watch": {
    label: "Tornado Watch",
    event: "Tornado Watch",
    severity: "Severe",
    headline: "Tornado Watch",
    description: "Conditions are favorable for tornadoes and severe thunderstorms in the watch area.",
    instruction: "Be prepared to move to a place of safety if a warning is issued.",
    params: {} as AlertParams,
  },
  "heat-advisory": {
    label: "Heat Advisory",
    event: "Heat Advisory",
    severity: "Moderate",
    headline: "Heat Advisory",
    description: "Heat index values up to 105 expected.",
    instruction: "Drink plenty of fluids and stay in an air-conditioned room.",
    params: {} as AlertParams,
  },
} as const;

export type SimPreset = keyof typeof SIM_PRESETS;
export const isSimPreset = (v: unknown): v is SimPreset => typeof v === "string" && v in SIM_PRESETS;

/** An admin-written test alert. Text comes from the admin, never from an LLM, and is always shown as a TEST. */
export interface CustomSim {
  event: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor";
  description: string;
  instruction: string;
  tornadoObserved?: boolean;
}

export interface SimEntry {
  id: string;
  preset: SimPreset | "custom";
  custom?: CustomSim;
  created: string;
  expires: string;
}

export const CUSTOM_SEVERITIES = ["Extreme", "Severe", "Moderate", "Minor"] as const;

/** Common NWS event names to pick from. Anything else can be typed in. */
export const CUSTOM_EVENTS = [
  "Tornado Warning",
  "Severe Thunderstorm Warning",
  "Flash Flood Warning",
  "Winter Storm Warning",
  "Blizzard Warning",
  "Ice Storm Warning",
  "Excessive Heat Warning",
  "Tornado Watch",
  "Severe Thunderstorm Watch",
  "Flood Watch",
  "Winter Weather Advisory",
  "Heat Advisory",
  "Wind Advisory",
  "Dense Fog Advisory",
  "Special Weather Statement",
] as const;

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validates admin input for a custom test alert. Returns null if the event name is missing. */
export function normalizeCustomSim(raw: unknown): CustomSim | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const event = clip(r.event, 80);
  if (!event) return null;
  const severity = (CUSTOM_SEVERITIES as readonly unknown[]).includes(r.severity) ? (r.severity as CustomSim["severity"]) : "Severe";
  return {
    event,
    severity,
    description: clip(r.description, 600),
    instruction: clip(r.instruction, 400),
    ...(r.tornadoObserved === true ? { tornadoObserved: true } : {}),
  };
}

export const simLabel = (e: SimEntry): string => (e.preset === "custom" ? `Custom: ${e.custom?.event ?? "alert"}` : SIM_PRESETS[e.preset].label);

/** Build a clearly-labelled test alert that covers the viewer's point. */
export function buildSimAlert(
  entry: SimEntry,
  point: { lat: number; lon: number; zones: string[] },
): Alert {
  const p =
    entry.preset === "custom" && entry.custom
      ? {
          event: entry.custom.event,
          severity: entry.custom.severity,
          headline: entry.custom.event,
          description: entry.custom.description || "Custom test alert.",
          instruction: entry.custom.instruction || "This is only a test.",
          params: (entry.custom.tornadoObserved ? { tornadoDetection: "OBSERVED" } : {}) as AlertParams,
        }
      : SIM_PRESETS[entry.preset === "custom" ? "tornado-warning" : entry.preset];
  const d = 0.12; // ~8 mile half-width square around the viewer
  const { lat, lon } = point;
  return {
    id: entry.id,
    event: p.event,
    severity: p.severity,
    urgency: "Immediate",
    certainty: "Observed",
    headline: `TEST: ${p.headline}`,
    description: `THIS IS A TEST. ${p.description}`,
    instruction: `THIS IS A TEST. ${p.instruction}`,
    sent: entry.created,
    onset: entry.created,
    expires: entry.expires,
    areaDesc: "Your area (test)",
    zones: point.zones,
    geometry: {
      type: "Polygon",
      coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]],
    },
    params: { ...p.params },
  };
}
