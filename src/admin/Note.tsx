import { useState } from "preact/hooks";
import { noteActive } from "../../shared/config";
import { config, saveConfig } from "./api";
import { Card, Chip, Field, Page, Segmented, Toggle } from "./ui";
import { inHours } from "./util";

const EXPIRY = [
  { value: "2", label: "2 hours" },
  { value: "6", label: "6 hours" },
  { value: "24", label: "1 day" },
  { value: "0", label: "No expiry" },
  { value: "keep", label: "Keep current" },
];

export function Note() {
  const n = config.value.note;
  const [enabled, setEnabled] = useState(n.enabled);
  const [title, setTitle] = useState(n.title);
  const [body, setBody] = useState(n.body);
  const [expiry, setExpiry] = useState(n.expires ? "keep" : "0");

  const save = () => {
    const expires = expiry === "keep" ? n.expires : Number(expiry) > 0 ? inHours(Number(expiry)) : null;
    void saveConfig({ note: { enabled, title: title.trim(), body, expires } }, enabled ? "Forecaster note saved" : "Note saved (hidden)");
  };

  const live = noteActive(config.value);
  return (
    <Page
      title="Forecaster note"
      lead="Your own words, added to the rotation as its own segment: a stream plan, a discussion of the setup, or a safety reminder."
      actions={<Chip kind={live ? "ok" : "muted"}>{live ? "On screens now" : "Not showing"}</Chip>}
    >
      <div class="adm-cols">
        <Card title="Message">
          <div class="adm-form">
            <Toggle checked={enabled} onChange={setEnabled} label="Show in the rotation" hint="Turn off to keep a draft without displaying it." />
            <Field label="Title (optional)">
              <input class="adm-input" maxLength={80} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="Tonight's setup" />
            </Field>
            <Field label="Text" hint={`${body.length}/1500`}>
              <textarea class="adm-input" rows={8} maxLength={1500} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} placeholder="Storms fire along the dryline after 4 PM…" />
            </Field>
            <div class="adm-field">
              <span class="adm-label">Hide automatically after</span>
              <Segmented label="Expiry" value={expiry} onChange={setExpiry} options={EXPIRY} />
            </div>
            <button type="button" class="adm-btn primary" onClick={save}>Save note</button>
          </div>
        </Card>
        <Card title="Preview" hint="How it looks as a segment.">
          <div class="adm-preview note">
            {title && <h3>{title}</h3>}
            <p>{body || "Nothing written yet."}</p>
          </div>
        </Card>
      </div>
    </Page>
  );
}
