import { useEffect, useState } from "preact/hooks";
import { call } from "./api";
import { toast } from "./toast";
import { Card, Chip, Page } from "./ui";
import { ago } from "./util";

interface Status {
  version: string;
  poller: { updated: string | null; ageSeconds: number | null; count: number; top: [string, number][] };
  simulated: number;
  announcements: number;
  defaultLocation: string | null;
  lastAction: { t: string; action: string; detail: string } | null;
  latency?: { count: number; medianS: number | null; p90S: number | null; worstS: number | null; warningsMedianS: number | null };
  push?: { configured: boolean; subscribers: number };
  fcm?: { configured: boolean };
}

const secs = (s: number | null | undefined) => (s === null || s === undefined ? "--" : s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

export function Overview() {
  const [s, setS] = useState<Status | null>(null);
  const load = async () => {
    const r = await call<Status>("GET", "/api/admin/status");
    if (r.ok) setS(r.data);
  };
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, []);

  const repoll = async () => {
    const r = await call("POST", "/api/admin/refresh-alerts");
    toast(r.ok ? "Alerts refreshed from NWS" : "NWS did not respond. Kept the last snapshot.", r.ok ? "ok" : "error");
    void load();
  };
  const testPush = async () => {
    const r = await call<{ sent: number; total: number }>("POST", "/api/admin/push-test");
    toast(r.ok ? `Test sent to ${r.data.sent} of ${r.data.total} devices` : "Push isn't set up yet", r.ok ? "ok" : "error");
  };
  const testApp = async () => {
    const r = await call("POST", "/api/admin/fcm-test");
    toast(r.ok ? "Test sent to the SHELLY app" : "App push isn't set up, or the send failed", r.ok ? "ok" : "error");
  };
  const stopSims = async () => {
    await call("DELETE", "/api/admin/simulate");
    toast("All test alerts stopped");
    void load();
  };

  if (!s) return <Page title="Overview"><p class="adm-hint">Loading…</p></Page>;
  const stale = s.poller.ageSeconds === null || s.poller.ageSeconds > 180;

  return (
    <Page title="Overview" lead="What every screen is showing right now, and whether the plumbing is healthy.">
      <div class="adm-tiles">
        <Card>
          <span class="adm-tile-label">Alert feed</span>
          <b class="adm-tile-value">{stale ? "Stale" : "Healthy"}</b>
          <Chip kind={stale ? "danger" : "ok"}>updated {ago(s.poller.updated)}</Chip>
          <span class="adm-hint">{s.poller.count} active alerts nationwide</span>
        </Card>
        <Card tone={s.simulated ? "warn" : undefined}>
          <span class="adm-tile-label">Test alerts</span>
          <b class="adm-tile-value">{s.simulated}</b>
          <span class="adm-hint">{s.simulated ? "Live on every screen right now" : "None running"}</span>
        </Card>
        <Card>
          <span class="adm-tile-label">Announcements</span>
          <b class="adm-tile-value">{s.announcements}</b>
          <span class="adm-hint">live or scheduled</span>
        </Card>
        <Card tone={s.latency?.warningsMedianS && s.latency.warningsMedianS > 120 ? "warn" : undefined}>
          <span class="adm-tile-label">Alert speed (7 days)</span>
          <b class="adm-tile-value">{secs(s.latency?.medianS)}</b>
          <span class="adm-hint">
            {s.latency?.count
              ? `median from NWS issuing to SHELLY having it · 90% within ${secs(s.latency.p90S)} · warnings ${secs(s.latency.warningsMedianS)} · worst ${secs(s.latency.worstS)}. Screens add up to 30 s.`
              : "Measured from the next new alert."}
          </span>
        </Card>
        <Card>
          <span class="adm-tile-label">Push alerts</span>
          <b class="adm-tile-value">{s.push?.configured ? s.push.subscribers : "Off"}</b>
          <span class="adm-hint">{s.push?.configured ? "devices signed up" : "Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to turn on"}</span>
        </Card>
        <Card>
          <span class="adm-tile-label">App push</span>
          <b class="adm-tile-value">{s.fcm?.configured ? "On" : "Off"}</b>
          <span class="adm-hint">{s.fcm?.configured ? "Android app alerts are sent through Firebase" : "Set FCM_SERVICE_ACCOUNT to turn on"}</span>
        </Card>
        <Card>
          <span class="adm-tile-label">Default location</span>
          <b class="adm-tile-value small">{s.defaultLocation ?? "Not set"}</b>
          <span class="adm-hint">{s.defaultLocation ? "New screens start here" : "Visitors choose their own"}</span>
        </Card>
      </div>

      <div class="adm-cols">
        <Card title="Quick actions">
          <div class="adm-row">
            <button type="button" class="adm-btn" onClick={() => void repoll()}>Re-poll NWS now</button>
            <button type="button" class="adm-btn" disabled={!s.simulated} onClick={() => void stopSims()}>Stop all test alerts</button>
            <button type="button" class="adm-btn" disabled={!s.push?.configured || !s.push.subscribers} onClick={() => void testPush()}>Send test push</button>
            <button type="button" class="adm-btn" disabled={!s.fcm?.configured} onClick={() => void testApp()}>Send test to app</button>
            <a class="adm-btn" href="/" target="_blank" rel="noopener">Open site</a>
            <a class="adm-btn" href="/?mode=kiosk" target="_blank" rel="noopener">Open kiosk view</a>
          </div>
        </Card>
        <Card title="Most common alerts nationwide">
          {s.poller.top.length === 0 ? (
            <p class="adm-hint">No active alerts.</p>
          ) : (
            <ul class="adm-list">
              {s.poller.top.map(([name, n]) => (
                <li key={name}><span>{name}</span><b>{n}</b></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p class="adm-hint">SHELLY v{s.version}{s.lastAction ? ` · last change: ${s.lastAction.action} ${ago(s.lastAction.t)}` : ""}</p>
    </Page>
  );
}
