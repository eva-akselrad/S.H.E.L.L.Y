# S.H.E.L.L.Y. Security Hardening Plan

Here is the implementation plan :3

## 1. Authentication & Session Management
- [ ] **Configure Proxy Trust**: Set `app.set('trust proxy', 1)` for Cloudflare compatibility.
- [ ] **Implement Brute-Force Tracking**:
    - In-memory `failedLogins` Map (IP -> { count, lockedUntil }).
    - 5 failed attempts = 15-minute lockout.
- [ ] **Shift to Session Tokens (JWT)**:
    - *Current State*: Password is sent in the header of every request.
    - *Upgrade*: Create a `/api/login` endpoint that returns a short-lived, signed JWT.
    - Update all admin endpoints to verify the JWT instead of the raw password.
- [ ] **Frontend Session Timeout**:
    - Automatically clear the stored token/password from `admin.html` after 30 minutes of inactivity.
    - Add a "Logout" button to manually clear the session.

## 2. Honeypot & Audit Logging
- [ ] **Implement Security Event Logging**:
    - Ring-buffer `securityLogs` (max 50 entries).
- [ ] **Implement Admin Audit Logs**:
    - Track successful admin actions (e.g., "Admin [IP] activated Armageddon", "Admin [IP] updated release notes").
    - This provides a trail of accountability for authorized users.
- [ ] **Create Honeypot**:
    - `GET /api/admin-backdoor` to flag and log bot/attacker IPs.
- [ ] **Expose Security Logs**:
    - `GET /api/security/logs` (JWT protected).
- [ ] **Admin Dashboard Update**:
    - Add a "Security & Audit" tab to `admin.html` with real-time log streaming.

## 3. Client & Content Security
- [ ] **Strict HTTP Headers**:
    - `Content-Security-Policy`: Restrict sources to `self` and specific domains (NOAA, OpenWeather, Google Fonts).
    - `X-Content-Type-Options: nosniff`.
    - `X-Frame-Options: DENY`.
    - `Strict-Transport-Security`.
- [ ] **Input Sanitization**:
    - Sanitize all admin-provided text (announcements, release notes) on the server to prevent Cross-Site Scripting (XSS) on kiosk clients.
- [ ] **API Payload Validation**:
    - Use a schema or strict checks for all `POST/PUT` bodies to prevent malformed data injection.

## 4. Infrastructure & Maintenance
- [ ] **Dependency Audit**:
    - Run `npm audit` and update any packages with known vulnerabilities.
- [ ] **Environment Security**:
    - Ensure secrets like `ADMIN_PASSWORD` and `VAPID_PRIVATE_KEY` are never logged or exposed in client-side code.
- [ ] **HTTPS Redirection**:
    - Enforce HTTPS via middleware to ensure all traffic is encrypted.

## 5. Bonus Tasks (Advanced)
- [ ] **MFA (TOTP)**: Add Google Authenticator support for the `/api/login` step.
- [ ] **CSRF Protection**: Implement `csurf` or similar for state-changing endpoints.
- [ ] **IP Whitelisting**: Add an optional `ADMIN_IP_WHITELIST` environment variable check.
- [ ] **Cloudflare Access**: Integrate Zero Trust authentication.

---
