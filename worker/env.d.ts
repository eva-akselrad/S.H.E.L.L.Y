// Secrets are not in wrangler.jsonc, so `wrangler types` can't see them.
// Set with: npx wrangler secret put ADMIN_PASSWORD   (and LLM_API_KEY for SHELLY Live host text)
// Push alerts: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL (see `node scripts/gen-vapid.mjs`)
interface Env {
  ADMIN_PASSWORD?: string;
  LLM_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_EMAIL?: string;
  /** Firebase service-account JSON for the Android app push (see docs/ANDROID.md) */
  FCM_SERVICE_ACCOUNT?: string;
}
