import { signal } from "@preact/signals";

/** null until we know; the report feature is admin-only for now, so its links stay hidden unless this is true. */
export const isAdmin = signal<boolean | null>(null);

let asked = false;
export function checkAdmin(): void {
  if (asked) return;
  asked = true;
  fetch("/api/admin/session")
    .then((r) => (r.ok ? r.json() : { authed: false }))
    .then((j: { authed?: boolean }) => (isAdmin.value = !!j.authed))
    .catch(() => (isAdmin.value = false));
}
