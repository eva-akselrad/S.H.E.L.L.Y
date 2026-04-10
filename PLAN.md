# S.H.E.L.L.Y. Security Hardening Plan

Here is the implementation plan :3 in no particular order

## 1. Authentication & Session Management
- [✓] **Configure Proxy Trust**: Set `app.set('trust proxy', 1)` for Cloudflare compatibility.
- [✓] **Implement Brute-Force Tracking**:
    - In-memory `failedLogins` Map (IP -> { count, lockedUntil }).
    - 5 failed attempts = 15-minute lockout.
- [✓] **Shift to Session Tokens (JWT)**:
    - *Current State*: Password is sent in the header of every request.
    - *Upgrade*: Create a `/api/login` endpoint that returns a short-lived, signed JWT.
    - Update all admin endpoints to verify the JWT instead of the raw password.
- [✓] **Frontend Session Timeout**:
    - Automatically clear the stored token/password from `admin.html` after 30 minutes of inactivity.
    - Add a "Logout" button to manually clear the session.

## 2. Honeypot & Audit Logging
- [✓] **Implement Security Event Logging**:
    - Ring-buffer `securityLogs` (max 50 entries).
- [✓] **Implement Admin Audit Logs**:
    - Track successful admin actions (e.g., "Admin [IP] activated Armageddon", "Admin [IP] updated release notes").
    - This provides a trail of accountability for authorized users.
- [✓] **Create Honeypot**:
    - `GET /api/admin-backdoor` to flag and log bot/attacker IPs.
- [✓] **Expose Security Logs**:
    - `GET /api/security/logs` (JWT protected).
- [✓] **Admin Dashboard Update**:
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

## 5. Security Demo Mode (/cs242)
- [ ] **Create Demo Dashboard**: `demo.html` with a specialized "Command Center" UI.
    - Matrix-style aesthetics (monochrome green, terminal fonts, "digital rain" background).
    - Real-time visualization of the ring buffers (Security & Audit).
- [ ] **Interactive Attack Simulators**:
    - "Simulate Brute Force": Button to trigger 5 failed logins and show the resulting lockout.
    - "Trigger Honeypot": Button to hit the `/api/admin-backdoor` and show the 403 response + log.
    - "JWT Decoder": Tool to inspect the current session token's payload/expiry.
    - "XSS Lab": A sandbox to test how announcements are sanitized before being sent to clients.
- [ ] **Threat Visualization**:
    - "Active Lockouts": A live list of IPs currently under brute-force or honeypot lockout with remaining time.
    - "Payload Inspector": A real-time capture of outgoing API requests and their JSON structure.
- [ ] **Backend Demo Controls**:
    - `POST /api/security/demo/reset`: Endpoint to clear `failedLogins` and logs for easy re-testing.
    - `POST /api/security/demo/expire-token`: Artificially expire the current session to demo auto-logout.
    - `SECURITY_DEMO_ENABLED` env variable to disable these endpoints in production.
- [ ] **Live Audit Trail**: A dedicated terminal-style view that scrolls as admin actions happen.


## 6. Bonus Tasks (Advanced)
- [ ] **MFA (TOTP)**: Add Google Authenticator support for the `/api/login` step.
- [ ] **CSRF Protection**: Implement `csurf` or similar for state-changing endpoints.
- [ ] **IP Whitelisting**: Add an optional `ADMIN_IP_WHITELIST` environment variable check.
- [ ] **Cloudflare Access**: Integrate Zero Trust authentication. (implemented already for preview deployments)

---
