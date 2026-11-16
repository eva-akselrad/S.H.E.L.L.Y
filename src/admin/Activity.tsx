import { useEffect, useState } from "preact/hooks";
import { call } from "./api";
import { Card, Page } from "./ui";
import { ago, clock } from "./util";

interface Entry {
  t: string;
  action: string;
  detail: string;
}

const LABEL: Record<string, string> = {
  "announcement.add": "Posted announcement",
  "announcement.remove": "Removed announcement",
  "config.save": "Saved settings",
  "simulate.start": "Started test alert",
  "simulate.stop": "Stopped test alert",
  "alerts.refresh": "Re-polled NWS",
};

export function Activity() {
  const [log, setLog] = useState<Entry[] | null>(null);
  useEffect(() => {
    void call<Entry[]>("GET", "/api/admin/audit").then((r) => r.ok && setLog(r.data));
  }, []);

  return (
    <Page title="Activity" lead="The last 100 changes made from this admin.">
      <Card>
        {log === null ? (
          <p class="adm-hint">Loading…</p>
        ) : log.length === 0 ? (
          <p class="adm-hint">Nothing yet.</p>
        ) : (
          <ul class="adm-items compact">
            {log.map((e, i) => (
              <li key={`${e.t}-${i}`}>
                <div>
                  <b>{LABEL[e.action] ?? e.action}</b>
                  {e.detail && <span class="adm-hint"> · {e.detail}</span>}
                </div>
                <span class="adm-hint" title={clock(e.t)}>{ago(e.t)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
