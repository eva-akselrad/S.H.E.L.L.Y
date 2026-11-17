// Round-trip the RFC 8291 encryption with a browser-side decrypt, and verify the VAPID JWT.
import { expect, test } from "vitest";
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuth } from "../worker/webpush";

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}

/** What the browser does when a push arrives. */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = { name: "ECDH", public: asKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const secret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("aes128gcm payload decrypts on the receiving side", async () => {
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer));
  const msg = JSON.stringify({ title: "Tornado Warning for Home", body: "Take cover now." });
  const body = await encryptPayload(enc.encode(msg) as Uint8Array<ArrayBuffer>, p256dh, b64urlEncode(auth));
  expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
  expect(await decrypt(body, ua, auth)).toBe(msg);
});

test("VAPID header carries a valid ES256 JWT for the endpoint origin", async () => {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer));
  const privateKey = ((await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey).d!;
  const h = await vapidAuth("https://fcm.googleapis.com/fcm/send/abc", { publicKey, privateKey, subject: "mailto:test@example.com" }, Date.parse("2026-11-16T00:00:00Z"));
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
  expect(m).not.toBeNull();
  expect(m[4]).toBe(publicKey);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]!)));
  expect(claims.aud).toBe("https://fcm.googleapis.com");
  expect(claims.sub).toBe("mailto:test@example.com");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, b64urlDecode(m[3]!), enc.encode(`${m[1]}.${m[2]}`));
  expect(ok).toBe(true);
});
