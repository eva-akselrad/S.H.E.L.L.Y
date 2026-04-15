# Locked IPs Admin Management Feature

## Overview

Added persistent locked IP address tracking to KV database (Cloudflare) and in-memory storage (Node.js). This allows admins to:
- View all currently locked IP addresses
- Manually remove individual IPs from lockout
- Clear all locked IPs at once

## What Was Added

### 1. Cloudflare Pages (`functions/api/[[route]].js`)

#### Constants (Line 37)
```javascript
const KV_LOCKED_IPS_KEY = 'locked_ips';
```

#### Helper Functions (Lines 61-66)
```javascript
async function getLockedIPs(env)     // Retrieves locked IPs from KV
async function saveLockedIPs(env, locked) // Saves locked IPs to KV
```

#### Storage Format
```javascript
{
  "192.168.1.1": 1701234567890,      // IP address → Unix timestamp (expiry)
  "192.168.1.2": 1701234567890,
  ...
}
```

#### New Admin Endpoints

**GET /api/security/locked-ips** (Lines 461-472)
- Returns all currently locked IPs with remaining lockout time
- Requires authentication
- Response: `{ ips: [{ ip: "x.x.x.x", remainingSeconds: 123 }, ...] }`

**DELETE /api/security/locked-ips/:ip** (Lines 474-490)
- Remove a single IP from lockout
- Requires authentication
- URL encode the IP address if needed
- Response: `{ ok: true, message: "IP x.x.x.x removed from lockout" }`

**DELETE /api/security/locked-ips** (Lines 492-502)
- Clear ALL locked IPs at once
- Requires authentication
- Response: `{ ok: true, message: "Cleared N locked IP(s)" }`

#### Modified Endpoints

**POST /api/login** (Lines 300-338)
- Now adds IP to locked_ips in KV when lockout is triggered (5 failed attempts)
- Removes IP from locked_ips when successful login occurs

**GET /api/admin-backdoor** (Lines 340-350)
- Now adds IP to locked_ips in KV when honeypot is triggered

**POST /api/security/unlock** (Lines 373-381)
- Now removes IP from locked_ips in KV when CS242 password is entered

### 2. Node.js Server (`server.js`)

#### In-Memory Storage (Line 182)
```javascript
const lockedIPs = new Map();  // Map<ip, expiryTimestamp>
```

#### New Admin Endpoints

**GET /api/security/locked-ips** (Lines 423-440)
- Returns all currently locked IPs with remaining lockout time
- Automatically cleans up expired entries
- Response: `{ ips: [{ ip: "x.x.x.x", remainingSeconds: 123 }, ...] }`

**DELETE /api/security/locked-ips/:ip** (Lines 442-454)
- Remove a single IP from lockout
- URL decode the IP address
- Response: `{ ok: true, message: "IP x.x.x.x removed from lockout" }`

**DELETE /api/security/locked-ips** (Lines 456-464)
- Clear ALL locked IPs at once
- Response: `{ ok: true, message: "Cleared N locked IP(s)" }`

#### Modified Endpoints

**POST /api/login** (Lines 290-332)
- Now adds IP to lockedIPs Map when lockout is triggered
- Removes IP from lockedIPs Map when successful login occurs

**GET /api/admin-backdoor** (Lines 413-421)
- Now adds IP to lockedIPs Map when honeypot is triggered

**POST /api/security/unlock** (Lines 334-346)
- Now removes IP from lockedIPs Map when CS242 password is entered

## How Admins Use It

### View Locked IPs
```bash
curl -H "Authorization: Bearer <token>" \
  https://your-domain/api/security/locked-ips
```

Response:
```json
{
  "ips": [
    { "ip": "192.168.1.100", "remainingSeconds": 834 },
    { "ip": "192.168.1.101", "remainingSeconds": 542 }
  ]
}
```

### Remove Single IP
```bash
curl -X DELETE \
  -H "Authorization: Bearer <token>" \
  "https://your-domain/api/security/locked-ips/192.168.1.100"
```

Response:
```json
{
  "ok": true,
  "message": "IP 192.168.1.100 removed from lockout"
}
```

### Clear All Locked IPs
```bash
curl -X DELETE \
  -H "Authorization: Bearer <token>" \
  https://your-domain/api/security/locked-ips
```

Response:
```json
{
  "ok": true,
  "message": "Cleared 5 locked IP(s)"
}
```

## Edge Cases Handled

✅ **Expired IPs**: Automatically filtered out when retrieving list
✅ **Non-existent IP removal**: Returns 404 error with appropriate message
✅ **Empty list**: Returns `{ ips: [] }` when no IPs are locked
✅ **Double removal**: Returns 404 on second attempt (idempotent)
✅ **Authentication required**: All endpoints require valid admin token/password
✅ **Audit logging**: All admin actions logged in audit logs
✅ **URL encoding**: IP addresses are decoded when removing individual entries

## Integration with Existing Lockout Logic

### Lockout Triggers
1. **5 failed login attempts** → IP locked for 15 minutes (added to locked_ips)
2. **Honeypot access** (`/api/admin-backdoor`) → IP locked for 60 minutes (added to locked_ips)

### Lockout Removal Triggers
1. **Successful login** → IP removed from locked_ips, failedLogins reset
2. **CS242 password unlock** → IP removed from locked_ips, failedLogins reset
3. **Admin manual removal** → IP removed from locked_ips via admin endpoints

### Lockout Expiration
- **Automatic**: Expired entries are cleaned up when the list is retrieved
- **Manual**: Admins can remove IPs before natural expiration

## Audit Trail

All admin actions are logged:
- `Removed Locked IP` - When admin removes a single IP
- `Cleared All Locked IPs` - When admin clears all IPs

Audit logs include:
- Timestamp (ISO 8601)
- Action type
- Admin IP address
- Details (e.g., which IP was removed, how many were cleared)

## Security Considerations

✅ **Authentication required** - All endpoints require valid admin credentials
✅ **Rate limiting** - Endpoints use existing adminLimiter (60 req/min)
✅ **Audit trail** - All actions logged with admin IP address
✅ **No data loss** - Removal is immediate but logged in audit trail
✅ **Encrypted in KV** - Cloudflare KV handles encryption at rest

## Files Modified

1. **functions/api/[[route]].js**
   - Added `KV_LOCKED_IPS_KEY` constant (line 37)
   - Added `getLockedIPs()` and `saveLockedIPs()` helpers (lines 61-66)
   - Modified `/api/login` endpoint (lines 300-338)
   - Modified `/api/admin-backdoor` endpoint (lines 340-350)
   - Modified `/api/security/unlock` endpoint (lines 373-381)
   - Added 3 new `/api/security/locked-ips*` endpoints (lines 461-502)

2. **server.js**
   - Added `lockedIPs` Map declaration (line 182)
   - Modified `/api/login` endpoint (lines 290-332)
   - Modified `/api/admin-backdoor` endpoint (lines 413-421)
   - Modified `/api/security/unlock` endpoint (lines 334-346)
   - Added 3 new `/api/security/locked-ips*` endpoints (lines 423-464)

## Testing

### Manual Test - Trigger Lockout
1. Submit 5 wrong passwords to `/api/login`
2. IP is automatically locked for 15 minutes
3. IP is added to `locked_ips` in KV/memory

### Manual Test - View Locked IPs
1. Authenticate as admin
2. Call `GET /api/security/locked-ips`
3. Should see locked IPs with remaining seconds

### Manual Test - Remove Single IP
1. Get list of locked IPs
2. Call `DELETE /api/security/locked-ips/192.168.1.100`
3. That IP should no longer appear in the list
4. Check audit logs - should see "Removed Locked IP" entry

### Manual Test - Clear All
1. Lock multiple IPs
2. Call `DELETE /api/security/locked-ips`
3. All IPs should be cleared
4. Check audit logs - should see "Cleared All Locked IPs" entry
