## CityFlow — Problem & Solution Summary

### The Problem Being Solved

**Problem Statement 2** from the hackathon brief:

> *"Event-Driven Congestion (Planned & Unplanned)"* — Political rallies, festivals, sports events, construction, and sudden gatherings create localized traffic breakdowns. Today's response is experience-driven, not quantified, and there's no post-event learning.

The three specific pain points:
1. **No advance quantification** of event traffic impact
2. **No data-driven resource deployment** (manpower, barricades)
3. **No post-event learning** system — same mistakes repeated

---

### The Current Solution Architecture

**CityFlow** is a **Graph AI + ML decision-support system** (not a vehicle microscopic simulator) with this pipeline:

```
dataset/2.csv (8,173+ Bengaluru traffic events)
        ↓
   DataPipeline  ─── cleans, filters, prioritizes closure events
        ↓
  SeverityPredictor ── trains GBM Regressor (resolution time) + RF Classifier (Green/Amber/Red)
  HotspotAnalyzer  ── pre-computes junction rankings, temporal patterns, heatmap
        ↓
   GraphEngine  ─── downloads/caches Bengaluru OSM road network as a directed graph
        ↓ (per simulation request)
  CongestionSimulator
        ├─ find_affected_flows()      → identifies up to 3 arterial OD pairs whose routes cross the event
        ├─ simulate_congestion_shockwave() → BPR function + upstream BFS capacity decay
        ├─ evaluate_interventions()   → compares baseline vs. diverted travel times
        ├─ recommend_barricades()     → upstream nodes with viable exits
        └─ validate_barricades()      → ensures each barricade blocks a closure entry
        ↓
  ManpowerAllocator ── linear formula: severity + attendance + rush hour + closure → officers/barricade + shift hours
        ↓
  Flask API (port 8000) → React Dashboard (port 3000)
        ↓
  SQLite (storage.py) ── scenarios, async tasks, post-event feedback
```

---

### 🔑 Key Design Decisions

| Component | Approach | Why |
|---|---|---|
| **Congestion model** | BPR function with reverse-BFS upstream capacity decay | Physically meaningful; propagates queue spillback directionally |
| **Affected flows** | Volume-aware: rank arterial OD pairs by `distance × capacity_score` | Picks flows that both cross the event and carry meaningful traffic |
| **Severity prediction** | GBM Regressor (log-space) for resolution time + RF Classifier for response level | Two-head approach: continuous + categorical |
| **Survival model** | Cox PH with right-censoring (`E=0`), `hour_sin`/`hour_cos` covariates | Honours un-resolved events; reports C-index concordance; `t80` drives manpower shifts |
| **Time-of-day routing** | Per-class hourly multiplier clamped to `max(0.1, 1 + (hourly_mult−1)×sensitivity)` | Arterials amplify peak signal; residential dampens — route actually changes between peak and off-peak |
| **Impact forecast** | Pre-event module: attendance + duration + historical analogue → delay-minutes, queue, vehicles | Directly answers PS2 pain point #1 (advance quantification) |
| **Manpower** | Linear formula with `np.linalg.lstsq` refitting from feedback | Learns from every event; weights persisted to disk |
| **Post-event learning** | `/api/feedback` re-fits manpower weights + NLP classifier (no forgetting) | Forecast error tracked via `/api/feedback/summary` |
| **NLP classifier** | `sentence-transformers/LaBSE` (multilingual CPU) + logistic head | Weak-labels from description text; retrained without catastrophic forgetting |
| **Graph** | Cached Bengaluru `.graphml` (155K nodes, 393K edges) | Fast sub-graph extraction, no repeated API calls |
| **Barricading** | Edge-set based: upstream nodes with remaining out-degree, validated | No graph fracture — each barricade blocks a closure entry with an alternate exit |
| **Diversion plan** | Structured artifact: `plan_summary` + per-barricade `barricade_plan` | Produces a deployable plan (barricade locations, officer counts, flows protected) |
| **Realtime adapter** | Pluggable `RealtimeFeed` with `HistoricalReplayFeed` | Swappable for live traffic feed; serves `/api/realtime/incidents` |

---

### Resolved & Remaining Limitations
**Resolved:**
1. ✅ **Manpower formula now learns from feedback** — weights are re-fitted via `np.linalg.lstsq` after every 10 feedback entries.
2. ✅ **Feedback loop now retrains models** — both the NLP classifier (without catastrophic forgetting) and the manpower weights update automatically.
3. ✅ **Flow selection now volume-aware** — candidates ranked by `distance × capacity_score`.
4. ✅ **Impact forecast deployed** — `impact_forecast.py` produces pre-event delay, queue, vehicle count, and response tier.
5. ✅ **Realtime adapter interface** — pluggable feed with historical-replay mode at `/api/realtime/incidents`.
6. ✅ **Diversion plan artifact** — structured `plan_summary` + `barricade_plan` in simulation output.
7. ✅ **Planned vs unplanned mode** — `event_type` routing with attendance-aware spillover radius.
8. ✅ **Differential time-of-day routing** — per-class hourly multipliers produce different routes at peak vs off-peak.

**Remaining:**
1. **No diversion route avoids *spillover* edges** — only closed edges are stripped from the diversion graph; spillover congestion is reflected in BPR-inflated travel times but the route-finding graph still includes heavily congested links.
2. **NLP classifier requires ≥8 GB RAM** — LaBSE model (~1.9 GB serialized) causes OOM on 4 GB servers. Falls back to `disrupted_prob=0.5`.
3. **No real-time traffic feed** — the adapter interface exists but uses historical replay. Live feed requires third-party API integration.
4. **No vehicle-level microsimulation** — CityFlow is a graph-based intervention planner, not SUMO/AIMSUN. This is by design (see whitepaper).
