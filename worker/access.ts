/** Verifies a Cloudflare Access JWT (RS256) against the team's JWKS. Fails closed. */

interface Jwk extends JsonWebKey {
  kid?: string;
}

const b64 = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const json = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64(s))) as T;

export async function verifyAccess(request: Request, env: Env): Promise<boolean> {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return false; // not configured: admin writes disabled

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts as [string, string, string];

  try {
    const header = json<{ kid?: string; alg?: string }>(h);
    const payload = json<{ aud?: string[] | string; exp?: number; iss?: string }>(p);
    if (header.alg !== "RS256") return false;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return false;
    if (payload.iss !== `https://${team}`) return false;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return false;

    const res = await fetch(`https://${team}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!res.ok) return false;
    const { keys } = (await res.json()) as { keys: Jwk[] };
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return false;

    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
      "verify",
    ]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return false;
  }
}
