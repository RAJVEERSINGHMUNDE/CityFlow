# Walkthrough: PS2 Digital Twin Simulator

## What Was Accomplished

1. **Data Preprocessing Pipeline (`src/simulator/data_pipeline.py`)**:
   - Cleaned the `2.csv` dataset, filtering for unplanned events (tree falls, breakdowns) requiring dynamic road closures.
   - Automatically extracted a high‑impact "Tree Fall" event.

2. **Graph Engine (`src/simulator/graph_engine.py`)**:
   - Dynamically downloaded the true OpenStreetMap road network graph for a 1.5 km radius around the event.
   - Calculated free‑flow travel times for every street segment.

3. **Congestion & Diversion Simulator (`src/simulator/simulator.py`)**:
   - **The Shockwave**: Uses the BPR reverse‑BFS capacity‑decay model (instead of naive travel‑time multiplication) to simulate closure and spillover effects.
   - **The Optimizer**: Runs Dijkstra's algorithm on the capacity‑adjusted graph to find the mathematically optimal detour route.
   - **Barricade Generation**: Identifies upstream nodes for police barricades, ensuring continuous flow.

4. **Post‑Event Learning Loop** (`/api/feedback` → refit manpower weights via `np.linalg.lstsq` + NLP retrain without catastrophic forgetting) integrates observed outcomes back into the model.

## The Output

The system generates an interactive dark‑mode HTML map:
- 🔴 **Red Line**: Original shortest‑path route.
- ⚫ **Black Marker**: Epicenter of the unplanned event.
- 🔵 **Cyan Line**: AI‑diverted optimal route.
- 🟠 **Orange Markers**: Police barricade locations.

Documentation:
- [architecture.md](file:///D:/CODE/Python/AIML/CityFlow/doc/architecture.md)
