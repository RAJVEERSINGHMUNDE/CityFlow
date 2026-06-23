# CityFlow — Hackathon Submission Deliverables

> Drop-in content for the hackathon website. All text below is copy-ready.

---

## 1. Title

**CityFlow: Event-Driven Congestion Intelligence for Bengaluru**

---

## 2. Description

CityFlow is a Graph-AI and Operations-Research digital twin that helps traffic-operations teams prepare for, respond to, and learn from event-driven congestion in Bengaluru. It replaces the three failure modes flagged in Problem Statement 2 — *unquantified event impact*, *experience-driven resource deployment*, and *no post-event learning* — with a fully data-driven pipeline.

**What it does, in one breath:** for any traffic event (planned rally, sports match, construction, accident, breakdown, water-logging, tree-fall, VIP movement), CityFlow forecasts how bad the disruption will be, recommends the optimal diversion routes, barricade locations, and police deployment, and updates itself every time an operator records what actually happened.

**How it works:**
- **Pre-event impact forecasting.** A Gradient Boosting regressor + Random Forest classifier predict severity level (Green / Amber / Red) and resolution time from 8,000+ historical Bengaluru incidents. A Cox Proportional Hazards model with right-censoring estimates clearance time, accounting for incidents still active at the data snapshot. A LaBSE multilingual classifier reads the operator's Kannada/English radio report and outputs a disruption probability that scales edge capacity.
- **Live spatial-temporal routing.** The Bengaluru road network (155K nodes, 393K edges, cached locally) is treated as a directed multi-graph. A reverse-BFS shockwave propagates capacity decay upstream from the epicenter using the Bureau of Public Roads formula, with a strict 3× penalty once V/C exceeds 0.85 so Dijkstra actually avoids spillback. Per-road-class hourly multipliers (motorway amplifies the rush signal; residential dampens it) make the recommended route genuinely differ between peak and off-peak.
- **Manpower and barricade allocation.** Up to 3 arterial origin–destination movements are ranked by `distance × capacity_score`. Barricades are placed at the nearest upstream node with a safe `out-degree`, so vehicles are never trapped into U-turns. A linear officer allocator combines severity, expected attendance, time-of-day and closure status, with weights re-fit via least-squares every 10 feedback entries. Shift duration is anchored to the 80th-percentile Cox survival estimate, not a hand-tuned clamp.
- **Post-event learning.** After every event, the operator logs what actually happened. The NLP classifier retrains on the union of original + feedback embeddings (no catastrophic forgetting), the manpower weights re-fit, and the forecast error is reported. The system literally gets more accurate the more it is used.
- **Operator UX.** A dark-themed React/Vite dashboard walks the operator through five steps: *what is happening* → *how bad is it* → *what does the city look like* (side-by-side maps: do-nothing vs. CityFlow plan) → *what does CityFlow recommend* (officers, barricades, shift) → *log the outcome*. Three pre-loaded demo events (cricket match at Chinnaswamy Stadium, heavy breakdown on ORR, Kannada radio report) showcase the full range in under a minute.

**Built on:** Python 3, Flask, SQLite, osmnx, networkx, scikit-learn, lifelines, sentence-transformers, folium, React 19, Vite 8, Tailwind 4.

---

## 3. Theme (one line)

> **A Graph-AI digital twin that turns Bengaluru's 8,000+ traffic incidents into a learnable, data-driven playbook for every rally, breakdown, and festival that disrupts the city.**

---

## 4. Screenshots

Use the four PNGs that already live in `src/dashboard/`. They are full-fidelity renders of the running app.

| # | File | What it shows | Recommended caption |
|---|------|---------------|---------------------|
| 1 | `src/dashboard/screenshot_full.png` | The complete analysis view for the cricket-match demo event — event card, severity assessment, impact metrics (60,000 person-delay min, 848 m queue, 23% congestion index, 702 nearby historical events), side-by-side baseline-vs-plan maps, recommended plan (44 officers, 4 barricades, 8h shift, 874 min saved across 3 routes). | "Story view of CityFlow analysing a 35,000-attendee cricket match: severity, impact forecast, side-by-side maps, and the recommended plan in one screen." |
| 2 | `src/dashboard/screenshot.png` | Smaller, focused view of the same view. | "CityFlow's full analysis for a planned mega-event." |
| 3 | `src/dashboard/screenshot_after_click.png` | The "after-click" state of the same analysis. | "Live simulation result rendered in the dashboard." |
| 4 | `src/dashboard/screenshot_test.png` | The MapComparison iframe view (the side-by-side baseline/plan maps and the legend). | "Split-screen: without intervention (left) vs. CityFlow's diversion plan (right)." |

**Re-capturing fresh screenshots (recommended before submission):**
```bash
# Terminal 1 — backend
python src/api/app.py

# Terminal 2 — frontend
cd src/dashboard && npm run dev
# open http://localhost:3000, click "Load demo", then click the Cricket Match card
# wait for the simulation to complete, then take a full-page screenshot
```

The screenshots are already large enough to read at 1440px wide; export as PNG at 100% zoom for best quality.

---

## 5. Pitch Video

> Status: *to be recorded* by the team. Use the script below (≈2 min 30 s, matches the 2–3-minute target in `doc/deliverables.md`).

**Title card (0:00 – 0:08):** "CityFlow — Event-Driven Congestion Intelligence for Bengaluru"

**Hook (0:08 – 0:25):**
> "Every rally, festival, and breakdown in Bengaluru is a one-shot experiment. Police deployment is experience-driven. Routes are decided by gut feel. And nobody learns from the last event. CityFlow fixes all three."

**Demo (0:25 – 1:30):** screen-record the dashboard.
1. Open `localhost:3000`, click **Load demo**, click the **Cricket Match** card (35,000 attendees at M. Chinnaswamy Stadium).
2. Pause on **Step 2 — How bad is it?**: show the impact numbers (60,000 person-delay minutes, 848 m queue, 23% congestion score) and the "What history says" panel.
3. Switch to **Step 3 — What does the city look like during this?**: show the side-by-side maps. Point out the red chaotic baseline and the green CityFlow plan with cyan diversion lines and orange barricades.
4. Scroll to **Step 4 — What does CityFlow recommend?**: 44 officers, 4 barricades, 8-hour shift, "874 minutes faster per trip, 85.7% less delay across 3 main routes".
5. Briefly show **Step 5** (Feedback panel) and the **Help → Glossary** modal.

**Architecture (1:30 – 2:10):** on a slide or animated diagram, name-drop the four pillars:
- BPR reverse-BFS shockwave on a real Bengaluru road graph (155K nodes)
- Cox Proportional Hazards survival model (right-censored, 2,983 cleared + 1,007 active records)
- LaBSE multilingual NLP on Kannada/English operator reports
- Post-event learning loop: least-squares manpower refit + NLP retrain without catastrophic forgetting

**Close (2:10 – 2:30):**
> "CityFlow — mathematical routing intelligence, not just colored lines on a map. Open source, end-to-end working, ready to deploy to any traffic control room."

**Capture settings:** 1920×1080, 30 fps, no zoom, dark mode of the OS so the dashboard dark theme reads cleanly.

**Where to host:** YouTube (unlisted) or Google Drive, then paste the link into the submission form. Confirm "Anyone with the link can view".

---

## 6. Presentation (PPT / Slides)

> 7 slides, 16:9, dark theme to match the dashboard.

**Slide 1 — Title**
- "CityFlow"
- Subtitle: "Event-Driven Congestion Intelligence for Bengaluru"
- Tagline: "A Graph-AI digital twin for the traffic control room"
- Team logo / names / hackathon name

**Slide 2 — The Problem (PS2)**
- "Event impact is not quantified in advance. Resource deployment is experience-driven. There is no post-event learning system."
- Three columns: (1) Planners fly blind, (2) Officers deployed by gut, (3) Same mistakes repeated.
- Visual: a photo of Bengaluru traffic with a red overlay.

**Slide 3 — The Idea**
- Big arrow: raw incident log → *learned* model → *deployable* plan.
- Four pillars labelled: Forecast, Route, Deploy, Learn.
- Dataset callout: 8,173 events, 870 Kannada descriptions, 151 days.

**Slide 4 — How It Works (architecture)**
- Architecture diagram (mimic `doc/technical_whitepaper.md` §4.2):
  - `2.csv` → `DataPipeline` → `SeverityPredictor` (GBM+RF) + `SurvivalModel` (Cox PH) + `HotspotAnalyzer` + `NLPImpactClassifier` (LaBSE)
  - `GraphEngine` (cached Bengaluru OSMnx) → `CongestionSimulator` (BPR shockwave + Dijkstra) → `ManpowerAllocator`
  - Flask API → React Dashboard (split-screen map) → SQLite (scenarios / feedback / tasks)
- Highlight the four unique algorithmic choices: reverse-BFS, BPR with V/C spillover penalty, continuous-flow barricading, differential per-class time-of-day weighting.

**Slide 5 — Live Demo Screenshots**
- The four screenshots from Section 4 arranged 2×2.
- Caption: "Same event, same data, but now the answer is a 44-officer plan that saves 874 min per trip."

**Slide 6 — The Learning Loop**
- Diagram: operator logs outcome → SQLite `feedback` table → every 10 entries → background thread re-fits manpower weights (`np.linalg.lstsq`) and retrains NLP (concatenated embeddings, no forgetting) → next event is more accurate.
- Show the JSON of a refit (or a screenshot of `manpower_weights.json`).

**Slide 7 — Impact & Next Steps**
- Headline numbers: 8,173 events trained on, 2,983 survival observations, 1,007 censored handled, Cox C-index in [0.5, 0.8] band, LaBSE multilingual, end-to-end working.
- "Ready to deploy: open-source, port 8000 Flask + port 3000 Vite, Cloudflare Pages proxy already wired in `functions/`. Swap the historical-replay feed for a live traffic API and the system is production-ready."
- QR code → GitHub repo. Team contact.

**Export:** PowerPoint (.pptx) is fine. Keep slide 5 as full-bleed images; the rest use a consistent dark background (`#020617` body, `#0f172a` cards, `#3b82f6` accent) so it visually matches the live app.

---

## 7. Instructions to Run the Project

### Prerequisites
- **Python 3.10+** with `pip`
- **Node.js 18+** with `npm`
- **Git**
- **~500 MB free disk** for the cached Bengaluru road graph and ML models
- **~2 GB free RAM** if the NLP LaBSE model is to be trained (skip on low-memory machines — see `deploy/patch_nlp.py`)

### One-time setup
```bash
# 1. Clone the repository
git clone <your-repo-url> CityFlow
cd CityFlow

# 2. Create a Python virtual environment (recommended)
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
# Linux / macOS
source .venv/bin/activate

# 3. Install Python dependencies
pip install -r src/requirements.txt
```

### Run the backend (Flask API, port 8000)
```bash
# from the repo root
python src/api/app.py
```
- First start downloads the Bengaluru road graph from OpenStreetMap into `src/simulator/cache/bengaluru_global.graphml` (~170 MB) and trains the severity / survival / NLP models in a background thread. Subsequent starts use the cache.
- The API listens on `http://localhost:8000`.
- A SQLite database is created at `src/api/cityflow.db` (scenarios, feedback, async task results).
- Heatmap and per-event maps are written to `src/api/static/maps/` and served at `/maps/...`.

### Run the frontend (React / Vite, port 3000)
```bash
cd src/dashboard
npm install
npm run dev
```
- Open `http://localhost:3000`.
- Vite is configured to proxy `/api` and `/maps` to `http://localhost:8000` (see `src/dashboard/vite.config.js`).

### Run both at once
```bash
# from the repo root
python src/run_all.py
```
- Spawns the Flask API and the Vite dev server side by side. Press `Ctrl+C` to stop both.

### Sanity-check
```bash
# Backend
curl http://localhost:8000/api/hotspots | head
curl http://localhost:8000/api/events  | head

# Frontend — open the URL above, click "Load demo", click any event card.
```

### Run the tests
```bash
# From the repo root
python -m unittest discover -s tests -v
```

### Run the 6-phase evaluation harness
```bash
python src/evaluate_model.py
# writes src/eval_results.txt
```

### Run the linter / build
```bash
# Frontend
cd src/dashboard
npm run lint
npm run build      # outputs src/dashboard/dist/
```

### Optional — production-style deploy
- A Cloudflare Pages → VPS reverse-proxy setup is already wired in `src/dashboard/functions/api/[[path]].js` and `src/dashboard/functions/maps/[[path]].js`. Update the `backendUrl` constant in those files to point at your server.
- A systemd unit is provided at `deploy/cityflow.service` and a bootstrap script at `deploy/start_server.sh`.

### Troubleshooting
- **`EACCES` on port 3000 / 8000 (Windows / Hyper-V):** Vite is already forced to `127.0.0.1` and Flask to port 8000 to avoid the Hyper-V reserved range. If you still hit it, set `PORT=3001` before `npm run dev` and update `vite.config.js` accordingly.
- **OSMnx download times out:** the network graph is cached in `src/simulator/cache/bengaluru_global.graphml`. If the cache is missing or stale, delete it and re-run — the loader uses `graph_from_place` which auto-paginates.
- **LaBSE OOM on a 4 GB server:** run `python deploy/patch_nlp.py` to disable NLP training. The system still works — the `nlp_disruption_prob` falls back to a neutral 0.5 and the multilingual highlight in the UI is skipped.
- **Mixed-content errors in production:** front the backend with HTTPS (NGINX + Let's Encrypt) or use the Cloudflare Pages Functions proxy in `src/dashboard/functions/`.

---

*End of deliverables. Submission form fields above are ready to paste in.*
