import { expect, test } from "vitest";
import worker from "../worker/index";

test("health endpoint", async () => {
  const res = await worker.fetch(new Request("https://x/api/health"), {} as Env, {} as ExecutionContext);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, app: "SHELLY" });
});

test("unknown api route is 404", async () => {
  const res = await worker.fetch(new Request("https://x/api/nope"), {} as Env, {} as ExecutionContext);
  expect(res.status).toBe(404);
});

test("announcement writes are rejected without a session", async () => {
  const req = new Request("https://x/api/announcements", { method: "POST", body: JSON.stringify({ text: "hi" }) }) as Parameters<typeof worker.fetch>[0];
  const res = await worker.fetch(req, {} as Env, {} as ExecutionContext);
  expect(res.status).toBe(401);
});
