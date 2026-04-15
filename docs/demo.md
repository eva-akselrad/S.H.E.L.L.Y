# CS242 Security Demo Panel & Site Lockout System

## Overview

This document describes the comprehensive security demonstration system for WeatherNow, including:
1. **Site-Wide Lockout Screen** - Blocks entire site when IP is rate-limited
2. **CS242 Security Demo Panel** (`/cs242`) - Interactive demonstrations of XSS, CSRF, and SQL Injection vulnerabilities
3. **Lockout Bypass System** - Emergency unlock via admin password

---

## Table of Contents

1. [Site-Wide Lockout System](#site-wide-lockout-system)
2. [Security Demo Panel](#security-demo-panel)
3. [CS242_DEMO_ENABLED Feature Toggle](#cs242_demo_enabled-feature-toggle)
4. [Implementation Details](#implementation-details)
5. [Files Modified](#files-modified)
6. [Usage Guide](#usage-guide)
7. [Testing](#testing)

---

## Site-Wide Lockout System

### Overview

When an IP address fails to authenticate 5 times within a short period, the entire WeatherNow site is blocked with a full-page lockout overlay. This prevents brute-force attacks and provides emergency recovery via a lockout password.

### How It Works

#### **Triggering the Lockout**
- 5 failed admin login attempts on `/api/login`
- OR accessing honeypot endpoint `/api/admin-backdoor`
- Lockout duration: **15 minutes**

#### **Client-Side Detection**
1. Page load → Check `/api/security/check-lockout` endpoint
2. If locked → Display full-page overlay, block main UI
3. If not locked → Load app normally
4. State persists via `sessionStorage` across page reloads

#### **Server-Side Tracking**
- `failedLogins` map stores IP → `{ count, lockedUntil }`
- `/api/security/check-lockout` returns lockout status
- `/api/security/unlock` validates password to bypass lockout

### Lockout Screen UI

When locked out, users see:
- **⛔ SYSTEM LOCKOUT** title in red
- Warning: "This IP address has been temporarily locked out"
- Countdown timer showing minutes remaining
- Password input field for bypass
- Error message area for feedback

### Features

✅ Full-page overlay (z-index: 10000)
✅ Blocks access to entire site
✅ Shows warning, reason, and countdown
✅ SessionStorage persistence across reloads
✅ Auto-unlock after 15 minutes
✅ Emergency bypass via admin password
✅ Rate-limited unlock attempts (2 per minute)
✅ Security event logging

---

## Security Demo Panel

### Access

To access the CS242 security demonstration panel:

```
https://your-domain.com/cs242?password=cs242-security
```

**Password Protection:**
- The `/cs242` endpoint is password-protected via query parameter
- Password verification happens SERVER-SIDE before the page is served
- Default password: `cs242-security` (configure via `CS242_PASSWORD` env var)
- Missing password: returns 404 if `CS242_DEMO_ENABLED=false`
- Incorrect password: returns 403 Forbidden (page NOT served)
- Correct password: returns 200 with demo.html served
- Successful access is logged to security audit
- No client-side password gate overlay - pure server-side validation

**Example URLs:**
- Local: `http://localhost:3000/cs242?password=cs242-security`
- Cloudflare Pages: `https://your-site.pages.dev/cs242?password=cs242-security`

### Demonstrations

The panel includes three vulnerability demonstrations with tabbed navigation:

#### **1. XSS (Cross-Site Scripting) Demo** 🔓

**What it shows:**
- Interactive payload input field
- 6 pre-loaded example payloads
- Side-by-side comparison: Vulnerable vs. Sanitized
- Real-time JavaScript execution (unsafe mode)

**Example Payloads:**
- `<img src=x onerror="alert('XSS')">`
- `<script>alert('XSS Attack')</script>`
- `<svg onload="alert('XSS')">`
- `<iframe src="javascript:alert('XSS')"></iframe>`
- `<div onclick="alert('XSS')">Click me</div>`
- CSS injection examples

**Key Features:**
- **Unsafe Mode**: Renders payload with `innerHTML` (shows vulnerability)
- **Safe Mode**: Calls `/api/security/demo/sanitize` endpoint (shows defense)
- Educational content on XSS types (Stored, Reflected, DOM-based)
- 6 defense strategies documented
- Safe code pattern examples

---

#### **2. CSRF (Cross-Site Request Forgery) Demo** 🎣

**What it shows:**
- How attackers trick users into making unintended requests
- Malicious attack patterns and code examples
- Defense mechanisms and their implementation

**Key Concepts:**
- Browser automatically sends cookies with requests
- Attacker can forge requests on user's behalf
- Victim's credentials used unintentionally

**Defense Mechanisms:**
1. **CSRF Token Validation** - Unique per-user tokens prevent forged requests
2. **SameSite Cookies** - Browser won't send cookies with cross-site requests
3. **Origin Header Checks** - Verify requests come from trusted domain
4. **Referer Checking** - Validate request source
5. **Double-Submit Cookie** - Token in both cookie and request body

**Features:**
- Clickable sections showing attack vs. defense code
- Educational explanations of each defense
- Real code patterns (non-executable for safety)

---

#### **3. SQL Injection Demo** 🔐

**What it shows:**
- Vulnerable SQL query patterns
- How SQL injection works
- Safe parameterized query patterns
- Real-world attack examples

**Vulnerability Examples:**
- Authentication bypass: `' OR '1'='1`
- Comment injection: `' OR 1=1 --`
- User impersonation: `admin'--`
- Data extraction: `' UNION SELECT * FROM passwords --`

**Side-by-Side Layout:**
- **Left side**: Vulnerable query pattern using string concatenation
- **Right side**: Safe query pattern using prepared statements

**Features:**
- Input field for custom SQL injection payloads
- 4 quick-inject example buttons
- Attack analysis showing injection impact
- 5 prevention techniques explained:
  1. Parameterized Queries / Prepared Statements
  2. Input Validation & Sanitization
  3. Character Escaping
  4. Least Privilege Database Accounts
  5. Web Application Firewall (WAF)

---

### Tabbed Interface Navigation

**Tab Navigation Methods:**
1. **Mouse**: Click tabs to switch between demos
2. **Keyboard**: Arrow keys (← →) to navigate tabs
3. **Persistent State**: localStorage remembers last selected tab

**Tab Features:**
- Active tab highlighted with green background and glow
- Smooth fade-in animation (0.3s) when switching tabs
- XSS demo active by default
- Responsive design (wraps on mobile)
- Matrix theme styling (green borders, dark background)

---

## Implementation Details

### Files Modified

#### **1. server.js**

**Added Endpoints:**

```javascript
GET /api/security/check-lockout
// Returns: { locked: boolean, minutesRemaining: number, reason: string }
// Purpose: Allows clients to check if their IP is locked out

POST /api/security/unlock
// Body: { password: string }
// Returns: { ok: true, message: "Lockout cleared" } or { error: "..." }
// Purpose: Validates password to bypass lockout
```

**Added Rate Limiter:**
```javascript
const unlockLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 minute window
  max: 2,                    // 2 attempts per window
  message: 'Too many unlock attempts',
  standardHeaders: true,
  legacyHeaders: false,
});
```

**Location:**
- `/api/security/check-lockout`: Lines 240-257
- `/api/security/unlock`: Lines 296-310
- `unlockLimiter`: Lines 210-217

---

#### **2. index.html**

**Added Lockout Screen Markup (Lines 35-54):**
```html
<div id="lockout-screen" class="lockout-screen hidden">
  <div class="lockout-container">
    <div class="lockout-header">
      <span class="lockout-title">⛔ SYSTEM LOCKOUT</span>
    </div>
    <div class="lockout-content">
      <div class="lockout-message">
        <p class="lockout-warning">This IP address has been temporarily locked out.</p>
        <p class="lockout-reason" id="lockout-reason">Reason: Too many failed login attempts</p>
        <p class="lockout-timer">⏱ <span id="lockout-minutes">15</span> minutes remaining</p>
      </div>
      <div class="lockout-form">
        <label for="lockout-password">Enter Lockout Password to Bypass:</label>
        <input type="password" id="lockout-password" placeholder="••••••••" autocomplete="off" />
        <button id="lockout-submit" class="lockout-btn">UNLOCK</button>
        <div id="lockout-error" class="lockout-error"></div>
      </div>
    </div>
  </div>
</div>
```

**Added Lockout Handler Script (~850 lines):**
- `checkLockout()` - Calls `/api/security/check-lockout`
- `showLockoutScreen()` - Displays overlay and disables main UI
- `hideLockoutScreen()` - Hides overlay and re-enables UI
- `updateLockoutTimer()` - Updates countdown every second
- `handleUnlock()` - Processes unlock attempt
- `initLockoutHandler()` - Main initialization function
- SessionStorage key: `weathernow_lockout_state`

**Key Functions:**
```javascript
// Check lockout status on page load
initLockoutHandler() {
  // Check sessionStorage first
  // If not found, call /api/security/check-lockout
  // Show lockout screen or load app accordingly
}

// Update countdown timer
updateLockoutTimer() {
  // Updates every 1000ms
  // Auto-reloads when timer reaches 0
}

// Handle unlock form submission
handleUnlock() {
  // Calls /api/security/unlock with password
  // Shows error on failure
  // Reloads on success
}
```

---

#### **3. css/weather.css**

**Added Lockout Screen Styling (Lines 2634-2776):**

```css
.lockout-screen {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.lockout-container {
  background: #0a0e1a;
  border: 2px solid #ef4444;
  border-radius: 12px;
  padding: 40px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 0 40px rgba(239, 68, 68, 0.3);
}

.lockout-btn {
  background: transparent;
  border: 2px solid #ef4444;
  color: #ef4444;
  padding: 12px 24px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 700;
  transition: all 0.3s;
}

.lockout-btn:hover {
  background: #ef4444;
  color: white;
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.5);
}
```

**CSS Classes:**
- `.lockout-screen` - Full-page overlay
- `.lockout-container` - Centered modal
- `.lockout-title` - Red title text
- `.lockout-warning` - Warning message
- `.lockout-timer` - Countdown display
- `.lockout-input` - Password field (glow on focus)
- `.lockout-btn` - Submit button (glow on hover)
- `.lockout-error` - Error message display
- `.hidden` - Hide class

---

#### **4. demo.html**

**Added Security Demos:**

**XSS Demo Section (Lines 654-737)**
- Interactive payload input
- Unsafe vs. Safe rendering
- 6 example payloads
- Side-by-side comparison

**CSRF Demo Section**
- Attack scenario explanation
- Defense code examples
- Mechanism explanations

**SQL Injection Demo Section**
- Vulnerable query patterns
- Injection examples
- Safe parameterized queries
- Attack analysis

**Tabbed Interface Integration:**
- `.demo-tabs-container` - Tab navigation
- `.demo-tab` - Individual tab buttons
- `.demo-section` - Demo containers
- `switchDemoTab(tabName)` - Tab switching function
- Keyboard navigation support
- localStorage persistence

---

### JavaScript Functions

#### Lockout Handler (index.html)

```javascript
// Main initialization
async function initLockoutHandler() {
  const stored = sessionStorage.getItem('weathernow_lockout_state');
  if (stored) {
    showLockoutScreen(JSON.parse(stored));
  } else {
    checkLockout();
  }
}

// Check if IP is locked out
async function checkLockout() {
  const response = await fetch('/api/security/check-lockout');
  const data = await response.json();
  if (data.locked) {
    showLockoutScreen(data);
  } else {
    initializeApp(); // Load app normally
  }
}

// Show lockout overlay
function showLockoutScreen(data) {
  const screen = document.getElementById('lockout-screen');
  const timer = document.getElementById('lockout-minutes');
  
  sessionStorage.setItem('weathernow_lockout_state', JSON.stringify({
    expiresAt: Date.now() + (data.minutesRemaining * 60 * 1000),
    reason: data.reason
  }));
  
  screen.classList.remove('hidden');
  updateLockoutTimer();
  setInterval(updateLockoutTimer, 1000);
}

// Update countdown timer
function updateLockoutTimer() {
  const stored = sessionStorage.getItem('weathernow_lockout_state');
  if (!stored) return;
  
  const { expiresAt } = JSON.parse(stored);
  const remaining = Math.ceil((expiresAt - Date.now()) / 60000);
  
  if (remaining <= 0) {
    location.reload();
  } else {
    document.getElementById('lockout-minutes').textContent = remaining;
  }
}

// Handle unlock attempt
async function handleUnlock() {
  const password = document.getElementById('lockout-password').value;
  const errorDiv = document.getElementById('lockout-error');
  
  try {
    const response = await fetch('/api/security/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    
    if (response.ok) {
      sessionStorage.removeItem('weathernow_lockout_state');
      location.reload();
    } else {
      errorDiv.textContent = '⚠ Invalid password';
      errorDiv.style.color = '#ef4444';
    }
  } catch (error) {
    errorDiv.textContent = '⚠ Error unlocking';
    errorDiv.style.color = '#ef4444';
  }
}
```

#### Demo Tab Switching (demo.html)

```javascript
// Switch between demo tabs
function switchDemoTab(tabName) {
  // Hide all sections
  document.querySelectorAll('.demo-section').forEach(section => {
    section.classList.remove('active');
  });
  
  // Remove active from all tabs
  document.querySelectorAll('.demo-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected section
  const section = document.getElementById(`demo-${tabName}-section`);
  if (section) section.classList.add('active');
  
  // Highlight selected tab
  event.target.classList.add('active');
  
  // Save preference
  localStorage.setItem('selectedDemoTab', tabName);
}

// Restore user's last selected tab
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('selectedDemoTab');
  if (saved) switchDemoTab(saved);
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  const tabs = Array.from(document.querySelectorAll('.demo-tab'));
  const active = document.querySelector('.demo-tab.active');
  if (!active) return;
  
  const index = tabs.indexOf(active);
  if (e.key === 'ArrowRight' && index < tabs.length - 1) {
    tabs[index + 1].click();
  } else if (e.key === 'ArrowLeft' && index > 0) {
    tabs[index - 1].click();
  }
});
```

---

## Usage Guide

### For Students (Learning Security)

1. **Access the demo panel:**
   - Visit `https://your-domain.com/cs242?password=cs242-security`
   - Replace `cs242-security` with the actual password if customized

2. **Explore vulnerabilities:**
   - Click tabs or use arrow keys to switch between XSS, CSRF, SQL Injection
   - Read explanations and code examples
   - Test payloads in the XSS demo
   - See side-by-side vulnerable vs. safe code

3. **Learn defenses:**
   - Study the "Safe Code" sections
   - Understand why parameterized queries prevent SQL injection
   - See how sanitization prevents XSS
   - Learn CSRF token validation patterns

### For Admins (Managing Lockouts & Passwords)

1. **When a user is locked out:**
   - They see a full-page lockout screen on their next page load
   - Show them: Enter CS242 password (same password as the `/cs242` demo panel)
   - Password stored as `CS242_PASSWORD` environment variable

2. **Password management:**
   - **Admin panel**: Uses `ADMIN_PASSWORD` (e.g., `weathernow`)
   - **CS242 demo panel**: Uses `CS242_PASSWORD` (e.g., `cs242-security`)
   - **Lockout bypass**: Uses `CS242_PASSWORD` (same as demo panel)
   - These are intentionally separate for different access levels

3. **To manually unlock:**
   - User enters correct `CS242_PASSWORD` when locked out
   - Or wait 15 minutes for auto-unlock
   - Or modify `failedLogins` map in server memory
   - Access is logged to security audit

4. **To test lockout:**
   - Attempt admin login 5 times with wrong password
   - Next page load will show lockout screen
   - Enter correct `CS242_PASSWORD` to bypass
   - (Or use a different IP to bypass rate limiting)

---

## Testing

### Manual Testing - Lockout Screen

1. Start WeatherNow server (`npm start`)
2. Open admin panel (`/admin`)
3. Enter wrong password 5 times
4. IP is now locked out for 15 minutes
5. Open new browser tab → lockout screen appears
6. Reload page → lockout persists (sessionStorage)
7. Enter correct CS242 password → auto-unlock and reload
8. Wait 15 minutes for auto-unlock

### Manual Testing - Demo Panel

1. Visit `/cs242?password=cs242-security`
2. Verify page loads successfully (correct password)
3. Try `/cs242?password=wrong` → should get 403 Forbidden
4. Try `/cs242` (no password) → should get 403 Forbidden
5. Click tabs or use arrow keys to navigate
6. Test XSS payloads:
   - Click example buttons
   - Click "Try Unsafe" to see vulnerability
   - Click "Try Safe" to see sanitized version
7. Read CSRF and SQL Injection explanations
8. Close browser and reopen → selected tab remembered

### Automated Tests

**Test files created:**
- `test-lockout.js` - Verifies lockout implementation
- `test-demo-integration.js` - Verifies demo UI integration

**Run tests:**
```bash
node test-lockout.js
node test-demo-integration.js
```

---

## CS242_DEMO_ENABLED Feature Toggle

### Complete Feature Disabling

When `CS242_DEMO_ENABLED=false`, the **entire CS242 demo system** becomes inaccessible as if it never existed:

**What Gets Disabled:**
- ✅ `/cs242?password=...` route returns **404 Not Found**
- ✅ `/api/security/enable-cs242-demo` returns **403 Forbidden**
- ✅ `/api/security/disable-cs242-demo` returns **403 Forbidden**
- ✅ `/api/security/cs242-status` returns `available: false`
- ✅ `/api/security/cs242-config` returns `available: false`
- ✅ IP lockout bypass with `CS242_PASSWORD` is **completely disabled**
- ✅ Admin panel dashboard control disappears entirely

**What Stays Enabled:**
- Regular admin panel login with `ADMIN_PASSWORD` works normally
- IP lockout still functions (but no bypass available)
- Users must wait 15 minutes for auto-unlock

### Use Cases

- **Production deployments**: Prevent any demo access entirely
- **Security audits**: Hide demo panel from non-authorized users
- **Education settings**: Disable between class sessions
- **Testing**: Verify system works without demo features

### Configuration

```bash
# Local development (.env file)
CS242_DEMO_ENABLED=true      # Default: enable all features

# Cloudflare Pages (Environment Variables)
CS242_DEMO_ENABLED=false     # Set to disable entire system

# Docker (docker-compose.yml)
environment:
  - CS242_DEMO_ENABLED=false
```

---

## Environment Variables

```bash
# Admin password (used for admin panel login only)
ADMIN_PASSWORD=your_secure_admin_password

# CS242 Security Demo password (used for /cs242 access AND lockout bypass)
CS242_PASSWORD=your_cs242_demo_password

# CS242 Demo Dashboard Control (admin panel feature toggle)
# Set to 'false' to COMPLETELY DISABLE the entire CS242 system:
# - /cs242?password=... route returns 404
# - /api/security/* endpoints return 403
# - Lockout bypass with CS242_PASSWORD is disabled
# - Admin panel control disappears
# Default: true (enabled)
CS242_DEMO_ENABLED=true

# Optional: Override VAPID keys
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=mailto:admin@example.com

# Optional: Enable/disable security demo
SECURITY_DEMO_ENABLED=true
```

**Important Notes:**
- `ADMIN_PASSWORD`: Used only for admin panel authentication
- `CS242_PASSWORD`: Used for both demo panel access (`/cs242?password=...`) AND lockout bypass (when enabled)
- `CS242_DEMO_ENABLED`: Controls entire CS242 system availability
  - `true` (default): All features enabled (demo page, lockout bypass, admin control)
  - `false`: Complete disabling (route returns 404, bypass disabled, admin control hidden)
- Default values: `ADMIN_PASSWORD=weathernow`, `CS242_PASSWORD=cs242-security`, `CS242_DEMO_ENABLED=true`
- In production, **always** set passwords securely

---

## Security Considerations

### Lockout System
- ✅ IP-based rate limiting prevents brute force
- ✅ 15-minute lockout period is reasonable
- ✅ Emergency bypass via separate `CS242_PASSWORD` (not admin password)
- ✅ Rate-limited unlock endpoint (2 attempts/min)
- ✅ All attempts logged to security logs
- ✅ SessionStorage used for state (not vulnerable to CSRF)

### Demo Panel
- ✅ Password-protected route (query parameter validation)
- ✅ Educational only - no real database interaction
- ✅ XSS demo uses sanitization API for safe rendering
- ✅ CSRF demo shows code patterns only (no execution)
- ✅ SQL injection demo shows query patterns only (no execution)
- ✅ Access logged to security audit

### Password Separation
- ✅ Admin panel (`/admin`) uses `ADMIN_PASSWORD`
- ✅ Demo panel (`/cs242`) uses `CS242_PASSWORD`
- ✅ Lockout bypass uses `CS242_PASSWORD` (not admin password)
- ✅ Separate passwords allow different access levels
- ✅ Compromised demo password doesn't compromise admin access

---

## Troubleshooting

**Issue:** Lockout screen not showing

**Solution:** 
1. Check `/api/security/check-lockout` returns correct status
2. Verify lockout screen div exists in index.html (id="lockout-screen")
3. Check browser console for JavaScript errors
4. Clear sessionStorage: `sessionStorage.clear()`

---

**Issue:** Cannot bypass lockout

**Solution:**
1. Verify `CS242_PASSWORD` is set correctly (not `ADMIN_PASSWORD`)
2. Check `/api/security/unlock` endpoint exists in server.js
3. Check rate limiter isn't blocking requests (wait 1 minute max)
4. Verify password field has correct ID (lockout-password)
5. Check error message in browser console

---

**Issue:** Cannot access `/cs242` demo panel

**Solution:**
1. Verify URL has correct password: `/cs242?password=YOUR_PASSWORD`
2. Check `CS242_PASSWORD` environment variable is set
3. Verify default password if env var not set: `cs242-security`
4. Check browser console for 403 Forbidden errors
5. Verify demo.html file exists in root directory

---

**Issue:** Demo tabs not working

**Solution:**
1. Check demo.html has `.demo-tabs-container` div
2. Verify tab buttons have `class="demo-tab"`
3. Verify sections have `class="demo-section" id="demo-*-section"`
4. Check browser console for JavaScript errors
5. Verify `switchDemoTab()` function exists in script

---

## Future Enhancements

- [ ] Persistent lockout storage (database instead of in-memory)
- [ ] IP whitelisting for trusted networks
- [ ] Exponential backoff for lockout duration
- [ ] TOTP/2FA support for admin panel
- [ ] More security demos (XXE, SSRF, Directory Traversal)
- [ ] Interactive sandbox environment for testing payloads
- [ ] Automated vulnerability scanning tool
- [ ] Real-time attack visualization

---

## Support

For questions or issues:
1. Check this documentation
2. Review code comments in implementation files
3. Check test files for examples
4. Refer to security best practices documentation in `/docs`
