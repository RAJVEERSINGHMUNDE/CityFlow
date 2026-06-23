# PS2 Digital Twin & Diversion Simulator: Technical Decisions & Documentation

This document chronicles the decisions, code structure, and logic used to build the Event‑Driven Congestion Simulator for Problem Statement 2.

## 1. Project Initialization & Architecture

**Decision 1: The Novel Approach**
Instead of a simple classification model, we built a microscopic traffic simulation using Graph Theory. This directly addresses the prompt's requirement to *recommend optimal barricading and diversion plans*.

**Decision 2: Technology Stack**
- `pandas` / `numpy`: Data cleaning.
- `osmnx`: Fetch real‑world road networks from OpenStreetMap.
- `networkx`: Graph modeling and pathfinding.
- `folium`: Interactive HTML maps.

## 2. Code Documentation

### Phase 2: Data Preprocessing (`src/simulator/data_pipeline.py`)
* Clean `2.csv`, drop rows without latitude/longitude.
* Convert `start_datetime` to `datetime` for time‑of‑day weighting.
* Extract `event_type` (planned/unplanned), `route_path`, `corridor`, `veh_type`, and `description` for each event.

### Phase 3: Graph Construction (`src/simulator/graph_engine.py`)
* Pre‑download and cache a global Bengaluru road network graph at `src/simulator/cache/bengaluru_global.graphml` (155,373 nodes, 393,731 edges).
* On startup, load the global `.graphml`; per‑request sub‑graph extraction avoids repeated Overpass API calls.
* Apply `ox.add_edge_speeds()` and `ox.add_edge_travel_times()` for free‑flow baselines.

### Phase 4 & 5: Congestion Simulation & Diversion Optimizer (`src/simulator/simulator.py`)
* **Shockwave Model** – BPR reverse‑BFS capacity‑decay. Closed edges get `capacity × 0.05`; spillover edges decay linearly with upstream distance via `0.1 + 0.9 × dist/spillover`.
* **Differential Time‑of‑Day Routing** – Per‑class hourly‑calibrated multipliers from `hotspot_analyzer.get_hourly_multiplier(hour)`, clamped to `max(0.1, …)`. Arterials (motorway/primary) amplify the hourly signal; residential dampens it — the route actually changes between peak and off‑peak.
* **Volume‑Aware Flow Selection** – Ranks arterial OD pairs by `distance × capacity_score`, where `capacity_score` averages road capacity along the route. Returns up to 3 flows that cross the event epicenter.
* **Diversion** – Dijkstra on capacity‑adjusted graph. `police_deployed=True` omits closed edges (95% compliance); `police_deployed=False` multiplies travel time by 2.5 (40% compliance). Every flow gets a `police_compliance_benefit_minutes` metric.
* **Barricade Generation** – Finds upstream nodes with remaining out‑degree, ensuring continuous flow. Validates each barricade blocks at least one closure entry.
* **Diversion Plan Synthesis** – Aggregates flow results, barricade assignments, and officer counts into a structured `diversion_plan` with `plan_summary` and `barricade_plan`.

### Phase 6: Production Web UI & API (`src/api` & `src/dashboard`)
* Flask API with background thread pool for async simulation tasks.
* **Endpoints**: `GET /api/events`, `GET /api/severity/<id>`, `POST /api/simulate/<id>`, `GET /api/status/<task_id>`, `POST /api/feedback`, `GET /api/feedback/summary`, `GET /api/hotspots`, `GET /api/realtime/incidents`.
* React Vite frontend polls `/api/status/<task_id>` and displays the generated Folium map.
* `event_type` (planned/unplanned) routes through different code paths: planned events use `route_path` for closure edges and `derive_spillover_radius(attendance)` for the shockwave footprint.

### Phase 7: Model Training & Severity Prediction Pipeline
* **Severity Model** – Gradient‑boosted regression (log‑space resolution time) + Random Forest classifier (Green/Amber/Red). Trained on 2,957 events. Two‑head output.
* **Survival Model** – Cox Proportional Hazards with right‑censoring (`E=0` for un‑resolved events), `hour_sin`/`hour_cos` covariates, C‑index concordance, and `t80` percentile clearance estimates.
* **Hotspot Analyzer** – Pre‑computes junction rankings (MekhriCircle: 64 events), hourly/multi‑monthly temporal curves, and a hexbin heatmap. Exposes `get_hourly_multiplier(hour)` for time‑of‑day routing.
* **NLP Weak‑Label Classifier** – `sentence-transformers/LaBSE` (multilingual CPU, ~90 MB) encodes event descriptions; logistic regression head predicts disruption probability. Retrained without catastrophic forgetting via concatenated training set. *Note: skipped on low‑memory deployments (< 8 GB).*
* **Impact Forecast Module** – Pre‑event forecast producing `person_delay_minutes`, `affected_vehicle_count`, `queue_length_m`, `area_congestion_index`, and `recommended_response_tier`. Uses attendance, duration, and historical analogue.

### Phase 8: Post‑Event Learning System
* **Cox PH Survival Model** – Stores censoring information; `t80` shifts suggested event duration in `shift_duration_hours`.
* **Manpower Weight Refitting** – `np.linalg.lstsq` on feedback data updates linear manpower coefficients; `manpower_weights.json` persisted to disk.
* **Feedback Loop** – `/api/feedback` submits observed severity, actual officer count, and diversion effectiveness. After every 10 entries, manpower weights + NLP classifier re‑fit automatically. `/api/feedback/summary` reports forecast errors.

### Phase 9: Realtime Data Adapter (`src/simulator/realtime_feed.py`)
* Pluggable `RealtimeFeed` interface with `HistoricalReplayFeed` implementation.
* Replays past incidents from the CSV as pseudo‑live data at `/api/realtime/incidents?as_of=ISO`.
* Loads on startup in a background thread; designed to swap in a live‑traffic feed.

---

## 3. Conclusion

By combining **Topological Reverse‑BFS**, **BPR capacity decay**, **Differential Time‑of‑Day weighting**, and a **Post‑Event learning loop**, CityFlow sets a new standard for predictive urban mobility systems.
