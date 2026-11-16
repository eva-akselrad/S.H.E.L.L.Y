/**
 * Simple single-password admin auth.
 *
 * - The password is the Worker secret ADMIN_PASSWORD (never in the repo).
 * - Login issues an HMAC-signed, HttpOnly, SameSite=Strict session cookie.
 * - Changing ADMIN_PASSWORD invalidates every existing session.
 * - Repeated failures from one IP are locked out for 15 minutes.
 * - Fails closed: with no ADMIN_PASSWORD set, nobody can log in.
 */

const COOKIE = "shelly_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_FAILS = 5;
const LOCKOUT_SECONDS = 15 * 60;

const enc = new TextEncoder();

const toB64Url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", enc.encode(s));
}

/** Constant-time string comparison (hash both so lengths match). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!; // fixed-length, no early exit
  return diff === 0;
}

async function sign(password: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(`shelly-session:${password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toB64Url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

function readCookie(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

export async function isAuthed(request: Request, env: Env): Promise<boolean> {
  const password = env.ADMIN_PASSWORD;
  if (!password) return false;
  const token = readCookie(request);
  if (!token) return false;
  const [exp, nonce, sig] = token.split(".");
  if (!exp || !nonce || !sig) return false;
  if (!(Number(exp) * 1000 > Date.now())) return false;
  return safeEqual(sig, await sign(password, `${exp}.${nonce}`));
}

const clientIp = (request: Request): string => request.headers.get("cf-connecting-ip") ?? "unknown";

export async function login(request: Request, env: Env): Promise<Response> {
  const password = env.ADMIN_PASSWORD;
  if (!password) return Response.json({ error: "admin_not_configured" }, { status: 503 });

  const failKey = `login-fail:${clientIp(request)}`;
  const fails = Number((await env.STATE.get(failKey)) ?? "0");
  if (fails >= MAX_FAILS) return Response.json({ error: "locked_out" }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const given = typeof body?.password === "string" ? body.password : "";

  if (!given || !(await safeEqual(given, password))) {
    await env.STATE.put(failKey, String(fails + 1), { expirationTtl: LOCKOUT_SECONDS });
    return Response.json({ error: "bad_password" }, { status: 401 });
  }

  await env.STATE.delete(failKey);
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const nonce = toB64Url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const token = `${exp}.${nonce}.${await sign(password, `${exp}.${nonce}`)}`;
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict` } },
  );
}

export function logout(): Response {
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` } },
  );
}
