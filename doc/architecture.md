# PS2 Digital Twin & Diversion Simulator: Technical Decisions & Documentation

This document chronicles the decisions, code structure, and logic used to build the Event-Driven Congestion Simulator for Problem Statement 2.

## 1. Project Initialization & Architecture

**Decision 1: The Novel Approach**
Instead of a simple classification model, we decided to build a microscopic traffic simulation using Graph Theory. This perfectly addresses the prompt's requirement to "recommend optimal barricading and diversion plans."

**Decision 2: Technology Stack**
- `pandas` / `numpy`: For cleaning the `2.csv` event dataset.
- `osmnx`: For fetching real-world road networks from OpenStreetMap dynamically based on the event's latitude and longitude.
- `networkx`: For modeling the road network as a mathematical graph and running pathfinding/optimization algorithms.
- `folium`: For generating interactive HTML maps to visualize the congestion shockwaves and the recommended diversion routes.

## 2. Code Documentation

### Phase 2: Data Preprocessing Engine (`src/simulator/data_pipeline.py`)

In this module, we handle the raw event data (`2.csv`). Here is the step-by-step logic:

1. **`dropna(subset=['latitude', 'longitude'])`**: Since our simulation relies heavily on OpenStreetMap graph extraction based on geographical coordinates, any event missing a lat/lon is unusable and dropped.
2. **`pd.to_datetime()`**: We cast the start time to a datetime object. This allows us to potentially incorporate time-of-day traffic weights later (e.g., higher base congestion during rush hour).
3. **Filtering Unplanned Events**: We filter `df[df['event_type'] == 'unplanned']`. Planned events (like rallies) usually have pre-defined diversion plans. Unplanned events (breakdowns, fallen trees) are where dynamic AI-driven diversions provide the most value.
4. **`get_demo_event()`**: For demonstration and simulation purposes, we extract a single high-priority event (preferring those where `requires_road_closure == True`) to act as the "epicenter" of our congestion simulation.

### Phase 3: Graph Construction & OSMnx Integration (`src/simulator/graph_engine.py`)

**Decision: Using OpenStreetMap (OSMnx)**
To accurately simulate traffic diversion, we need a real-world map. Hardcoding nodes is impossible for a city-wide dataset. We dynamically fetch the road network within a defined radius (e.g., 1.5 km) around the event's coordinates.

1. **`ox.graph_from_point(..., network_type='drive')`**: We restrict the graph to drivable roads. This prevents the algorithm from routing cars through parks or pedestrian walkways.
2. **`ox.add_edge_speeds()` & `ox.add_edge_travel_times()`**: These functions calculate the default "free-flow" travel time across every street segment based on street type and length. This is crucial—our simulation will use this base travel time and artificially inflate it on the edges affected by the event.
3. **Node Snapping**: Events happen at raw GPS coordinates. We use `ox.distance.nearest_nodes()` to map the event to the nearest actual intersection (node) on the graph.

### Phase 4 & 5: Congestion Simulation & Diversion Optimizer (`src/simulator/simulator.py`)

**Decision: The Congestion Shockwave Model**
Instead of just labeling a road "closed", we dynamically multiply the edge `travel_time` to simulate cascading congestion.
1. **`simulate_congestion_shockwave()`**: We iterate through all edges in the graph. Using the great-circle distance from the epicenter:
   - If distance < 50m: The road is effectively closed (Travel Time x 100).
   - If distance < 300m: The road suffers spillover congestion (Travel Time x 5).
2. **`calculate_diversion()`**: We run Dijkstra's algorithm (`nx.shortest_path`) on the modified graph. Because the travel times around the epicenter are now extremely high, the algorithm naturally finds an alternative route that avoids the congestion entirely.
3. **`recommend_barricades()`**: To prevent cars from entering the 50m closure zone and causing a gridlock, we extract the upstream nodes (the `u` in edge `u -> v`) of all closed edges. These are the mathematically optimal spots to place physical police barricades.
4. **`visualize()`**: We use `folium` to plot the original route (red), the new diverted route (cyan), the epicenter, and the barricade points on an interactive HTML map (`diversion_plan.html`).

### Phase 6: Production Web UI & API (`src/api` & `src/dashboard`)

**Decision: Flask + React Command Center**
To make this a production-ready hackathon submission, the raw python scripts were wrapped into a Web Dashboard.
1. **Flask API (`app.py`)**: A lightweight backend that reads `data_pipeline.py` to serve live events, and dynamically invokes `simulator.py` via POST requests, returning JSON metrics (e.g. `barricades_needed`) and a link to the generated Folium map.
2. **React Dashboard**: Built with Vite and TailwindCSS for a modern, glassmorphism aesthetic. It allows operators to click on raw CSV events and immediately see the generated Digital Twin simulation on an embedded map.

### Phase 7: Automated End-to-End Testing & Resilience Engineering

To ensure the CityFlow Digital Twin could handle real-world hackathon demonstration conditions without crashing, we deployed an autonomous browser agent to perform end-to-end (E2E) UI testing. This stress-tested the integration between the Vite/React frontend, the Flask API, and the OpenStreetMap external dependencies.

During this rigorous testing phase, two critical architectural bottlenecks were identified and resolved:

#### 1. Graph Extraction Timeouts (The `ConnectionResetError` Bottleneck)
**The Problem:**
When simulating high-impact events, the system extracts a massive 1.5 km radial road network using `osmnx.graph_from_point()`. The default `requests` timeout in OSMnx is 10 seconds. During testing, large, dense urban grids took longer than 10 seconds to compile from the Overpass API, causing the Flask backend to throw a fatal `ConnectionResetError (10054)` and the React dashboard to hang indefinitely.

**The Architectural Fix (`src/simulator/graph_engine.py`):**
To guarantee system stability, we injected explicit configuration overrides directly into the OSMnx core settings before the `GraphEngine` instantiates:
- `ox.settings.timeout = 180`: Extended the Overpass API connection wait time to 3 full minutes, allowing even the most complex multi-thousand node graphs to download securely.
- `ox.settings.retry_num = 3`: Implemented an automatic exponential backoff retry mechanism. If the external OSM server drops the connection, the Graph Engine will silently retry the fetch up to 3 times before failing, abstracting this volatility away from the user interface.

#### 2. PostCSS Compilation & Modern CSS Integration Failures
**The Problem:**
The Vite React dashboard was initialized with the newest version of TailwindCSS (v4). However, the legacy PostCSS configuration attempted to load the core `tailwindcss` package as a standard plugin, resulting in a fatal `[plugin:vite:css]` compilation crash when the browser agent attempted to load the dashboard DOM (`Cannot apply unknown utility class bg-slate-950`).

**The Architectural Fix (`src/dashboard/`):**
We refactored the entire styling pipeline to comply with Tailwind v4's modern architecture:
- Swapped the npm dependency from the standard plugin to the dedicated `@tailwindcss/postcss` compiler.
- Refactored `postcss.config.js` to explicitly declare the new PostCSS namespace.
- Completely removed legacy `@tailwind base; @tailwind components;` directives from `src/index.css`, replacing them with the optimized `@import "tailwindcss";` instruction. 
This immediately resolved the hot-module replacement (HMR) crashes and ensured the glassmorphism UI rendered flawlessly.


