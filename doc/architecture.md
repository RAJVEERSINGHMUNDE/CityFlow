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

### Phase 2: Data Preprocessing (`src/simulator/data_pipeline.py`)
* Clean `2.csv`, drop rows without latitude/longitude.
* Convert `start_datetime` to `datetime` for optional time‑of‑day weighting.
* Filter unplanned events; select a high‑impact demo event.

### Phase 3: Graph Construction (`src/simulator/graph_engine.py`)
* Dynamically fetch a 1.5 km ego‑graph around the event using `ox.graph_from_point(..., network_type='drive')`.
* Apply `ox.add_edge_speeds()` and `ox.add_edge_travel_times()` to compute free‑flow travel times.
* Snap event coordinates to the nearest node with `ox.distance.nearest_nodes()`.

### Phase 4 & 5: Congestion Simulation & Diversion Optimizer (`src/simulator/simulator.py`)
* **Shockwave Model** – Implements the **BPR reverse‑BFS capacity‑decay model** (see the technical whitepaper). Closed edges receive capacity × 0.05; spillover edges decay linearly with upstream distance.
* **Diversion** – Dijkstra's algorithm runs on the capacity‑adjusted graph. The `calculate_diversion` function supports a `police_deployed` flag: with police, closed edges are omitted (≈95 % compliance); without police, travel time is multiplied by 2.5 to model a 40 % compliance penalty.
* **Barricade Generation** – Finds upstream nodes with safe out‑degree, ensuring continuous flow.

### Phase 6: Production Web UI & API (`src/api` & `src/dashboard`)
* Flask API spawns a background thread for simulation, returning a task ID.
* React Vite frontend polls `/api/status/<task_id>` and displays the generated Folium map.

### Phase 7: Automated End‑to‑End Testing & Resilience Engineering
* Browser‑agent runs UI tests, catching graph extraction timeouts and Tailwind v4 CSS issues (resolved via `ox.settings.timeout = 180`, `ox.settings.retry_num = 3`, and Tailwind post‑CSS fixes).

### Phase 8: Post‑Event Learning System
* **Cox PH Survival Model** – Stores censoring information and computes the C‑index; `t80` shifts suggested event duration.
* **NLP Weak‑Label Classifier** – Uses LaBSE embeddings; retrained after each feedback cycle without catastrophic forgetting.
* **Manpower Weight Refitting** – Updates linear manpower formula via `np.linalg.lstsq` on feedback data.
* **Impact Forecast Module** – Provides `person_delay_minutes`, `area_congestion_index`, and other metrics for future planning.

---

## 3. Conclusion

By combining **Topological Reverse‑BFS**, **BPR capacity decay**, **Differential Time‑of‑Day weighting**, and a **Post‑Event learning loop**, CityFlow sets a new standard for predictive urban mobility systems.
