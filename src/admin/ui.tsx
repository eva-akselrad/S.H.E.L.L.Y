import type { ComponentChildren } from "preact";
import { toasts } from "./toast";

export function Page({ title, lead, actions, children }: { title: string; lead?: string; actions?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="adm-page">
      <header class="adm-pagehead">
        <div>
          <h1>{title}</h1>
          {lead && <p class="adm-lead">{lead}</p>}
        </div>
        {actions && <div class="adm-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, hint, children, tone }: { title?: string; hint?: string; children: ComponentChildren; tone?: "warn" | "danger" }) {
  return (
    <section class={`adm-card ${tone ?? ""}`}>
      {title && <h2>{title}</h2>}
      {hint && <p class="adm-hint">{hint}</p>}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="adm-field">
      <span class="adm-label">{label}</span>
      {children}
      {hint && <span class="adm-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label class="adm-toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="adm-switch" aria-hidden="true" />
      <span>
        <span class="adm-label">{label}</span>
        {hint && <span class="adm-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="adm-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} class={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ kind, children }: { kind: "ok" | "warn" | "danger" | "info" | "muted"; children: ComponentChildren }) {
  return <span class={`adm-chip ${kind}`}>{children}</span>;
}

export function Toasts() {
  return (
    <div class="adm-toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`adm-toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}
