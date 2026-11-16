import { beforeEach, describe, expect, test } from "vitest";
import worker from "../worker/index";

type Req = Parameters<typeof worker.fetch>[0];

function fakeKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  } as unknown as KVNamespace;
}

let env: Env;
const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const call = (path: string, init: RequestInit = {}, e: Env = env) =>
  worker.fetch(new Request(`https://x${path}`, init) as Req, e, ctx);
const loginReq = (password: string) =>
  call("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
    body: JSON.stringify({ password }),
  });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

beforeEach(() => {
  env = { STATE: fakeKv(), ADMIN_PASSWORD: "correct horse battery" } as Env;
});

describe("admin auth", () => {
  test("wrong password is rejected and sets no cookie", async () => {
    const res = await loginReq("nope");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("correct password sets a hardened session cookie that authorizes writes", async () => {
    const res = await loginReq("correct horse battery");
    expect(res.status).toBe(200);
    const raw = res.headers.get("set-cookie")!;
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/SameSite=Strict/);

    const cookie = cookieOf(res);
    const session = await call("/api/admin/session", { headers: { cookie } });
    expect(await session.json()).toEqual({ authed: true });

    const post = await call("/api/announcements", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(post.status).toBe(201);
  });

  test("writes without a session are 401", async () => {
    const res = await call("/api/announcements", { method: "POST", body: JSON.stringify({ text: "x" }) });
    expect(res.status).toBe(401);
  });

  test("a tampered cookie is rejected", async () => {
    const cookie = cookieOf(await loginReq("correct horse battery"));
    const bad = cookie.slice(0, -3) + "AAA";
    const res = await call("/api/admin/session", { headers: { cookie: bad } });
    expect(await res.json()).toEqual({ authed: false });
  });

  test("changing the password invalidates old sessions", async () => {
    const cookie = cookieOf(await loginReq("correct horse battery"));
    const rotated = { ...env, ADMIN_PASSWORD: "a different password" } as Env;
    const res = await call("/api/admin/session", { headers: { cookie } }, rotated);
    expect(await res.json()).toEqual({ authed: false });
  });

  test("locks out after 5 failures, even with the right password", async () => {
    for (let i = 0; i < 5; i++) expect((await loginReq("bad")).status).toBe(401);
    expect((await loginReq("correct horse battery")).status).toBe(429);
  });

  test("fails closed when no ADMIN_PASSWORD is configured", async () => {
    env = { STATE: fakeKv() } as Env;
    expect((await loginReq("anything")).status).toBe(503);
    const res = await call("/api/announcements", { method: "POST", body: JSON.stringify({ text: "x" }) });
    expect(res.status).toBe(401);
  });

  test("logout clears the cookie", async () => {
    const res = await call("/api/admin/logout", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});
