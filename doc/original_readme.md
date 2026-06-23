# CityFlow: Event-Impact Forecasting and Intervention Planning

**Event-Driven Congestion Intelligence for Bengaluru**

CityFlow is an Operations Research and Graph AI decision-support prototype. It models Bengaluru streets as a directed graph, forecasts event severity from historical incidents, identifies arterial movements affected by an event, and evaluates diversion, barricade, and staffing interventions.

## Core Capabilities

1. **OSM Road Graph** - Uses the real drivable road network and cached local subgraphs.
2. **Topological Shockwave** - Propagates closure and spillover costs upstream by connected road distance.
3. **Affected-Flow Diversion** - Selects up to three arterial movements whose paths cross the incident. A diversion is accepted only when it avoids closed edges and saves time.
4. **Validated Barricades** - Verifies that a position blocks a closure entry and provides an alternate upstream exit.
5. **Severity Forecast** - Predicts resolution time and Green/Amber/Red response level from historical incidents.
6. **Explainable Staffing** - Estimates officers and shift duration from severity, closure status, time of day, attendance, and barricade count.
7. **Historical Intelligence** - Provides nearby incident context, hotspot junctions, and temporal patterns.
8. **Operator Scenarios** - Creates planned or unplanned events with attendance, duration, location, and closure details.
9. **Post-Event Learning** - Persists actual outcomes in SQLite and reports forecast error and diversion effectiveness.

## Decision Evidence

Each affected flow reports baseline travel time, do-nothing event travel time, intervention travel time, time saved, delay reduction, diversion distance, and closure avoidance. A route with no measurable benefit is rejected instead of being presented as a recommendation.

CityFlow is a graph-based intervention planning prototype, not a vehicle-level microscopic simulator.

## Architecture

| Tier | Stack | Directory |
|------|-------|-----------|
| Forecast and graph engine | Python, OSMnx, NetworkX, scikit-learn | `src/simulator/` |
| API and operational memory | Flask, SQLite | `src/api/` |
| Dashboard | React, Vite, Tailwind | `src/dashboard/` |

## Run Locally

```bash
pip install -r src/requirements.txt
cd src/dashboard && npm install
cd ..
python run_all.py
```

Dashboard: `http://localhost:3000` | API: `http://localhost:8000`

## API Additions

- `POST /api/scenarios` creates an operator event scenario.
- `POST /api/simulate/<event_id>` evaluates affected traffic flows asynchronously.
- `POST /api/feedback` records a post-event outcome.
- `GET /api/feedback/summary` reports learning metrics.

## Verification

```bash
python -m unittest discover -s tests -v
cd src/dashboard
npm run lint
npm run build
```

The historical dataset is expected at `dataset/2.csv`.
