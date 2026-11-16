import { effect, signal } from "@preact/signals";

export type Theme = "auto" | "light" | "dark";
const KEY = "shelly.v2.theme";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "auto" ? v : null;
  } catch {
    return null;
  }
}

export const theme = signal<Theme>(stored() ?? "auto");

export function setTheme(t: Theme): void {
  theme.value = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked: the choice just won't persist */
  }
}

export function cycleTheme(): void {
  setTheme(theme.value === "auto" ? "light" : theme.value === "light" ? "dark" : "auto");
}

/** The site-wide default from the admin, used only until the visitor picks their own. */
export function applyDefaultTheme(t: Theme): void {
  if (!stored()) theme.value = t;
}

effect(() => {
  const root = document.documentElement;
  if (theme.value === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme.value);
});
