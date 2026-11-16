import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Announcement } from "../shared/types";
import { Logo } from "./components/Chrome";
import "./styles/main.css";

/** Protected by Cloudflare Access (the Worker verifies the Access JWT on writes). */
function Admin() {
  const [list, setList] = useState<Announcement[]>([]);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<"info" | "warn">("info");
  const [hours, setHours] = useState("12");
  const [msg, setMsg] = useState("");

  const load = async () => {
    const r = await fetch("/api/announcements");
    if (r.ok) setList((await r.json()) as Announcement[]);
  };
  useEffect(() => void load(), []);

  const post = async (e: Event) => {
    e.preventDefault();
    const expires = Number(hours) > 0 ? new Date(Date.now() + Number(hours) * 3600_000).toISOString() : null;
    const r = await fetch("/api/announcements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, level, expires }),
    });
    setMsg(r.ok ? "Posted." : r.status === 401 ? "Not authorized (Cloudflare Access not configured or signed out)." : "Failed.");
    if (r.ok) {
      setText("");
      void load();
    }
  };
  const del = async (id: string) => {
    const r = await fetch(`/api/announcements?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setMsg(r.ok ? "Removed." : "Not authorized.");
    void load();
  };

  return (
    <div class="web">
      <header class="web-head"><Logo /><span class="muted">Admin · announcements</span></header>
      <main class="web-main">
        <form onSubmit={post} class="card" style={{ display: "grid", gap: "12px" }}>
          <label>Message (shown on every screen)
            <input style={{ width: "100%" }} maxLength={500} required value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          </label>
          <label>Style
            <select value={level} onChange={(e) => setLevel((e.target as HTMLSelectElement).value as "info" | "warn")}>
              <option value="info">Info</option><option value="warn">Warning</option>
            </select>
          </label>
          <label>Expires after (hours, 0 = never)
            <input type="number" min="0" value={hours} onInput={(e) => setHours((e.target as HTMLInputElement).value)} />
          </label>
          <button class="primary" type="submit">Post announcement</button>
          {msg && <p role="status">{msg}</p>}
        </form>
        <h3>Active</h3>
        <ul class="days">
          {list.map((a) => (
            <li key={a.id} style={{ gridTemplateColumns: "1fr auto" }}>
              <span>{a.text}</span>
              <button type="button" onClick={() => void del(a.id)}>Remove</button>
            </li>
          ))}
          {list.length === 0 && <li class="muted" style={{ gridTemplateColumns: "1fr" }}>None</li>}
        </ul>
      </main>
    </div>
  );
}

render(<Admin />, document.getElementById("app")!);
