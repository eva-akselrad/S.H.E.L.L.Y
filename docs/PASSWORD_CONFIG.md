# CS242 Password Configuration Guide

## Overview

WeatherNow now has **separate password system** for different access levels:

| Feature | Password Variable | Default Value | Purpose |
|---------|-----------------|---------------|---------|
| Admin Panel (`/admin`) | `ADMIN_PASSWORD` | `weathernow` | Announcement management, E.S.T.O.P. control |
| Demo Panel (`/cs242`) | `CS242_PASSWORD` | `cs242-security` | Security vulnerability demonstrations |
| Lockout Bypass | `CS242_PASSWORD` | `cs242-security` | Override full-site IP lockout |

## Why Separate Passwords?

1. **Security Isolation**: If CS242 demo password is compromised, admin access remains protected
2. **Access Control**: Students/presenters get demo access without admin privileges
3. **Audit Trail**: Separate passwords allow tracking who accessed what
4. **Flexibility**: Easy to change CS242 password for new class without disrupting admin

## Setup Instructions

### Local Development

Create `.env` file in project root:

```bash
# .env
ADMIN_PASSWORD=your_secure_admin_password
CS242_PASSWORD=your_cs242_demo_password
```

Start server:
```bash
npm start
```

### Cloudflare Pages Deployment

1. Go to **Cloudflare Pages → Settings → Environment Variables**
2. Add two production variables:
   - `ADMIN_PASSWORD` = your secure admin password
   - `CS242_PASSWORD` = your CS242 demo password
3. Redeploy the site

### Docker

Add to `docker-compose.yml`:

```yaml
environment:
  - ADMIN_PASSWORD=your_admin_password
  - CS242_PASSWORD=your_cs242_password
```

## Usage Examples

### Accessing Admin Panel
```
GET /admin
(Uses /api/login with ADMIN_PASSWORD)
```

### Accessing CS242 Demo Panel
```
GET /cs242?password=cs242-security
```

**Important**: Password is passed as query parameter. In production over HTTPS only.

### Bypassing IP Lockout
```
POST /api/security/unlock
Body: { "password": "cs242-security" }
```

When user is IP-locked, they enter CS242 password on lockout screen to bypass.

## Security Event Logging

All password-related events are logged:

```
[Security] CS242 Demo Accessed from 192.168.1.100 (Correct password provided)
[Security] Lockout Bypassed from 192.168.1.100 (User entered CS242 password to unlock)
[Security] Unlock Failed from 192.168.1.100 (Invalid unlock password attempt)
[Audit] Login Failed by 192.168.1.100 (Attempt 1/5)
```

View logs via `/api/security/logs` (admin only)

## Testing Lockout Flow

1. **Trigger lockout:**
   - Go to `/admin`
   - Enter wrong password 5 times
   - IP locked for 15 minutes

2. **Attempt unlock:**
   - Reload page → lockout screen appears
   - Enter: `cs242-security` (the CS242_PASSWORD)
   - Click UNLOCK
   - Page reloads, lockout cleared

3. **Test expired lockout:**
   - Wait 15 minutes for auto-unlock
   - Or use different IP/browser

## Migration from Single Password

If upgrading from old system with single password:

**Before:**
```
ADMIN_PASSWORD=mypassword  # Used for everything
```

**After:**
```
ADMIN_PASSWORD=mypassword          # Keep admin password
CS242_PASSWORD=different-password  # New demo password
```

No code changes needed—defaults work automatically.

## Security Best Practices

✅ **DO:**
- Use strong, unique passwords for each variable
- Set both variables in production
- Rotate CS242_PASSWORD before each class/presentation
- Use HTTPS for `/cs242?password=...` requests
- Monitor security logs for failed attempts
- Use Cloudflare Pages environment variables (encrypted at rest)

❌ **DON'T:**
- Use same password for both ADMIN_PASSWORD and CS242_PASSWORD
- Commit `.env` file with real passwords to Git
- Share CS242_PASSWORD in plain text emails
- Use weak passwords like "123456" or "password"
- Log full passwords to console

## Troubleshooting

**Q: CS242 demo shows 403 Forbidden**
A: Check:
1. Password in URL matches `CS242_PASSWORD` env var
2. URL format: `/cs242?password=YOUR_PASSWORD`
3. Case-sensitive password check
4. Server restarted after env var change

**Q: Can't bypass lockout**
A: Verify:
1. Using `CS242_PASSWORD` (not `ADMIN_PASSWORD`)
2. Password field not case-sensitive in unlock form
3. Rate limiter allows retries (2 per minute)
4. Check browser console for error messages

**Q: Want to disable CS242 demo**
A: Either:
1. Set `SECURITY_DEMO_ENABLED=false` in env
2. Don't provide CS242_PASSWORD to users
3. Remove `/cs242?password=...` link from docs

## Production Deployment Checklist

- [ ] Set `ADMIN_PASSWORD` to secure value
- [ ] Set `CS242_PASSWORD` to different secure value
- [ ] Both variables configured in Cloudflare Pages
- [ ] `NODE_ENV=production` in environment
- [ ] HTTPS enforced (automatic on Cloudflare)
- [ ] Security logs monitored
- [ ] Test lockout/unlock flow once deployed
- [ ] Document passwords securely (password manager)
- [ ] Share CS242_PASSWORD only with authorized users

## Support

For issues:
1. Check `/docs/demo.md` for detailed implementation docs
2. Review security logs: `/api/security/logs`
3. Verify environment variables set correctly
4. Check browser console for JavaScript errors
5. Inspect network tab for API responses
