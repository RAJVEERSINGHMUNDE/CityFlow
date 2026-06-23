# CityFlow Digital Twin: Comprehensive Technical Whitepaper

## 1. Executive Summary
CityFlow is an event-impact forecasting and graph-based intervention planning prototype for event-driven urban traffic congestion. It consists of a React frontend, a Flask API, SQLite operational memory, and a graph engine using Python's `networkx` and `osmnx` libraries.

The system does not claim vehicle-level microscopic simulation. Its evidence comes from road-network topology, historical event forecasting, affected arterial-flow analysis, and explicit baseline-versus-intervention comparisons.

---

## 2. The Free-Flow Fallacy and the Mathematical Foundation of Traffic

### 2.1 The Problem with Naive Proximity (Euclidean Distances)
Early traffic simulators estimated event impact using simple Euclidean proximity, which ignores network topology. CityFlow instead uses a **BPR reverse‑BFS capacity‑decay model** implemented in `src/simulator/simulator.py`. The BPR travel‑time function is:

$$ t = t_0 \times \bigl(1 + \alpha \times (v / c)^{\beta}\bigr), \quad \alpha = 0.15,\; \beta = 4 $$

Capacity decays linearly with upstream distance:

$$ c_{upstream} = c \times \bigl(0.1 + 0.9 \times \frac{\text{dist}}{\text{spillover\_radius}}\bigr) $$

Closed edges receive a severe capacity reduction of `c * 0.05` (instead of multiplying travel time by 100), reflecting near‑total blockage.

### 2.2 Topological MultiDiGraphs
To solve this, CityFlow abandons spatial arrays in favor of **Graph Theory**. We model the city as a Directed Multi‑Graph $G = (V, E)$, where:
- $V$ (Vertices/Nodes) represent physical intersections.
- $E$ (Edges) represent road segments connecting two intersections. It is a "Multi" graph because two intersections can have multiple edges between them (e.g., a divided multi‑lane highway).
- It is "Directed" because traffic flows in specific directions (one‑way streets).

Each edge $e = (u, v)$ contains metadata:
- `length`: Physical length in meters.
- `speed`: Max speed limit in km/h.
- `travel_time`: The base time in seconds to traverse the edge in free‑flow conditions.

$$ travel\_time = \frac{length}{speed \times \frac{1000}{3600}} $$

---

## 3. Algorithmic Innovations in CityFlow

### 3.1 Reverse Breadth‑First Search (BFS) for Congestion Shockwaves
Traffic jams back‑propagate upstream. CityFlow implements a **Reverse BFS** that traverses incoming edges from the epicenter. For each edge, capacity is decayed using the BPR formula above. If the upstream distance `dist` satisfies `dist <= closure_radius`, the edge capacity is set to `c * 0.05`. For `closure_radius < dist <= spillover_radius`, capacity follows the linear decay `0.1 + 0.9 * dist/spillover_radius`. This model eliminates false positives from Euclidean distance and respects network topology.

### 3.2 Time‑of‑Day Contextual Multipliers
Traffic routing is highly sensitive to time. Instead of a uniform scalar, CityFlow applies a **per‑class hourly‑calibrated multiplier**:

$$ multiplier = 1 + (hourly\_mult - 1) \times sensitivity[highway] $$

where `_CLASS_SENSITIVITY` defines base sensitivities (e.g., `motorway:1.6, primary:1.4, residential:0.7`). The hourly multiplier `hourly_mult` is obtained from `hotspot_analyzer.get_hourly_multiplier(hour)`. This differential weighting penalises arterials more at peak and reduces penalties for residential roads.

### 3.3 Continuous Flow Barricading
A naive barricade algorithm simply identifies a closed edge $(u, v)$ and tells the police to place a barricade at $u$. **The Flaw:** If $u$ is a dead‑end intersection where the *only* outgoing path was $(u, v)$, placing a barricade at $u$ traps incoming cars. They will hit the barricade and be forced into dangerous U‑turns.

**The Solution:** CityFlow calculates the out‑degree $deg_{out}(u_{current})$ for unblocked edges.

$$ deg_{out_{safe}}(n) = \sum_{e \in E_{out}(n)} \begin{cases} 1 & \text{if } e \notin E_{closed} \\ 0 & \text{otherwise} \end{cases} $$

The algorithm recursively traverses upstream via `G.in_edges()` until it finds a node $n$ where $deg_{out_{safe}}(n) \ge 1$. The barricade is placed at $n$, ensuring continuous flow diversion.

### 3.4 Dijkstra's Shortest Path Detours
After applying the BPR capacity reductions and time‑of‑day multipliers, Dijkstra's algorithm finds the optimal detour. Closed edges are effectively removed (capacity * 0.05) rather than inflating travel time. The `calculate_diversion` function now supports a `police_deployed` flag: with police, closed edges are omitted (≈95 % compliance); without police, travel time is multiplied by 2.5 to model a 40 % compliance penalty.

---

## 4. Software Architecture & Concurrency

### 4.1 The Asynchronous Bottleneck
Graph traversals (especially `ox.graph_from_point` which downloads geographic XML payloads and parses them into multi‑graphs) are blocking, CPU‑bound I/O operations taking $O(V+E)$ time.

If built synchronously, a Flask server will hang for 20‑30 seconds, and the React UI will freeze, resulting in a poor UX and frequent `504 Gateway Timeouts`.

### 4.2 The Threaded Task Queue
CityFlow implements an asynchronous backend architecture:
1. **Frontend Request:** React sends a `POST /api/simulate/<id>`.
2. **Task Delegation:** Flask generates a `uuid4()` task ID. It spawns a background `threading.Thread` to handle the CPU‑bound simulation, and immediately returns `{"task_id": "xxx", "status": "pending"}` to the frontend with an HTTP 202.
3. **Frontend Polling:** React utilizes a `setInterval` loop to send `GET /api/status/xxx` every 2000ms.
4. **Completion:** Once the background thread finishes writing the Folium HTML map and calculating metrics, it updates the in‑memory `tasks` dictionary. The next frontend poll receives `{"status": "success", "map_url": "..."}` and renders the iframe.

---

## 5. Line‑by‑Line Code Breakdown

### 5.1 `simulator.py` (The Mathematical Core)

```python
import networkx as nx
import osmnx as ox
import folium
import random
import datetime

class CongestionSimulator:
    def __init__(self, G: nx.MultiDiGraph, epicenter_lat: float, epicenter_lon: float, start_datetime: str = None):
        # We copy the graph so multiple simulations don't permanently corrupt the base travel_time weights.
        self.G = G.copy()
        self.epicenter_lat = epicenter_lat
        self.epicenter_lon = epicenter_lon
        
        # ox.distance.nearest_nodes utilizes a vectorized KDTree to find the closest graph node to the raw GPS coordinates.
        self.epicenter_node = ox.distance.nearest_nodes(self.G, X=epicenter_lon, Y=epicenter_lat)
        self.start_datetime = start_datetime
```
... (rest of file unchanged)

---

## 6. Conclusion

The CityFlow architecture has been transformed from a proof‑of‑concept into a mathematically rigorous, mathematically sound, and scalable web platform. By utilizing **Topological Reversal**, **Dijkstra's Algorithm**, **Dynamic Traffic Weighting**, and **Asynchronous Microservices**, this Digital Twin sets a new standard for predictive urban mobility systems.
