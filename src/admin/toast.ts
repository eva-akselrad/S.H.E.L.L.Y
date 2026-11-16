import { signal } from "@preact/signals";

export const toasts = signal<{ id: number; text: string; kind: "ok" | "error" }[]>([]);
let n = 0;

export function toast(text: string, kind: "ok" | "error" = "ok"): void {
  const id = ++n;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), 3500);
}
