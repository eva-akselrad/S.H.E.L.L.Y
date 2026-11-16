import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../shared/config";
import worker from "../worker/index";

type Req = Parameters<typeof worker.fetch>[0];

function fakeKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    get: async (k: string, type?: string) => {
      const v = m.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  } as unknown as KVNamespace;
}

// No test may hit the network (the alerts safety-net tries a background poll).
vi.stubGlobal("fetch", () => Promise.reject(new Error("offline in tests")));

let env: Env;
let cookie = "";
const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://x${path}`, init) as Req, env, ctx);
const authed = (method: string, path: string, body?: unknown) =>
  call(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(async () => {
  env = { STATE: fakeKv(), ADMIN_PASSWORD: "pw-for-tests" } as Env;
  const res = await call("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" },
    body: JSON.stringify({ password: "pw-for-tests" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
});

describe("admin routes require a session", () => {
  const routes: [string, string][] = [
    ["GET", "/api/admin/status"],
    ["GET", "/api/admin/config"],
    ["PUT", "/api/admin/config"],
    ["GET", "/api/admin/simulate"],
    ["POST", "/api/admin/simulate"],
    ["DELETE", "/api/admin/simulate"],
    ["POST", "/api/admin/refresh-alerts"],
    ["GET", "/api/admin/audit"],
    ["GET", "/api/admin/announcements"],
  ];
  test.each(routes)("%s %s is 401 without a cookie", async (method, path) => {
    expect((await call(path, { method })).status).toBe(401);
  });
});

describe("config", () => {
  test("public GET returns defaults, PUT validates and persists, public GET reflects it", async () => {
    expect(await (await call("/api/config")).json()).toMatchObject({ defaultMode: "auto", tts: true });
    const saved = await authed("PUT", "/api/admin/config", {
      defaultMode: "kiosk",
      hiddenSegments: ["air", "now"],
      segmentSeconds: { radar: 99999 },
      tts: false,
    });
    expect(saved.status).toBe(200);
    const pub = (await (await call("/api/config")).json()) as Record<string, unknown>;
    expect(pub).toMatchObject({ defaultMode: "kiosk", hiddenSegments: ["air"], tts: false });
    expect(pub.segmentSeconds).toEqual({ radar: 120 });
  });

  test("config changes are written to the activity log", async () => {
    await authed("PUT", "/api/admin/config", {});
    const log = (await (await authed("GET", "/api/admin/audit")).json()) as { action: string }[];
    expect(log[0]?.action).toBe("config.save");
  });
});

describe("announcements", () => {
  test("scheduled announcements are hidden from the public until they start", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    await authed("POST", "/api/announcements", { text: "later", starts: future });
    await authed("POST", "/api/announcements", { text: "now" });
    const pub = (await (await call("/api/announcements")).json()) as { text: string }[];
    expect(pub.map((a) => a.text)).toEqual(["now"]);
    const all = (await (await authed("GET", "/api/admin/announcements")).json()) as { text: string }[];
    expect(all.map((a) => a.text).sort()).toEqual(["later", "now"]);
  });

  test("expired announcements disappear", async () => {
    await authed("POST", "/api/announcements", { text: "old", expires: "2020-01-01T00:00:00Z" });
    expect(await (await call("/api/announcements")).json()).toEqual([]);
  });
});

describe("alert simulator", () => {
  const q = "/api/alerts?zones=PAZ106&lat=40.2&lon=-75.0";

  test("rejects an unknown preset", async () => {
    expect((await authed("POST", "/api/admin/simulate", { preset: "meteor" })).status).toBe(400);
  });

  test("a started test shows up in /api/alerts around the viewer, then can be stopped", async () => {
    expect(((await (await call(q)).json()) as { alerts: unknown[] }).alerts).toHaveLength(0);

    const start = await authed("POST", "/api/admin/simulate", { preset: "tornado-warning", minutes: 5 });
    expect(start.status).toBe(201);

    const body = (await (await call(q)).json()) as { alerts: { event: string; headline: string; zones: string[]; geometry: unknown }[] };
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toMatchObject({ event: "Tornado Warning", zones: ["PAZ106"] });
    expect(body.alerts[0]?.headline).toMatch(/^TEST:/);
    expect(body.alerts[0]?.geometry).not.toBeNull();

    await authed("DELETE", "/api/admin/simulate");
    expect(((await (await call(q)).json()) as { alerts: unknown[] }).alerts).toHaveLength(0);
  });

  test("test alerts need a viewer location (no coords, no simulated alert)", async () => {
    await authed("POST", "/api/admin/simulate", { preset: "tornado-warning", minutes: 5 });
    expect(((await (await call("/api/alerts?zones=PAZ106")).json()) as { alerts: unknown[] }).alerts).toHaveLength(0);
  });

  test("duration is clamped to 1..120 minutes", async () => {
    const r = (await (await authed("POST", "/api/admin/simulate", { preset: "heat-advisory", minutes: 100000 })).json()) as {
      created: string;
      expires: string;
    };
    const mins = (new Date(r.expires).getTime() - new Date(r.created).getTime()) / 60000;
    expect(mins).toBe(120);
  });
});

describe("status", () => {
  test("reports poller health with no data yet", async () => {
    const s = (await (await authed("GET", "/api/admin/status")).json()) as { poller: { updated: unknown; count: number } };
    expect(s.poller).toMatchObject({ updated: null, count: 0 });
  });
});

describe("SHELLY Live admin", () => {
  test("requires a session", async () => {
    expect((await call("/api/admin/live")).status).toBe(401);
  });
  test("creates a viewer token and saves it", async () => {
    const r = await authed("POST", "/api/admin/live/token");
    const { viewerToken } = (await r.json()) as { viewerToken: string };
    expect(viewerToken).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    const cfg = (await (await authed("GET", "/api/admin/config")).json()) as { live: { viewerToken: string } };
    expect(cfg.live.viewerToken).toBe(viewerToken);
  });
  test("the LLM test reports a missing key without calling out", async () => {
    const r = await authed("POST", "/api/admin/live/llm-test");
    expect(await r.json()).toMatchObject({ ok: false, error: "no_api_key" });
    expect(((await (await authed("GET", "/api/admin/live")).json()) as { keySet: boolean }).keySet).toBe(false);
  });
});

describe("Forecaster Studio API", () => {
  const product = (over: Record<string, unknown> = {}) => ({
    kind: "riskMap", title: "Risk", validFrom: new Date(Date.now() - 3600_000).toISOString(), validTo: new Date(Date.now() + 3600_000).toISOString(),
    published: true, body: { areas: [] }, ...over,
  });
  test("needs a session", async () => {
    expect((await call("/api/admin/studio")).status).toBe(401);
  });
  test("create, publish, appear publicly, expire, delete", async () => {
    const r = await authed("PUT", "/api/admin/studio", product());
    expect(r.status).toBe(200);
    const saved = (await r.json()) as { id: string };
    expect(saved.id).toBeTruthy();
    await authed("PUT", "/api/admin/studio", product({ title: "Draft", published: false }));
    await authed("PUT", "/api/admin/studio", product({ title: "Old", validTo: new Date(Date.now() - 60_000).toISOString() }));
    const pub = (await (await call("/api/studio")).json()) as { title: string }[];
    expect(pub.map((p) => p.title)).toEqual(["Risk"]);
    expect(((await (await authed("GET", "/api/admin/studio")).json()) as unknown[]).length).toBe(3);
    await authed("DELETE", `/api/admin/studio?id=${saved.id}`);
    expect(((await (await call("/api/studio")).json()) as unknown[]).length).toBe(0);
  });
  test("rejects an unusable product", async () => {
    expect((await authed("PUT", "/api/admin/studio", product({ kind: "bogus" }))).status).toBe(400);
    expect((await authed("PUT", "/api/admin/studio", product({ validFrom: "nope" }))).status).toBe(400);
  });
  test("a published product shows up as a map item in the live rundown", async () => {
    const { produceRundown } = await import("../worker/live");
    await authed("PUT", "/api/admin/studio", product({ title: "Tomorrow's Risk" }));
    const live = { ...DEFAULT_CONFIG.live, enabled: true };
    const r = await produceRundown(env, { ...DEFAULT_CONFIG, live });
    expect(r?.items.some((i) => i.kind === "map" && i.headline === "TOMORROW'S RISK")).toBe(true);
  });
});
