# S.H.E.L.L.Y. // Architecture Overview

S.H.E.L.L.Y. (**Severe Hydrology & Environmental Live Logging Yearbook**) is a robust, edge-optimized weather communication system designed for high availability and low-latency response during critical events.

## 1. Core Principles
- **Edge-First**: Logic resides as close to the user as possible (Cloudflare network).
- **Stateless Backend**: In-memory or KV-backed stores ensure rapid scaling and resilience.
- **Fail-Safe**: Kiosk clients are designed to function even during backend degradation.
- **Security-Minded**: Built-in brute-force protection, honeypots, and strict sanitization.

## 2. Component Interaction

### **Frontend (Kiosk & Admin)**
- **Kiosk (`index.html`)**: A PWA that polls the backend for new announcements and global overrides. It uses Service Workers for offline caching and high performance.
- **Admin Panel (`admin.html`)**: A secure management interface for triggering alerts, managing release notes, and monitoring security logs.
- **Security Command Center (`demo.html`)**: A Matrix-themed visualization of the system's security posture.

### **Backend (The "Brain")**
- **Cloudflare Pages/Workers**: Handles API requests, performs authentication, and interacts with Workers KV.
- **Workers KV**: A globally distributed key-value store used for persisting messages, audit logs, and security state.
- **Web Push**: Sends real-time notifications to subscribed devices.

## 3. Data Flow

### **Announcement Lifecycle**
1. **Admin Input**: Admin submits an announcement via `admin.html`.
2. **Sanitization**: Backend (Node or Worker) uses `xss` library to strip malicious payloads.
3. **Storage**: Sanitized message is stored in Workers KV or in-memory.
4. **Push**: If requested, a Web Push fan-out is triggered to all subscribers.
5. **Polling**: Kiosk clients receive the new message on their next poll cycle (or immediate broadcast).

### **Security Lifecycle**
1. **Event Trigger**: A failed login or honeypot access occurs.
2. **Logging**: The event is recorded in a ring-buffer (last 50-100 events).
3. **Lockout**: The IP is added to a temporary lockout map in KV/memory.
4. **Visualization**: The Security Command Center fetches these logs for real-time display.

## 4. Deployment Modes

### **A. Local Development (`server.js`)**
- Uses **Express** and in-memory stores.
- Best for UI testing and rapid feature prototyping.

### **B. Edge Production (`worker.js` or `functions/`)**
- Uses **Cloudflare Workers/Pages** and **Workers KV**.
- Best for actual deployment and critical-event handling.
