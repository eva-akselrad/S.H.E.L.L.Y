import { agoText } from "../../shared/health";
import type { SegmentId } from "../../shared/scheduler";
import { air, confidence, forecast, gradeHere, hazards, lightning, now, outlook, radar, reports, snowOdds } from "../state/store";

interface Src {
  source: string;
  at: string | number | null;
}

function sourceFor(id: SegmentId): Src | null {
  switch (id) {
    case "now":
    case "hourly":
      return { source: "Open-Meteo", at: forecast.value?.fetchedAt ?? null };
    case "daily":
      return { source: confidence.value ? "Open-Meteo + GFS ensemble" : "Open-Meteo", at: forecast.value?.fetchedAt ?? null };
    case "text":
      return { source: "National Weather Service", at: forecast.value?.fetchedAt ?? null };
    case "radar": {
      const last = radar.value?.frames.at(-1)?.time;
      return { source: "Iowa Environmental Mesonet radar", at: last ? last * 1000 : null };
    }
    case "outlook":
      return { source: "NOAA Storm Prediction Center", at: outlook.value?.fetchedAt ?? null };
    case "air":
      return { source: "Open-Meteo air quality", at: air.value?.fetchedAt ?? null };
    case "reports":
      return { source: "NOAA SPC preliminary reports", at: reports.value?.fetchedAt ?? null };
    case "local":
      return { source: "NWS water, NOAA tides, NHC", at: hazards.value?.fetchedAt ?? null };
    case "lightning":
      return { source: "NOAA GOES-19 lightning mapper", at: lightning.value?.updated ?? null };
    case "snowday":
      return { source: snowOdds.value?.source === "model" ? "Open-Meteo + NWS alerts" : "NWS forecast grid + GFS ensemble", at: snowOdds.value?.fetchedAt ?? null };
    case "grade": {
      const g = gradeHere.value;
      return g ? { source: `NWS station ${g.station ?? ""}`.trim(), at: null } : null;
    }
    default:
      return null;
  }
}

/** "Open-Meteo · updated 3 min ago" under each segment. */
export function Freshness({ id }: { id: SegmentId }) {
  const s = sourceFor(id);
  if (!s) return null;
  const ago = agoText(s.at, now.value);
  return (
    <p class="fresh">
      {s.source}
      {ago ? ` · updated ${ago}` : ""}
    </p>
  );
}
