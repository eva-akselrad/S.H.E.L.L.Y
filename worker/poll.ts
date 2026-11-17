import { latencySamples, type LatencySample } from "../shared/health";
import type { Alert } from "../shared/types";
import { fetchActiveAlerts } from "./sources/nws";
import { ALERTS_KEY, readAlerts } from "./store";

export const LATENCY_KEY = "stats:latency";

/**
 * Fetch active NWS alerts and store them. On failure the previous snapshot is kept.
 * Also records how long each NEW alert took from NWS issuing it to SHELLY having it.
 */
export async function pollAlerts(env: Env): Promise<Alert[] | null> {
  try {
    const [prev, alerts] = await Promise.all([readAlerts(env), fetchActiveAlerts(env)]);
    const now = Date.now();
    await env.STATE.put(ALERTS_KEY, JSON.stringify({ updated: new Date(now).toISOString(), alerts }));
    // the first poll after a deploy (no previous snapshot) would count every alert as new
    if (prev.updated) {
      const fresh = latencySamples(new Set(prev.alerts.map((a) => a.id)), alerts, now);
      if (fresh.length) {
        const old = (await env.STATE.get<LatencySample[]>(LATENCY_KEY, "json")) ?? [];
        await env.STATE.put(LATENCY_KEY, JSON.stringify([...fresh, ...old].slice(0, 300)));
      }
    }
    return alerts;
  } catch (err) {
    console.error(JSON.stringify({ msg: "alert_poll_failed", err: String(err) }));
    return null;
  }
}
