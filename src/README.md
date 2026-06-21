# CityFlow: Digital Twin & Diversion Simulator

**Event-Driven Congestion Intelligence — Bengaluru Traffic Management System**

CityFlow is a technically novel **Operations Research & Graph AI** system that acts as a microscopic traffic simulation engine. It models city streets as mathematical graphs to predict exactly how traffic will spill over during an event, and computes the optimal detour routes, barricade placements, and police officer deployment plans.

## The Core Approach

Most solutions predict *if* a road closure is needed. CityFlow answers the hardest part:
**"Recommend optimal manpower, barricading, and diversion plans."**

1. **Dynamic OSM Graph Extraction** — Fetches the real Bengaluru road network (155k nodes, 393k edges) cached locally via OSMnx. Per-event subgraphs extracted in ~100ms using `nx.ego_graph`.
2. **BFS Congestion Shockwave** — Propagates congestion upstream along road topology (not Euclidean radius): closure zone = Travel Time ×100, spillover = ×5.
3. **Dijkstra Diversion** — Finds the mathematically optimal detour on the penalty-modified graph.
4. **Police Barricade Generator** — Identifies the last upstream intersection with a viable exit — the correct placement point.
5. **ML Severity Prediction** — GradientBoostingRegressor (R² cross-validated) predicts resolution time; RandomForestClassifier predicts Green/Amber/Red response level. Cyclical time encoding, KMeans spatial clustering, junction hotspot features.
6. **Manpower Allocation Engine** — Computes officer count per barricade and shift duration from severity prediction + event attributes.
7. **Historical Hotspot Intelligence** — Vectorised Haversine lookup over 8,173 historical events; pre-computed Folium heatmap.

---

## Architecture

3-tier system:

| Tier | Stack | Directory |
|------|-------|-----------|
| Simulation Engine | Python, OSMnx, NetworkX, sklearn | `src/simulator/` |
| REST API | Flask, Flask-CORS | `src/api/` |
| Dashboard | React, Vite, Tailwind | `src/dashboard/` |

---

## How to Run

### Prerequisites
- Python 3.10+
- Node.js & npm

### Setup
```bash
# 1. Install Python dependencies
pip install flask flask-cors osmnx networkx pandas folium scikit-learn

# 2. Install React dependencies
cd src/dashboard
npm install
```

### Launch (1-click)
```bash
# From the src/ directory
python run_all.py
```

Dashboard: `http://localhost:5173` | API: `http://localhost:5000`

Click any event in the left panel to run the Digital Twin simulation.

---

## Dataset
Place `2.csv` in the `dataset/` directory at the project root.

*Full technical documentation in `doc/architecture.md` and `doc/technical_whitepaper.md`.*
