# S.H.E.L.L.Y. – Severe Hydrology & Environmental Live Logging Yearbook

S.H.E.L.L.Y. is a high-availability, edge-optimized weather communication platform designed for kiosks, dashboards, and critical alert systems.

---

## 📖 Extensive Documentation

We have moved our detailed documentation to the `docs/` folder for better organization:

- **[Architecture Overview](docs/ARCHITECTURE.md)** – Deep dive into how S.H.E.L.L.Y. works.
- **[Security Hardening](docs/SECURITY.md)** – Detailed information on our multi-layered security approach.
- **[API Reference](docs/API.md)** – Complete guide to the system's endpoints.
- **[Cloudflare Workers Setup](docs/CLOUDFLARE_WORKERS.md)** – How to deploy S.H.E.L.L.Y. as a standalone Worker.
- **[Implementation Plan](docs/PLAN.md)** – The historical roadmap and current status.

---

## 🚀 Quick Start

### 1. Local Development
```bash
npm install
npm start
```
The server will be running at `http://localhost:3000`.
- **Admin Panel**: `http://localhost:3000/admin.html` (Password: `weathernow`)
- **Security Dashboard**: `http://localhost:3000/cs242`

### 2. Deployment Options

#### **Option A: Cloudflare Pages (Recommended)**
1. Connect your GitHub repository to Cloudflare Pages.
2. Set the build command to `npm install` (or leave empty if no build is needed).
3. Set the output directory to `.` (root).
4. Add your Environment Variables in the Pages dashboard.

#### **Option B: Cloudflare Workers**
1. Ensure `wrangler` is installed.
2. Update `wrangler.toml` with your KV namespace ID.
3. Run `npx wrangler deploy`.
4. See the **[Workers Guide](docs/CLOUDFLARE_WORKERS.md)** for details.

---

## 🛡 Security Demo
S.H.E.L.L.Y. includes a built-in Security Command Center at `/cs242`. Use this to test and visualize:
- **Brute Force Mitigation**
- **Honeypot Triggers**
- **XSS Sanitization**
- **Admin Audit Trails**

---

## 📄 License
This project is licensed under the MIT License.
