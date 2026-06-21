# Walkthrough: PS2 Digital Twin Simulator

I have successfully built the **Digital Twin & Diversion Simulator** for Problem Statement 2! This highly novel approach abandons standard tabular classification in favor of a microscopic graph-theory simulation of city traffic.

## What Was Accomplished

1. **Data Preprocessing Pipeline (`src/simulator/data_pipeline.py`)**: 
   - We clean the `2.csv` dataset, filtering for unplanned events (like tree falls, breakdowns) that require dynamic road closures.
   - For demonstration, we automatically extract a high-impact "Tree Fall" event.

2. **Graph Engine (`src/simulator/graph_engine.py`)**:
   - Instead of static maps, we use `osmnx` to dynamically download the true OpenStreetMap road network graph for a 1.5km radius around the event's exact latitude/longitude.
   - We automatically calculate "free-flow" travel times for every street segment.

3. **Congestion & Diversion Simulator (`src/simulator/simulator.py`)**:
   - **The Shockwave**: We simulate the congestion by drastically multiplying the travel times of all road edges within 50 meters (closure) and 300 meters (spillover) of the epicenter.
   - **The Optimizer**: We run Dijkstra's shortest path algorithm on the dynamically modified graph to find the mathematically optimal detour route that avoids the gridlock.
   - **Barricade Generation**: The AI identifies all nodes immediately upstream of the closed edges and recommends these as the optimal locations for police barricades.

## The Output

The system generates a beautiful, interactive dark-mode HTML map. 
You can view the resulting map here:
[diversion_plan.html](file:///D:/CODE/Python/AIML/CityFlow/src/simulator/diversion_plan.html)

**What you will see on the map:**
- 🔴 **Red Line**: The original shortest-path route a driver *would* have taken.
- ⚫ **Black Marker**: The epicenter of the unplanned event (e.g., Tree Fall).
- 🔵 **Cyan Line**: The mathematically optimal AI-diverted route.
- 🟠 **Orange Markers**: The precise intersections where police should place barricades to prevent network gridlock.

## Documentation

Every decision and the high-level logic for every phase of code is fully documented in:
[architecture.md](file:///D:/CODE/Python/AIML/CityFlow/doc/architecture.md)


