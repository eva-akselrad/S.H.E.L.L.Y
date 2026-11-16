// Secrets are not in wrangler.jsonc, so `wrangler types` can't see them.
// Set with: npx wrangler secret put ADMIN_PASSWORD   (and LLM_API_KEY for SHELLY Live host text)
interface Env {
  ADMIN_PASSWORD?: string;
  LLM_API_KEY?: string;
}
