import { fetchActiveAlerts } from "./sources/nws";
import { ALERTS_KEY } from "./store";

/** Fetch active NWS alerts and store them. On failure the previous snapshot is kept. */
export async function pollAlerts(env: Env): Promise<boolean> {
  try {
    const alerts = await fetchActiveAlerts(env);
    await env.STATE.put(ALERTS_KEY, JSON.stringify({ updated: new Date().toISOString(), alerts }));
    return true;
  } catch (err) {
    console.error(JSON.stringify({ msg: "alert_poll_failed", err: String(err) }));
    return false;
  }
}
