# CityFlow Deployment Architecture

This document tracks the deployment decisions, architecture changes, and bug fixes applied to make CityFlow work flawlessly in a split production environment (Cloudflare Pages frontend + Raw VPS backend).

## 1. Local Port Conflicts (Windows / Hyper-V)
During local testing on Windows, both Vite and Flask threw `EACCES` (Permission Denied) errors despite the ports showing as free in `netstat`. 
- **Cause:** Windows Hyper-V and WSL2 dynamically reserve port ranges (e.g., `4932-5031` and sometimes `5173`) at the OS kernel level.
- **Fixes Applied:**
  - Vite was forced to bind to IPv4 (`host: '127.0.0.1'`) instead of the default IPv6 loopback (`::1`) which Windows often blocks.
  - Vite port changed from `5173` to `3000`.
  - Flask port changed from `5000` to `8000` (safely below the reserved ranges).

## 2. Server Binding
When deploying the Flask API to the VPS (`139.59.89.193`), the firewall was open but connections still timed out.
- **Cause:** Flask defaults to binding strictly to `127.0.0.1` (localhost), ignoring external internet traffic.
- **Fix Applied:** Updated `app.run` to include `host='0.0.0.0'` so Flask actively listens on the public VPS interface.

## 3. Serving Static Maps
Previously, the Flask simulator dumped generated `map_*.html` and `hotspot_heatmap.html` files directly into the React dashboard's `public/maps/` folder. 
- **Problem:** In a split production environment, the frontend is hosted statically on a CDN and doesn't share a filesystem with the backend.
- **Fix Applied:** 
  - Flask now saves maps locally to `src/api/static/maps`.
  - Added a new `@app.route('/maps/<path:filename>')` endpoint to Flask so it natively serves the maps over HTTP.

## 4. The Mixed Content Error & Cloudflare Pages Functions Proxy
The dashboard was successfully deployed to **Cloudflare Pages** (`https://cityflow.pages.dev`), but the browser blocked all API requests to the VPS.
- **Cause:** Browsers strictly block "Mixed Content" — an `https://` secure website cannot send data to an `http://` unencrypted IP address (`139.59.89.193`).
- **Solution Attempt 1 (DNS):** Route traffic through a Cloudflare subdomain (e.g., `api.capsicumwallideas.com`) using Proxy Status ON. This gives the backend free SSL. *(Abandoned for simplicity).*
- **Solution Attempt 2 (Pages Functions):** We implemented a Serverless proxy directly inside the Cloudflare Pages deployment.

### The Pages Functions Architecture (Final Solution)
Instead of dealing with SSL certificates or DNS records, we utilized **Cloudflare Pages Functions**.
1. We created two serverless edge functions:
   - `functions/api/[[path]].js`
   - `functions/maps/[[path]].js`
2. We updated the React frontend to use relative API URLs (e.g., `/api/events`).
3. **How it works:** When the browser requests `https://cityflow.pages.dev/api/events`, the request hits Cloudflare's Edge securely. The serverless function intercepts it, silently forwards the request over HTTP to the VPS (`139.59.89.193:8000`), and returns the data.
4. **Result:** 
   - Zero Mixed Content errors (the browser only sees HTTPS).
   - Zero CORS errors (the requests are technically same-origin).
   - Local dev is supported by mirroring this exact behavior using Vite's local `proxy` configuration in `vite.config.js`.

## 5. Conceptual Discussions & Architectural Decisions

Throughout the deployment process, several key architectural discussions shaped the final product:

### Standard Industry Deployment vs Serverless Proxy
We discussed how 99% of industry deployments handle split frontend/backend architectures:
- **Standard Approach:** Hosting the backend on a VPS and installing a reverse proxy like **NGINX** (or Caddy). The proxy listens on ports 80/443, and developers use **Certbot (Let's Encrypt)** to generate an SSL certificate for a subdomain (e.g., `api.domain.com`). NGINX decrypts the traffic and forwards it to the raw internal Flask/Node server.
- **Why we bypassed it:** For a hackathon, configuring NGINX and Certbot introduces unnecessary DevOps overhead. By using Cloudflare Pages Functions as a serverless proxy, we achieved the exact same secure, cross-origin architecture without writing a single NGINX config file or touching Let's Encrypt.

### The "Unfair Advantage" Core Logic
We explicitly moved away from simple tabular ML classification. The core logic now revolves around:
1. **Graph AI (OSMnx):** Extracting the real Bengaluru road network and using BFS shockwaves to simulate congestion spillover (Travel Time × 100 for closures, × 5 for spillover).
2. **ML Severity Predictor:** A hybrid model using a Gradient Boosting Regressor (for resolution time) and Random Forest Classifier (for Green/Amber/Red severity), augmented with cyclical time encoding and KMeans spatial clustering.
3. **Hotspot Analytics:** Using vectorised Haversine formulas to find nearby historical events instantly over 8,000+ records.

*(Note: The deep mathematical comparison between CityFlow and other routing approaches like CivitRAX is documented separately in `civitrax_vs_cityflow.md`).*
