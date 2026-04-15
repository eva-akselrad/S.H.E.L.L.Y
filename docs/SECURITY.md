# S.H.E.L.L.Y. // Security Hardening

S.H.E.L.L.Y. is built with a "Security by Default" mindset to protect critical weather communication from malicious actors.

## 1. Authentication & Session Management
- **JWT (JSON Web Tokens)**: All administrative endpoints are protected by short-lived, signed JWTs.
- **Short-Lived Sessions**: Tokens expire after 1 hour of activity.
- **Auto-Logout**: Clients automatically clear tokens on expiration or manually via the admin panel.

## 2. Brute-Force & IP Protection
- **Rate Limiting**: Admin endpoints (`/api/login`, `/api/announce`) are rate-limited to 60 requests per minute.
- **IP Lockout**: After 5 failed login attempts, an IP is locked out for 15 minutes. This state is persisted in Workers KV.
- **Honeypot**: A fake admin route (`/api/admin-backdoor`) exists to immediately flag and lock out scanning bots.

## 3. Input & Content Security
- **XSS Sanitization**: All admin-provided text (announcements, armageddon overrides, release notes) is processed using the `xss` library to strip all scripts and malicious HTML.
- **Strict CSP (Content Security Policy)**:
    - Restricts script and style sources to known, trusted domains (self, NOAA, OpenWeather, Google Fonts).
    - Blocks all frames and objects by default.
- **HSTS (HTTP Strict Transport Security)**: Enforced in production to ensure all communication is encrypted via TLS.
- **Payload Validation**: All `POST` and `PUT` requests have strict type and length checks, with a 10kb body size limit.

## 4. Security Command Center (`demo.html`)
The specialized dashboard at `/cs242` provides a real-time visualization of these security measures:
- **Active Lockouts**: Shows a countdown for all IPs currently under temporary ban.
- **Security Audit Logs**: A live-scrolling view of all security-relevant events (logins, lockouts, honeypot triggers).
- **Admin Audit Trail**: A record of all authorized state-changing actions.
- **XSS Lab**: An interactive sandbox to verify the server-side sanitization of arbitrary inputs.

## 5. Deployment Best Practices
1. **Change the Default Password**: Always set a strong `ADMIN_PASSWORD` environment variable.
2. **Secure KV Bindings**: Ensure your Workers KV namespace is not public.
3. **Environment Isolation**: Use separate KV namespaces for staging and production.
4. **VAPID Keys**: Generate unique VAPID keys for Web Push and never commit the private key to source control.
