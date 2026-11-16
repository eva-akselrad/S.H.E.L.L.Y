import { useEffect, useState } from "preact/hooks";
import type { Announcement } from "../../shared/types";
import { call } from "./api";
import { toast } from "./toast";
import { Card, Chip, Field, Page, Segmented } from "./ui";
import { ago, clock, fromLocalInput } from "./util";

const EXPIRY = [
  { value: "1", label: "1 hour" },
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "1 day" },
  { value: "0", label: "No expiry" },
];

export function Announcements() {
  const [list, setList] = useState<Announcement[]>([]);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<"info" | "warn">("info");
  const [expiry, setExpiry] = useState("12");
  const [start, setStart] = useState("");

  const load = async () => {
    const r = await call<Announcement[]>("GET", "/api/admin/announcements");
    if (r.ok) setList(r.data);
  };
  useEffect(() => void load(), []);

  const add = async (e: Event) => {
    e.preventDefault();
    const starts = fromLocalInput(start);
    const base = starts ? new Date(starts).getTime() : Date.now();
    const hours = Number(expiry);
    const expires = hours > 0 ? new Date(base + hours * 3600_000).toISOString() : null;
    const r = await call("POST", "/api/announcements", { text, level, starts, expires });
    if (r.ok) {
      toast(starts ? "Announcement scheduled" : "Announcement is live");
      setText("");
      setStart("");
      void load();
    } else toast("Could not post it", "error");
  };

  const remove = async (id: string) => {
    const r = await call("DELETE", `/api/announcements?id=${encodeURIComponent(id)}`);
    if (r.ok) toast("Removed");
    void load();
  };

  const now = Date.now();
  return (
    <Page title="Announcements" lead="A banner across the top of every screen. Good for schedule changes, stream info, or a heads-up.">
      <div class="adm-cols">
        <Card title="New announcement">
          <form class="adm-form" onSubmit={add}>
            <Field label="Message" hint={`${text.length}/500`}>
              <textarea class="adm-input" rows={3} maxLength={500} required value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="Storms expected after 6 PM. Stay weather aware." />
            </Field>
            <div class="adm-field">
              <span class="adm-label">Style</span>
              <Segmented label="Style" value={level} onChange={setLevel} options={[{ value: "info", label: "Info" }, { value: "warn", label: "Warning" }]} />
            </div>
            <div class="adm-field">
              <span class="adm-label">Stays up for</span>
              <Segmented label="Duration" value={expiry} onChange={setExpiry} options={EXPIRY} />
            </div>
            <Field label="Start at (optional)" hint="Leave empty to go live immediately.">
              <input class="adm-input" type="datetime-local" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />
            </Field>
            {text && <div class={`adm-preview ann ${level === "warn" ? "warn" : ""}`}>{text}</div>}
            <button class="adm-btn primary" type="submit">{start ? "Schedule" : "Post now"}</button>
          </form>
        </Card>

        <Card title="Current and scheduled">
          {list.length === 0 ? (
            <p class="adm-hint">Nothing posted.</p>
          ) : (
            <ul class="adm-items">
              {list.map((a) => {
                const scheduled = a.starts && new Date(a.starts).getTime() > now;
                return (
                  <li key={a.id}>
                    <div>
                      <p>{a.text}</p>
                      <span class="adm-hint">
                        {scheduled ? `Starts ${clock(a.starts!)}` : `Live since ${ago(a.starts ?? a.created)}`}
                        {a.expires ? ` · ends ${clock(a.expires)}` : " · no expiry"}
                      </span>
                    </div>
                    <div class="adm-row">
                      <Chip kind={scheduled ? "info" : a.level === "warn" ? "warn" : "ok"}>{scheduled ? "Scheduled" : a.level === "warn" ? "Warning" : "Live"}</Chip>
                      <button type="button" class="adm-btn small" onClick={() => void remove(a.id)}>Remove</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}
