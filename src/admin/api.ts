import { signal } from "@preact/signals";
import type { SiteConfig } from "../../shared/config";
import { DEFAULT_CONFIG } from "../../shared/config";
import { toast } from "./toast";

/** null = still checking */
export const authed = signal<boolean | null>(null);
export const config = signal<SiteConfig>(DEFAULT_CONFIG);
/** False until the saved settings have really been fetched. Pages must not open (or save) before that: they would show and write defaults. */
export const configLoaded = signal(false);
export const configFailed = signal(false);

export interface Result<T> {
  ok: boolean;
  status: number;
  data: T;
}

export async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 401 && path !== "/api/admin/login") authed.value = false;
  return { ok: res.ok, status: res.status, data: data as T };
}

export async function loadConfig(): Promise<void> {
  const r = await call<SiteConfig>("GET", "/api/admin/config");
  if (r.ok) {
    config.value = r.data;
    configLoaded.value = true;
    configFailed.value = false;
  } else if (!configLoaded.value) {
    configFailed.value = true;
  }
}

/** Merge a patch into the saved config and PUT it. */
export async function saveConfig(patch: Partial<SiteConfig>, message = "Saved"): Promise<boolean> {
  const r = await call<SiteConfig>("PUT", "/api/admin/config", { ...config.value, ...patch });
  if (r.ok) {
    config.value = r.data;
    toast(message);
  } else {
    toast("Couldn't save. Try again.", "error");
  }
  return r.ok;
}
