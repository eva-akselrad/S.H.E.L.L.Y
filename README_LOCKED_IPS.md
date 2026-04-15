# Locked IPs Admin Management - Complete Guide

## Overview

The Locked IPs Admin Management feature gives administrators the ability to view and manage IP address lockouts manually. Instead of waiting for the automatic 15-minute unlock period, admins can now:

- **View** all currently locked IPs with remaining time
- **Remove** specific IPs from lockout
- **Clear** all locked IPs at once

## Quick Start

### 1. Get Admin Token
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"password":"weathernow"}' | jq -r '.token')
```

### 2. View Locked IPs
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/security/locked-ips
```

### 3. Remove One IP
```bash
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/security/locked-ips/203.0.113.45"
```

### 4. Clear All
```bash
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/security/locked-ips
```

## API Endpoints

### GET /api/security/locked-ips
**Returns all currently locked IPs**

- **Authentication**: Required (admin token)
- **Rate Limit**: 60 req/minute
- **Response**: `{ ips: [{ ip, remainingSeconds }, ...] }`

### DELETE /api/security/locked-ips/:ip
**Remove a specific IP from lockout**

- **Authentication**: Required (admin token)
- **Rate Limit**: 60 req/minute
- **Response**: `{ ok: true, message: "IP x.x.x.x removed from lockout" }`
- **Errors**: 404 if IP not found, 401 if unauthorized

### DELETE /api/security/locked-ips
**Clear all locked IPs**

- **Authentication**: Required (admin token)
- **Rate Limit**: 60 req/minute
- **Response**: `{ ok: true, message: "Cleared N locked IP(s)" }`

## Implementation Details

### Cloudflare Pages Function
**File**: `functions/api/[[route]].js`

**Additions**:
- `KV_LOCKED_IPS_KEY` constant (line 37)
- `getLockedIPs()` and `saveLockedIPs()` helpers (lines 61-66)
- 3 new endpoints for locked IPs management (lines 461-502)
- Integration in `/api/login`, `/api/admin-backdoor`, `/api/security/unlock`

**Storage**: Cloudflare KV database
- Format: `{ "ip_address": expiry_timestamp }`
- Persistent across deployments

### Node.js Server
**File**: `server.js`

**Additions**:
- `lockedIPs` Map declaration (line 193)
- 3 new endpoints for locked IPs management (lines 423-464)
- Integration in `/api/login`, `/api/admin-backdoor`, `/api/security/unlock`

**Storage**: In-memory Map
- Resets when server restarts
- Ideal for development

## When IPs Get Locked

### Login Endpoint
After 5 failed login attempts on `POST /api/login`:
- IP is locked for **15 minutes**
- Added to `locked_ips` with expiry timestamp

### Honeypot Endpoint
Accessing `GET /api/admin-backdoor`:
- IP is locked for **60 minutes**
- Added to `locked_ips` with expiry timestamp

## When IPs Get Unlocked

### Automatic
- When lockout expires (15 min or 60 min)
- Automatic cleanup on next retrieval

### Manual
- Admin removes IP via `DELETE /api/security/locked-ips/:ip`
- Admin clears all via `DELETE /api/security/locked-ips`
- User enters CS242 password via `POST /api/security/unlock`

## Audit Trail

All admin actions are logged in the audit log:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/security/logs | jq '.audit'
```

**Sample audit entries**:
```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "action": "Removed Locked IP",
  "ip": "203.0.113.1",
  "details": "IP: 203.0.113.45"
},
{
  "timestamp": "2024-01-15T10:25:30.456Z",
  "action": "Cleared All Locked IPs",
  "ip": "203.0.113.1",
  "details": "Removed 5 IP(s)"
}
```

## Security

✅ **Authentication**: All endpoints require admin token/password
✅ **Rate Limiting**: Max 60 requests per minute
✅ **Audit Logging**: Every action logged with admin IP
✅ **Encryption**: KV data encrypted at rest by Cloudflare
✅ **Error Handling**: Proper HTTP status codes (401, 404, 429)

## Testing

### Run Test Suite
```bash
node test-locked-ips.js
```

This will:
1. Get admin token
2. Trigger a lockout (5 failed attempts)
3. List locked IPs
4. Remove the IP
5. Clear all remaining IPs
6. Verify each step

### Manual Testing
1. Start server: `npm run dev`
2. Trigger lockout: 5 wrong passwords to `/api/login`
3. List IPs: `curl -H "Authorization: Bearer $TOKEN" .../locked-ips`
4. Remove: `curl -X DELETE -H "Authorization: Bearer $TOKEN" .../locked-ips/IP`
5. Verify: `curl -H "Authorization: Bearer $TOKEN" .../locked-ips`

## Files

### Core Implementation
- `functions/api/[[route]].js` - Cloudflare Pages function
- `server.js` - Node.js Express server

### Documentation
- `LOCKED_IPS_API_REFERENCE.md` - Complete API reference
- `IMPLEMENTATION_SUMMARY.md` - Technical details
- `LOCKED_IPS_ADMIN_FEATURE.md` - Feature overview
- `LOCKED_IPS_FINAL_SUMMARY.md` - Comprehensive summary
- `VERIFICATION_CHECKLIST.md` - Implementation checklist

### Testing
- `test-locked-ips.js` - Automated test script

## Examples

### Python Script
```python
import requests
import json

base_url = "http://localhost:3000"
password = "weathernow"

# Get token
resp = requests.post(f"{base_url}/api/login", 
    json={"password": password})
token = resp.json()["token"]

# Get locked IPs
headers = {"Authorization": f"Bearer {token}"}
resp = requests.get(f"{base_url}/api/security/locked-ips", 
    headers=headers)
print("Locked IPs:", json.dumps(resp.json(), indent=2))

# Remove one IP
resp = requests.delete(
    f"{base_url}/api/security/locked-ips/203.0.113.45",
    headers=headers)
print("Removed:", resp.json())

# Clear all
resp = requests.delete(f"{base_url}/api/security/locked-ips",
    headers=headers)
print("Cleared:", resp.json())
```

### JavaScript (Node.js)
```javascript
const fetch = require('node-fetch');

async function test() {
  const baseUrl = 'http://localhost:3000';
  
  // Get token
  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'weathernow' })
  });
  const { token } = await loginRes.json();
  
  const headers = { 'Authorization': `Bearer ${token}` };
  
  // Get locked IPs
  const listRes = await fetch(`${baseUrl}/api/security/locked-ips`, { headers });
  console.log('Locked IPs:', await listRes.json());
  
  // Remove IP
  const removeRes = await fetch(
    `${baseUrl}/api/security/locked-ips/203.0.113.45`,
    { method: 'DELETE', headers }
  );
  console.log('Removed:', await removeRes.json());
}

test();
```

## Troubleshooting

### Can't Authenticate
- Verify password is correct: `echo $ADMIN_PASSWORD`
- Token expires in 1 hour: regenerate with `/api/login`
- Check token format: `Authorization: Bearer <token>`

### IP Not Found
- Verify IP is actually locked: `GET /api/security/locked-ips`
- Check IP address format (e.g., `192.168.1.1`)
- May be already unlocked or expired

### Rate Limited
- Getting 429 responses? Wait 1 minute, then retry
- Batch operations should space out requests
- Default: 60 requests/minute

### Server Restart Lost Data (Node.js)
- Node.js uses in-memory Map (not persistent)
- Cloudflare KV is persistent
- For production, use Cloudflare Pages

## Best Practices

1. **Always List First**
   - Check which IPs are locked before clearing all

2. **Document Your Actions**
   - Note reason for IP removal
   - Check audit logs after critical actions

3. **Monitor Patterns**
   - Regular lockouts from same IP = attack detection
   - Repeated removals = false positive configuration issue

4. **Security**
   - Never share admin tokens
   - Protect admin password
   - Use HTTPS in production
   - Audit logs are your security record

5. **Emergency Response**
   - Have `DELETE /api/security/locked-ips` script ready
   - Know how to get admin token quickly
   - Consider rate-limit exceptions for admins

## FAQ

**Q: How long do IPs stay locked?**
A: 15 minutes for login attempts, 60 minutes for honeypot. Admins can unlock anytime.

**Q: Can I whitelist certain IPs?**
A: Not in current implementation. Feature could be added via new endpoint.

**Q: Are lockouts persistent?**
A: Yes, in Cloudflare KV (persists). No, in Node.js (in-memory, resets on restart).

**Q: What if admin removes wrong IP?**
A: It gets re-locked on next failed attempt. Audit log shows what happened.

**Q: Can I schedule unlocks?**
A: Current implementation is manual. Could add scheduled jobs in future.

**Q: What's the max lockout duration?**
A: 60 minutes (honeypot). Can manually extend by triggering again.

**Q: How do I know who removed what IP?**
A: Check audit logs: `GET /api/security/logs`

**Q: Does this affect the frontend?**
A: No, purely admin functionality. Frontend sees standard lockout messages.

## Support

For issues or questions:
1. Check audit logs: `GET /api/security/logs`
2. Review API reference: `LOCKED_IPS_API_REFERENCE.md`
3. Run test script: `node test-locked-ips.js`
4. Check implementation: `IMPLEMENTATION_SUMMARY.md`

---

**Status**: ✅ Production Ready

All endpoints tested and verified. Full audit trail included. Ready for deployment.
