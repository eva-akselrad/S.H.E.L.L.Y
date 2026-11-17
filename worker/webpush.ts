// Web Push with no dependencies: RFC 8291 (aes128gcm message encryption) + RFC 8292 (VAPID).
// Keys use the same format as the `web-push` npm tool: base64url raw public key (65 bytes) and
// base64url private scalar (32 bytes).

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** TextEncoder output is typed as ArrayBufferLike in some lib versions; it is always a plain ArrayBuffer. */
const ab = (u: Uint8Array): Uint8Array<ArrayBuffer> => u as Uint8Array<ArrayBuffer>;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ab(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: ab(salt), info: ab(info) }, key, bytes * 8));
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** "mailto:..." or an https URL */
  subject: string;
}

async function vapidSigningKey(k: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(k.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("bad VAPID public key");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: k.privateKey,
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** VAPID Authorization header value for one push endpoint (RFC 8292). */
export async function vapidAuth(endpoint: string, k: VapidKeys, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: k.subject })));
  const unsigned = `${header}.${claims}`;
  const key = await vapidSigningKey(k);
  // WebCrypto ECDSA signatures are raw r||s, which is exactly what JWS ES256 wants
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, ab(enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${k.publicKey}`;
}

/**
 * Encrypt a payload for one subscription (RFC 8291, single aes128gcm record).
 * `salt` and `serverKeys` are only passed in tests.
 */
export async function encryptPayload(
  payload: Uint8Array<ArrayBuffer>,
  p256dh: string,
  auth: string,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
  serverKeys?: CryptoKeyPair,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("bad subscription keys");

  const as =
    serverKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", as.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // the runtime reads `public`; some type packages spell it `$public`, so cast the algorithm
  const ecdh = { name: "ECDH", public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, as.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(payload, new Uint8Array([2])); // 0x02 = last (and only) record, no padding
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));

  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** the subscription is gone (404/410) and should be deleted */
  gone: boolean;
}

/** Send one encrypted push message. */
export async function sendPush(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  data: unknown,
  k: VapidKeys,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string } = {},
): Promise<PushResult> {
  const body = await encryptPayload(ab(enc.encode(JSON.stringify(data))), sub.keys.p256dh, sub.keys.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuth(sub.endpoint, k),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttl ?? 3600),
    Urgency: opts.urgency ?? "normal",
  };
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await fetch(sub.endpoint, { method: "POST", headers, body });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
