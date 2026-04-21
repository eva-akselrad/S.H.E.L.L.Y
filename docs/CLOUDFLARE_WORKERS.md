# S.H.E.L.L.Y. // Cloudflare Workers Setup Guide

This document explains how to deploy the S.H.E.L.L.Y. backend as a **Cloudflare Worker** instead of using **Cloudflare Pages Functions**.

## 1. Overview: Workers vs. Pages

| Feature | Cloudflare Pages (Functions) | Cloudflare Workers |
|---------|----------------------------|-------------------|
| **Primary Use** | Full-stack static sites with APIs | High-performance standalone APIs |
| **Routing** | Filesystem-based (`/functions/api`) | Programmatic (middleware/regex) |
| **Assets** | Automatic static asset hosting | Manual or `assets` field in `wrangler.toml` |
| **Cold Starts** | Same as Workers | Same as Pages |
| **Complexity** | Simple for standard apps | More flexible, but more setup |

### Why use a Worker?
- **More Control**: You can customize exactly how requests are routed and handled before they even reach your logic.
- **Portability**: The logic is contained in a single `worker.js` rather than being spread across multiple files.
- **Unified Logic**: Better if you want to use the same logic for multiple domains or different types of frontends.

---

## 2. Setting Up on a Worker

### 1. Prerequisites
- Ensure you have the `wrangler` CLI installed (`npm install -g wrangler`).
- Run `wrangler login` to authenticate.

### 2. Prepare the `worker.js`
The `worker.js` entry point is at the root. It uses the `fetch` export instead of the `onRequest` Pages-specific handler.

### 3. Create a `wrangler.toml`
Create a `wrangler.toml` in the project root:

```toml
name = "shelly-worker"
main = "worker.js"
compatibility_date = "2024-04-15"

# Serve static assets (modern Wrangler feature)
[assets]
directory = "./"
binding = "ASSETS"

[[kv_namespaces]]
binding = "WEATHERNOW_KV"
id = "YOUR_KV_NAMESPACE_ID"

[vars]
ADMIN_PASSWORD = "your-secure-password"
VAPID_PUBLIC_KEY = "your-public-key"
VAPID_PRIVATE_KEY = "your-private-key"
VAPID_EMAIL = "mailto:admin@example.com"
SECURITY_DEMO_ENABLED = "true"
```

### 4. Create your KV Namespace
Create the KV namespace via the dashboard or CLI:
```bash
npx wrangler kv:namespace create WEATHERNOW_KV
```
Then copy the `id` from the output into your `wrangler.toml`.

### 5. Deploy
```bash
npx wrangler deploy
```

---

## 3. Pros and Cons Detailed

### **Cloudflare Pages (Current Setup)**
- **PRO**: **Zero-config assets.** Just push to GitHub and everything (HTML, JS, CSS) works.
- **PRO**: **Atomic deployments.** Both frontend and backend are deployed together.
- **CON**: Less control over the routing engine.
- **CON**: `/functions` folder is mandatory.

### **Cloudflare Workers**
- **PRO**: **Extreme Flexibility.** Can handle complex protocols, WebSocket, or R2 bucket interaction with more ease.
- **PRO**: **Advanced Routing.** Can use middleware like Hono or Toucan for more elegant code.
- **CON**: **Manual Assets.** Requires the new `[assets]` configuration or using `kv-asset-handler`.
- **CON**: **Higher Setup.** More boilerplate to get the same results as Pages.

---

## 4. Architecture Migration
To use a Worker, we've provided a `worker.js` at the root that mirrors the logic in `/functions/api/[[route]].js` but adapts it to the Worker `fetch` handler.
