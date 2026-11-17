// Generate a VAPID key pair for SHELLY push alerts (runs locally, nothing is sent anywhere).
// Usage:  node scripts/gen-vapid.mjs
// Then store them as Worker secrets:
//   npx wrangler secret put VAPID_PUBLIC_KEY
//   npx wrangler secret put VAPID_PRIVATE_KEY
//   npx wrangler secret put VAPID_EMAIL        (e.g. mailto:you@example.com)
// Keep the private key out of the repo. Changing keys later means every device must subscribe again.
const { webcrypto } = await import("node:crypto");
const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = Buffer.from(await webcrypto.subtle.exportKey("raw", kp.publicKey));
const jwk = await webcrypto.subtle.exportKey("jwk", kp.privateKey);
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
