# Locked IPs Management - Admin API Reference

## Authentication

All endpoints require admin authentication:

### Using Token (Recommended)
```bash
Authorization: Bearer <token>
```

### Using Legacy Password Header
```bash
x-admin-password: <password>
```

Obtain a token via `POST /api/login` with correct password.

---

## Endpoints

### 1. List All Locked IPs

**Endpoint**: `GET /api/security/locked-ips`

**Authentication**: Required (admin token or password)

**Rate Limit**: 60 requests/minute

**Description**: Returns all currently locked IP addresses with remaining lockout time. Automatically filters out expired entries.

**Request**:
```bash
curl -H "Authorization: Bearer <token>" \
  https://your-domain/api/security/locked-ips
```

**Response** (200 OK):
```json
{
  "ips": [
    {
      "ip": "192.168.1.100",
      "remainingSeconds": 834
    },
    {
      "ip": "192.168.1.101",
      "remainingSeconds": 542
    }
  ]
}
```

**Response** (401 Unauthorized):
```json
{
  "error": "Authentication required"
}
```

**Response** (Empty list - 200 OK):
```json
{
  "ips": []
}
```

---

### 2. Remove Single IP from Lockout

**Endpoint**: `DELETE /api/security/locked-ips/:ip`

**Authentication**: Required (admin token or password)

**Rate Limit**: 60 requests/minute

**Description**: Remove a specific IP address from the lockout list. Immediately lifts the lockout restriction for that IP.

**Request**:
```bash
# Simple IPv4
curl -X DELETE \
  -H "Authorization: Bearer <token>" \
  "https://your-domain/api/security/locked-ips/192.168.1.100"

# If IP has special characters (rare), URL encode it
curl -X DELETE \
  -H "Authorization: Bearer <token>" \
  "https://your-domain/api/security/locked-ips/$(echo '192.168.1.100' | jq -sRr @uri)"
```

**Response** (200 OK):
```json
{
  "ok": true,
  "message": "IP 192.168.1.100 removed from lockout"
}
```

**Response** (401 Unauthorized):
```json
{
  "error": "Authentication required"
}
```

**Response** (404 Not Found):
```json
{
  "error": "IP not found in lockout list"
}
```

---

### 3. Clear All Locked IPs

**Endpoint**: `DELETE /api/security/locked-ips`

**Authentication**: Required (admin token or password)

**Rate Limit**: 60 requests/minute

**Description**: Remove ALL locked IPs at once. This clears all login restrictions immediately.

**Request**:
```bash
curl -X DELETE \
  -H "Authorization: Bearer <token>" \
  https://your-domain/api/security/locked-ips
```

**Response** (200 OK):
```json
{
  "ok": true,
  "message": "Cleared 5 locked IP(s)"
}
```

**Response** (200 OK - Empty):
```json
{
  "ok": true,
  "message": "Cleared 0 locked IP(s)"
}
```

**Response** (401 Unauthorized):
```json
{
  "error": "Authentication required"
}
```

---

## Use Cases

### Use Case 1: Check Who's Locked Out

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"password":"weathernow"}' | jq -r '.token')

curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/security/locked-ips | jq '.'
```

**Output**:
```json
{
  "ips": [
    { "ip": "203.0.113.45", "remainingSeconds": 720 },
    { "ip": "203.0.113.46", "remainingSeconds": 650 }
  ]
}
```

### Use Case 2: Unlock a Specific User's IP

```bash
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/security/locked-ips/203.0.113.45"
```

**Output**:
```json
{
  "ok": true,
  "message": "IP 203.0.113.45 removed from lockout"
}
```

### Use Case 3: Emergency - Clear All Locks

```bash
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/security/locked-ips
```

**Output**:
```json
{
  "ok": true,
  "message": "Cleared 2 locked IP(s)"
}
```

### Use Case 4: Monitor Lockouts Over Time

```bash
while true; do
  echo "=== $(date) ==="
  curl -s -H "Authorization: Bearer $TOKEN" \
    http://localhost:3000/api/security/locked-ips | jq '.ips | length'
  sleep 60
done
```

---

## Integration with Audit Logs

When you perform these actions, they're automatically logged in the audit trail:

**View Audit Logs**:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/security/logs | jq '.audit'
```

**Audit Log Entries**:
```json
[
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
]
```

---

## Error Handling

### Authentication Errors

**Missing Token**:
```bash
curl http://localhost:3000/api/security/locked-ips
# 401: {"error":"Authentication required"}
```

**Invalid Token**:
```bash
curl -H "Authorization: Bearer invalid" \
  http://localhost:3000/api/security/locked-ips
# 401: {"error":"Invalid or expired session"}
```

### Rate Limiting

If you exceed 60 requests/minute:
```
429: {"error":"Too many requests"}
```

Wait a minute before retrying.

### IP Not Found

Trying to remove an IP that isn't locked:
```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/security/locked-ips/1.2.3.4
# 404: {"error":"IP not found in lockout list"}
```

---

## JavaScript/Node.js Examples

### Using Fetch API

```javascript
const token = 'your-admin-token';

// List locked IPs
const response = await fetch('/api/security/locked-ips', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { ips } = await response.json();
console.log('Locked IPs:', ips);

// Remove single IP
const removeResp = await fetch('/api/security/locked-ips/192.168.1.100', {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${token}` }
});
const result = await removeResp.json();
console.log(result.message);

// Clear all
const clearResp = await fetch('/api/security/locked-ips', {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${token}` }
});
const clearResult = await clearResp.json();
console.log(clearResult.message);
```

---

## Postman Collection

Import this to Postman:

```json
{
  "info": {
    "name": "Locked IPs Management",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "List Locked IPs",
      "request": {
        "method": "GET",
        "url": "{{base_url}}/api/security/locked-ips",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{token}}"
          }
        ]
      }
    },
    {
      "name": "Remove Single IP",
      "request": {
        "method": "DELETE",
        "url": "{{base_url}}/api/security/locked-ips/{{target_ip}}",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{token}}"
          }
        ]
      }
    },
    {
      "name": "Clear All Locked IPs",
      "request": {
        "method": "DELETE",
        "url": "{{base_url}}/api/security/locked-ips",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{token}}"
          }
        ]
      }
    }
  ]
}
```

---

## Troubleshooting

### Can't Connect to Server
- Ensure server is running: `node server.js`
- Check port: Default is 3000
- Verify firewall rules

### 401 Unauthorized
- Verify token is valid: `curl -H "Authorization: Bearer $TOKEN" /api/verify`
- Check token hasn't expired (1 hour expiry)
- Regenerate token: `POST /api/login` with correct password

### IP Address Shows Again
- IP may have gotten locked again (new failed login attempts)
- Check security logs: `GET /api/security/logs`

### Can't Remove Specific IP
- Verify IP format is correct (e.g., `192.168.1.1`)
- Check IP is in the locked list first
- URL encode if needed: `echo 'ip' | jq -sRr @uri`

---

## Best Practices

1. **Check Before Clearing**
   - Always list IPs first to see what will be cleared
   - Avoid clearing all IPs unless necessary

2. **Log Your Actions**
   - Document why you're removing an IP
   - Check audit logs after each action

3. **Monitor Lockouts**
   - Review locked IPs regularly
   - Pattern analysis for attack detection

4. **Rate Limiting Aware**
   - Automated scripts should respect rate limits
   - Add delays between batch operations

5. **Secure Your Token**
   - Never share admin tokens
   - Regenerate tokens if compromised
   - Use HTTPS in production

---

## Statistics

- **Lockout Duration**: 15 minutes (failed logins), 60 minutes (honeypot)
- **Auto-Cleanup**: Expired IPs automatically removed on retrieval
- **Max Audit Logs**: 100 entries (oldest removed when exceeded)
- **Rate Limit**: 60 requests per minute per IP
