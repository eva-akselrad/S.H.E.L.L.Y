# S.H.E.L.L.Y. // API Reference

All API endpoints are prefixed with `/api`.

## 1. Authentication
Most state-changing endpoints require an **Authorization** header with a valid JWT.

**Header Format**:
```http
Authorization: Bearer <your-jwt-token>
```

---

## 2. Public Endpoints

### `GET /api/poll`
Fetches all active messages and the current global override (Armageddon) state.

- **Query Parameters**:
  - `since`: (Optional) The last message ID the client received.
- **Response**:
  ```json
  {
    "messages": [ ... ],
    "armageddon": { "active": true, "title": "...", "text": "...", "type": "...", "expiresAt": 123456789 }
  }
  ```

### `GET /api/health`
Returns system status.
- **Response**: `{ "ok": true, "uptime": 12345, "pushSubscribers": 5 }`

### `POST /api/login`
Exchanges a password for a JWT.
- **Body**: `{ "password": "..." }`
- **Response**: `{ "token": "..." }`

---

## 3. Administrative Endpoints (Requires Auth)

### `POST /api/announce`
Broadcasts a new message to all clients.
- **Body**:
  ```json
  {
    "text": "...",
    "title": "...",
    "type": "info | warning | emergency | success",
    "display": "banner | modal | kiosk",
    "duration": 60,
    "tts": true,
    "push": true,
    "targeting": { "mode": "all" }
  }
  ```

### `POST /api/armageddon`
Activates a global override.
- **Body**: `{ "title": "...", "text": "...", "type": "...", "duration": 30 }`

### `GET /api/security/logs`
Returns the recent security and audit logs.
- **Response**:
  ```json
  {
    "security": [ { "timestamp": "...", "event": "...", "ip": "...", "details": "..." } ],
    "audit": [ { "timestamp": "...", "action": "...", "ip": "...", "details": "..." } ]
  }
  ```

### `PUT /api/app-update`
Updates global application version and auto-update settings.
- **Body**: `{ "version": "...", "autoUpdateEnabled": true }`

---

## 4. Web Push Endpoints

### `GET /api/push/vapid-key`
Returns the public VAPID key.
- **Response**: `{ "publicKey": "..." }`

### `POST /api/push/subscribe`
Registers a new device for push notifications.
- **Body**: Standard Web Push Subscription object.
