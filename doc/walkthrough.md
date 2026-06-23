# Walkthrough: PS2 Digital Twin Simulator

## What Was Accomplished

1. **Data Preprocessing Pipeline (`src/simulator/data_pipeline.py`)**:
   - Cleaned the `2.csv` dataset (8,057 events), extracting planned and unplanned event types.
   - Each event returns structured fields: `route_path`, `veh_type`, `corridor`, `description`, `expected_duration_hours`.

2. **Graph Engine (`src/simulator/graph_engine.py`)**:
   - Pre‑cached the full Bengaluru road network (`bengaluru_global.graphml`, 155K nodes, 393K edges).
   - Sub‑graph extraction on demand — no repeated Overpass API calls.

3. **Severity, Survival & Hotspot Models**:
   - **Severity Model**: GBM + RF two‑head predictor (R²=0.40, Acc=0.60).
   - **Cox PH Survival**: Right‑censored time‑to‑event model (C‑index=0.53, 1,772 observed, 697 censored).
   - **Hotspot Analyzer**: Junction rankings (MekhriCircle #1 with 64 events), hourly/multi‑monthly temporal patterns.

4. **Congestion & Diversion Simulator (`src/simulator/simulator.py`)**:
   - **Shockwave**: BPR reverse‑BFS capacity‑decay model — closed edges get `capacity × 0.05`; spillover decays linearly upstream.
   - **Differential Time‑of‑Day**: Per‑road‑class hourly multipliers from hotspot data. Arterials amplify peak signal; residential dampens it. Route changes between rush hour and off‑peak.
   - **Volume‑Aware Flows**: Up to 3 arterial OD pairs ranked by `distance × capacity_score`.
   - **Diversion**: Dijkstra on capacity‑adjusted graph. `police_deployed=True` omits closed edges; `False` simulates non‑compliance with a 2.5× penalty.
   - **Barricades**: Upstream nodes with safe out‑degree. Validated to block at least one closure entry each.
   - **Diversion Plan Artifact**: Structured output with `plan_summary` (barricades, flows protected, officers, time saved) and per‑barricade detail.

5. **Impact Forecast Module (`src/simulator/impact_forecast.py`)**:
   - Pre‑event forecast: `person_delay_minutes`, `affected_vehicle_count`, `queue_length_m`, `area_congestion_index`, `recommended_response_tier`.

6. **Realtime Data Adapter (`src/simulator/realtime_feed.py`)**:
   - Pluggable feed interface with historical replay mode. Loads asynchronously on startup. `/api/realtime/incidents` serves pseudo‑live data.

7. **Planned vs Unplanned Event Handling**:
   - `event_type` parameter routes simulation: planned events use `route_path` for closures and `derive_spillover_radius(attendance)` for the shockwave footprint.

8. **Post‑Event Learning Loop**:
   - `/api/feedback` → refit manpower weights (`np.linalg.lstsq`) + NLP classifier (concatenated training, no forgetting).
   - `/api/feedback/summary` tracks forecast error over time.

9. **Flask API** (port 8000):
   - Async simulation (background thread, task ID polling).
   - Endpoints: `events`, `severity`, `simulate`, `status`, `hotspots`, `feedback`, `realtime/incidents`.

## The Output

The system generates an interactive dark‑mode HTML map:
- 🔴 **Red Line**: Original shortest‑path route.
- ⚫ **Black Marker**: Epicenter of the unplanned event.
- 🔵 **Cyan Line**: AI‑diverted optimal route.
- 🟠 **Orange Markers**: Police barricade locations.

Documentation:
- [architecture.md](file:///D:/CODE/Python/AIML/CityFlow/doc/architecture.md)
