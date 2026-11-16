// Secrets are not in wrangler.jsonc, so `wrangler types` can't see them.
// Set with: npx wrangler secret put ADMIN_PASSWORD
interface Env {
  ADMIN_PASSWORD?: string;
}
