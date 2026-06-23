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
| **Congestion model** | BPR function on edges with upstream BFS capacity decay | Physically meaningful; propagates queue spillback directionally |
| **Affected flows** | Find arterial OD pairs whose *baseline* paths pass through the epicenter | Only recommends diversion for flows that actually cross the event — avoids false recommendations |
| **Severity prediction** | GBM Regressor (log-space) for resolution time + RF Classifier for response level | Two-head approach: continuous time estimate + categorical confidence-calibrated label |
| **Manpower** | Linear formula calibrated on historical patterns | Interpretable; accounts for severity, attendance, time-of-day, closure type |
| **Post-event learning** | `feedback` table in SQLite stores actual vs. predicted resolution & officers | Enables forecast error tracking via `/api/feedback/summary` |
| **Graph** | Cached Bengaluru `.graphml` + per-request ego-subgraph extraction | Fast simulation without repeated Overpass API calls |

---

### Resolved & Remaining Limitations
**Resolved:**
1. ✅ **Manpower formula now learns from feedback** — weights are re-fitted via `np.linalg.lstsq` after every 10 feedback entries.
2. ✅ **Feedback loop now retrains models** — both the NLP classifier (without catastrophic forgetting) and the manpower weights update automatically.
4. ✅ **Flow selection now volume-aware** — candidates are ranked by `distance × capacity_score`, where capacity_score averages road capacity along the route.

**Remaining:**
3. **No diversion route avoids *spillover* edges** — only closed edges are stripped from the diversion graph; spillover congestion is reflected in BPR-inflated travel times but the route-finding graph still includes heavily congested links.
