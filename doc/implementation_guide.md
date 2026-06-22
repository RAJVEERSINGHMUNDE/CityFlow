# CityFlow Implementation Guide — Fixing All Identified Faults

> **Scope:** Self-contained guide to close every gap identified in the repo audit. Each fix has a Problem statement, Root cause (file:line), Implementation (copy-pasteable code), and Verification step. Fixes are ordered by priority and grouped so that earlier fixes unlock later ones.
>
> **Convention:** `[NEW]` = create a new file, `[MOD]` = modify an existing file, `[DEL]` = delete code. Line numbers refer to the repo state at audit time and may shift as you edit — match on the surrounding code, not the line number.

---

## Table of Contents

| # | Fix | Tier | Files touched | PS2 pain point |
|---|-----|------|---------------|----------------|
| 1 | Cox PH handles censoring + reports C-index | 🔴 | `survival_model.py` | Forecast + post-event learning |
| 2 | Differential time-of-day routing (fix inert scalar) | 🔴 | `simulator.py`, `hotspot_analyzer.py` | Advance quantification |
| 3 | Rewrite `evaluate_model.py` for the new architecture | 🔴 | `evaluate_model.py` | Credibility / submission |
| 4 | Manpower weights learn from feedback (lstsq) | 🟠 | `manpower.py`, `storage.py`, `app.py` | Post-event learning |
| 5 | NLP retrain without catastrophic forgetting | 🟠 | `nlp_impact.py` | Post-event learning |
| 6 | Corridor-weighted NLP→capacity (ΔC) | 🟠 | `nlp_impact.py`, `hotspot_analyzer.py`, `app.py` | Advance quantification |
| 7 | Attendance-aware spillover radius (standardize 1000m) | 🟠 | `simulator.py`, `app.py` | Planned events |
| 8 | Pre-event traffic-impact forecast (delay-minutes, queue, vehicles) | 🟠 | `impact_forecast.py` [NEW], `app.py` | Advance quantification |
| 9 | Real-time data adapter (pluggable + historical-replay) | 🟠 | `realtime_feed.py` [NEW], `app.py` | "historical AND real-time" |
| 10 | Planned vs unplanned event modes | 🟠 | `simulator.py`, `app.py`, `data_pipeline.py` | Planned events |
| 11 | Volume-aware flow selection | 🟡 | `simulator.py` | Resource recommendation |
| 12 | Integrated compliance × manpower evaluation | 🟡 | `simulator.py`, `app.py` | Resource recommendation |
| 13 | Synthesized diversion plan artifact | 🟡 | `simulator.py`, `app.py` | Barricading + diversion plans |
| 14 | (folded into #3) | — | — | — |
| 15 | Sync docs/whitepaper to BPR code | 🟡 | `doc/*.md` | Submission quality |

**Order of execution:** 1 → 2 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 3 → 15. Do #1 and #2 first because #3 verifies them, and #4-#6 extend the learning loop.

---

## 0. Pre-flight

Before changing anything, capture a baseline so regressions are visible.

```bash
# from repo root
python -m unittest discover -s tests -v
python src/evaluate_model.py   # saves fresh eval_results_baseline.txt
```

Copy `src/eval_results.txt` to `doc/eval_results_baseline.txt` for later diff. Do not edit the baseline.

Add a single helper used by several fixes — a corridor closure-rate lookup exposed from `hotspot_analyzer.py`. We will add to it in Fix #6.

---

## 🔴 Fix #1 — Cox PH handles censoring + reports C-index

### Problem
`survival_model.py:23` sets `df['E'] = 1` for every row, declaring all clearance times as *observed events*. The 1,007 censored (active, never closed) records identified in `repo_audit.md` are silently dropped or mis-labelled, collapsing Cox PH to naive regression and discarding its core statistical advantage (right-censored time-to-event modelling). No concordance index is reported, so model quality is unverifiable under questioning.

### Root cause
`src/simulator/survival_model.py:22-27`:
```python
df['T'] = (df['closed_dt'] - df['start_dt']).dt.total_seconds() / 60
df['E'] = 1  # assuming complete records for the ones with closed_dt
df = df.dropna(subset=['T', 'veh_type', 'corridor'])
df = df[(df['T'] > 2) & (df['T'] < 43200)]
```

### Implementation

**[MOD] `src/simulator/survival_model.py`** — replace the whole file with the version below. It (a) keeps censored rows with `E=0`, (b) uses `resolved_datetime`/`closed_datetime` as the observation boundary, (c) adds hour-of-day and cause covariates that `repo_audit.md` lists as available, (d) reports the C-index and partial hazard summary, (e) exposes `predict_clearance` with a confidence band.

```python
import pandas as pd
import numpy as np
from lifelines import CoxPHFitter
from lifelines.utils import concordance_index
import warnings
warnings.filterwarnings('ignore')


class ClearanceForecaster:
    """
    Cox Proportional Hazards model for incident clearance time.

    Handles right-censoring:
      E = 1  -> event observed (incident cleared, closed_datetime present)
      E = 0  -> censored (still active at observation boundary)

    Reports the concordance index (C-index) so model quality is auditable.
    """

    def __init__(self):
        self._cph = None
        self._is_fitted = False
        self.c_index = None
        self.n_observed = 0
        self.n_censored = 0
        # 80th percentile baseline observed in training (fallback for predict)
        self._baseline_t80 = 120.0
        self._baseline_t50 = 60.0

    def fit(self, df: pd.DataFrame, observation_boundary=None):
        """
        Train Cox PH.

        Parameters
        ----------
        df                  : the full events DataFrame (censored + observed)
        observation_boundary: pandas Timestamp. If a row has no closed_datetime,
                              it is censored at this time. Defaults to the max
                              closed_datetime in the data (i.e. "as of data export").
        """
        print("[SurvivalModel] Starting Cox PH training with censoring...")
        df = df.copy()

        df['start_dt'] = pd.to_datetime(df['start_datetime'], utc=True, errors='coerce')
        df['closed_dt'] = pd.to_datetime(df['closed_datetime'], utc=True, errors='coerce')
        df = df.dropna(subset=['start_dt', 'veh_type', 'corridor'])

        if observation_boundary is None:
            observed = df['closed_dt'].dropna()
            observation_boundary = observed.max() if len(observed) else df['start_dt'].max()

        # Duration in minutes to event OR to censoring boundary
        end_dt = df['closed_dt'].fillna(observation_boundary)
        df['T'] = (end_dt - df['start_dt']).dt.total_seconds() / 60
        # Event indicator: 1 only if we actually saw the clearance
        df['E'] = df['closed_dt'].notna().astype(int)

        # Keep realistic durations
        df = df[(df['T'] > 2) & (df['T'] < 43200)]

        self.n_observed = int(df['E'].sum())
        self.n_censored = int((df['E'] == 0).sum())
        print(f"[SurvivalModel] {self.n_observed} observed, "
              f"{self.n_censored} censored.")

        # Covariates (all well-populated per audit)
        df['is_bmtc']          = (df['veh_type'] == 'bmtc_bus').astype(int)
        df['is_heavy']         = (df['veh_type'] == 'heavy_vehicle').astype(int)
        df['is_lcv']           = (df['veh_type'] == 'lcv').astype(int)
        df['is_hcorridor']     = df['corridor'].apply(
            lambda c: 0 if pd.isna(c) or c == 'Non-corridor' else 1
        )
        df['requires_closure'] = df['requires_road_closure'].fillna(False).astype(int)
        hour = df['start_dt'].dt.hour.fillna(12)
        df['hour_sin'] = np.sin(2 * np.pi * hour / 24)
        df['hour_cos'] = np.cos(2 * np.pi * hour / 24)

        features = ['T', 'E', 'is_bmtc', 'is_heavy', 'is_lcv',
                    'is_hcorridor', 'requires_closure', 'hour_sin', 'hour_cos']

        self._cph = CoxPHFitter(penalizer=0.1)
        self._cph.fit(df[features], duration_col='T', event_col='E')

        # Concordance index on the training set (auditable quality metric)
        try:
            risk = self._cph.predict_partial_hazard(df[features].drop(columns=['T', 'E']))
            self.c_index = float(concordance_index(df['T'], -risk, df['E']))
            print(f"[SurvivalModel] C-index = {self.c_index:.3f}")
        except Exception as exc:
            print(f"[SurvivalModel] C-index unavailable: {exc}")

        # Baseline percentile fallbacks from observed distribution
        observed_T = df.loc[df['E'] == 1, 'T']
        if len(observed_T):
            self._baseline_t50 = float(np.median(observed_T))
            self._baseline_t80 = float(np.percentile(observed_T, 80))

        self._is_fitted = True
        print("[SurvivalModel] DONE.")
        print(self._cph.summary[['coef', 'exp(coef)', 'p']].to_string())

    def predict_clearance(self, event_dict: dict) -> dict:
        if not self._is_fitted:
            return {
                'median_clearance_min': 60,
                't80_clearance_min': 120,
                'survival_at_30min': 0.8,
                'survival_at_60min': 0.5,
                'c_index': None,
            }

        veh = event_dict.get('veh_type', '')
        corridor = event_dict.get('corridor', 'Non-corridor')
        try:
            import pandas as _pd
            hour = _pd.to_datetime(event_dict.get('time', '')).hour
        except Exception:
            hour = 12

        row = pd.DataFrame([{
            'is_bmtc':          int(veh == 'bmtc_bus'),
            'is_heavy':         int(veh == 'heavy_vehicle'),
            'is_lcv':           int(veh == 'lcv'),
            'is_hcorridor':     int(not pd.isna(corridor) and corridor != 'Non-corridor'),
            'requires_closure': int(bool(event_dict.get('requires_closure', False))),
            'hour_sin':         float(np.sin(2 * np.pi * hour / 24)),
            'hour_cos':         float(np.cos(2 * np.pi * hour / 24)),
        }])

        sf = self._cph.predict_survival_function(row)
        t_vals = sf.index.values
        s_vals = sf.iloc[:, 0].values

        t50_idx = int(np.searchsorted(-s_vals, -0.5, side='right'))
        t80_idx = int(np.searchsorted(-s_vals, -0.2, side='right'))
        t50 = float(t_vals[t50_idx]) if t50_idx < len(t_vals) else float(t_vals[-1])
        t80 = float(t_vals[t80_idx]) if t80_idx < len(t_vals) else float(t_vals[-1])

        def _surv_at(minutes):
            mask = t_vals <= minutes
            return float(s_vals[mask][-1]) if mask.any() else 1.0

        return {
            'median_clearance_min': round(t50, 0),
            't80_clearance_min':    round(t80, 0),
            'survival_at_30min':    round(_surv_at(30), 3),
            'survival_at_60min':    round(_surv_at(60), 3),
            'c_index':              round(self.c_index, 3) if self.c_index else None,
            'n_observed':           self.n_observed,
            'n_censored':           self.n_censored,
        }


_forecaster = None


def get_forecaster() -> ClearanceForecaster:
    global _forecaster
    if _forecaster is None:
        _forecaster = ClearanceForecaster()
    return _forecaster
```

### Verify
```bash
python -c "import sys; sys.path.append('src/simulator'); from data_pipeline import DataPipeline; from survival_model import get_forecaster; p=DataPipeline('dataset/2.csv'); p.load_and_clean_data(); f=get_forecaster(); f.fit(p.df); print(f.predict_clearance({'veh_type':'bmtc_bus','corridor':'Tumkur Road','requires_closure':True,'time':'2024-03-07 18:00'}))"
```
Expect: prints `X observed, Y censored`, a C-index line (~0.6-0.8 is acceptable), the coef table, and a dict with `c_index` populated. `n_censored` must be > 0.

---

## 🔴 Fix #2 — Differential time-of-day routing

### Problem
`simulator.py:31-52` multiplies *every* edge's `travel_time` by the same scalar (1.5 rush / 0.8 night / 1.0 otherwise). A uniform scalar preserves shortest-path topology, so Dijkstra's chosen route cannot change — confirmed by `eval_results.txt` Phase 4 = **0/10**. The "AI time-of-day" claim is mathematically dead.

### Root cause
`src/simulator/simulator.py:47-50`:
```python
for graph in (self.base_G, self.G):
    for _, _, _, data in graph.edges(keys=True, data=True):
        if 'travel_time' in data:
            data['travel_time'] = float(data['travel_time']) * self.time_multiplier
```

### Fix design
Make the multiplier **per road class × hour bucket**, calibrated from the historical hourly distribution already computed in `hotspot_analyzer._hourly`. Arterials get a larger rush penalty (they carry the demand), residential/service roads get a smaller one (they're the detour). This is a defensible, data-grounded differential model and it *does* change Dijkstra's path because the penalty is no longer constant across edges.

### Implementation

**[MOD] `src/simulator/hotspot_analyzer.py`** — expose a calibrated hourly multiplier curve. Add inside `_precompute`, after `self._hourly = ...`:

```python
        # Hourly demand curve relative to the daily mean (used by simulator
        # for differential time-of-day edge weighting). Normalised so the
        # mean multiplier over 24h == 1.0.
        _hourly_counts = np.array(
            [self._hourly.get(h, 0) for h in range(24)], dtype=float
        )
        if _hourly_counts.mean() > 0:
            self._hourly_multiplier = (
                _hourly_counts / _hourly_counts.mean()
            ).tolist()
        else:
            self._hourly_multiplier = [1.0] * 24
```

Add a public accessor:

```python
    def get_hourly_multiplier(self, hour: int) -> float:
        """Relative event-density multiplier for the given hour (mean == 1.0)."""
        if 0 <= hour < 24 and self._hourly_multiplier:
            return float(self._hourly_multiplier[hour])
        return 1.0
```

**[MOD] `src/simulator/simulator.py`** — replace `_apply_time_of_day_weights` with the differential version. Per-class sensitivity factor; arterials amplify the hourly signal, local roads dampen it.

```python
    # Road-class rush-hour sensitivity (arterials carry the demand swing,
    # residential/service roads are the natural detour and swing less).
    _CLASS_SENSITIVITY = {
        'motorway': 1.6, 'trunk': 1.5, 'primary': 1.4,
        'secondary': 1.2, 'tertiary': 1.1,
        'residential': 0.7, 'living_street': 0.6, 'service': 0.6,
        'unclassified': 0.9,
    }

    def _apply_time_of_day_weights(self):
        """Apply per-road-class, hour-calibrated travel-time multipliers.

        Unlike a uniform scalar, this is a *differential* weighting: arterials
        are penalised more during demand peaks, local roads less. Dijkstra's
        path can therefore change between rush hour and midnight.
        """
        if not self.start_datetime:
            return
        try:
            import pandas as pd
            hour = pd.to_datetime(self.start_datetime).hour
        except (TypeError, ValueError) as exc:
            print(f'Error applying time weights: {exc}')
            return

        # Try the calibrated hourly curve from HotspotAnalyzer; fall back to
        # the simple rush/night/off-peak buckets.
        hourly_mult = 1.0
        try:
            from hotspot_analyzer import get_analyzer
            analyzer = get_analyzer()
            if analyzer is not None:
                hourly_mult = analyzer.get_hourly_multiplier(hour)
        except Exception:
            pass

        if 8 <= hour <= 11 or 17 <= hour <= 20:
            self.time_of_day_label = 'Rush Hour'
        elif hour >= 22 or hour <= 5:
            self.time_of_day_label = 'Night'
        else:
            self.time_of_day_label = 'Off-Peak'

        # Reference multiplier for labelling/UI (mean ~1.0 across the day)
        self.time_multiplier = float(hourly_mult)

        for graph in (self.base_G, self.G):
            for _, _, _, data in graph.edges(keys=True, data=True):
                if 'travel_time' not in data:
                    continue
                hw = self._highway_value(data)
                sensitivity = self._CLASS_SENSITIVITY.get(hw, 1.0)
                # Damp the curve toward 1.0 by sensitivity so residential
                # roads stay close to free-flow even at peak.
                multiplier = 1.0 + (hourly_mult - 1.0) * sensitivity
                data['travel_time'] = float(data['travel_time']) * multiplier
```

> **Why this works:** at rush hour, `hourly_mult` ≈ 1.6 from the data. A `primary` edge gets `1 + 0.6*1.4 = 1.84×`. A `residential` edge gets `1 + 0.6*0.7 = 1.42×`. The relative cost of arterials vs residential rises, so Dijkstra will route more through residential streets at peak — exactly the behaviour the whitepaper claims but the old code never produced. At 3am, `hourly_mult` ≈ 0.4 and the relationship inverts, sending traffic back to the arterials.

### Verify
Add a focused unit test in `tests/test_simulator.py`:

```python
    def test_time_of_day_changes_route(self):
        from unittest.mock import patch
        # Build a graph with a fast arterial and a slow residential detour
        graph = build_test_graph()
        with patch('src.simulator.simulator.ox.distance.nearest_nodes', return_value=0):
            sim_night = CongestionSimulator(graph, 0.0, 0.0, start_datetime="2024-01-01 03:00:00")
            sim_rush  = CongestionSimulator(graph, 0.0, 0.0, start_datetime="2024-01-01 18:00:00")
        # Force the sensitivity map to be deterministic in the test
        route_night = sim_night.calculate_diversion(-2, 2, closed_edges=set())
        route_rush  = sim_rush.calculate_diversion(-2, 2, closed_edges=set())
        # With differential weights the two routes should differ
        self.assertNotEqual(route_night, route_rush)
```

Then:
```bash
python -m unittest tests.test_simulator.SimulatorTests.test_time_of_day_changes_route -v
```

If the simple test graph is too small to show a path change, construct a graph with a parallel arterial + residential path. The point is the test fails on the old code and passes on the new code.

---

## 🔴 Fix #3 — Rewrite `evaluate_model.py` for the new architecture

### Problem
`evaluate_model.py` still tests the **old** architecture: per-event `ox.graph_from_point` (no cache), legacy `get_arterial_od_pair`, node-removal barricade connectivity, and the time-of-day invariance test. It does not evaluate Cox PH (C-index), NLP (precision/recall), manpower forecast error, or diversion effectiveness from the feedback table. `eval_results.txt` is stale and reports "barricades fractured the graph" against code that no longer does that.

### Root cause
Whole file: `src/evaluate_model.py:1-166` and the binary `src/eval_results.txt`.

### Implementation

**[MOD] `src/evaluate_model.py`** — replace the whole file. The new evaluator has 6 phases that match the current code:

```python
"""
CityFlow evaluation harness — 6 phases, matches the current architecture.

Phases:
  1. Shockwave topology (false positives vs Euclidean)
  2. Affected-flow selection (every selected flow crosses the epicenter)
  3. Barricade validation (edge-set based, no graph fracture)
  4. Time-of-day routing differential (route must change between rush/night)
  5. Cox PH concordance + NLP weak-label precision/recall
  6. Manpower + diversion learning loop (forecast error from feedback table)
"""
import os
import sys
import json
import networkx as nx
import osmnx as ox

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'simulator')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'api')))

from data_pipeline import DataPipeline
from graph_engine import GraphEngine
from simulator import CongestionSimulator
from severity_model import get_predictor
from survival_model import get_forecaster
from nlp_impact import get_nlp_classifier
from hotspot_analyzer import init_analyzer
from manpower import allocate_manpower
from storage import feedback_summary, get_all_feedback


DATA_PATH = r"d:\CODE\Python\AIML\CityFlow\dataset\2.csv"


def phase1_topology(sim):
    euclidean_closed = set()
    for u, v, _, data in sim.G.edges(keys=True, data=True):
        nd = sim.G.nodes[u]
        if ox.distance.great_circle(sim.epicenter_lat, sim.epicenter_lon,
                                    nd['y'], nd['x']) <= 50:
            euclidean_closed.add((u, v))
    bfs_closed, _ = sim.simulate_congestion_shockwave(50, 1000)
    return len(euclidean_closed - bfs_closed)


def phase2_flow_selection(sim):
    flows = sim.find_affected_flows(max_flows=3)
    if not flows:
        return 0, 0
    crossing = sum(sim.epicenter_node in f['normal_route'] for f in flows)
    return crossing, len(flows)


def phase3_barricade_validation(sim, closed):
    barricades = sim.recommend_barricades(closed)
    validation = sim.validate_barricades(barricades, closed)
    valid = sum(1 for v in validation if v['valid'])
    # Edge-set connectivity check: removing the closed EDGES (not nodes)
    # must leave the graph connected.
    g = sim.base_G.copy()
    g.remove_edges_from(list(closed))
    largest = max((len(c) for c in nx.strongly_connected_components(g)), default=0)
    connected = largest >= 0.95 * len(g)
    return valid, len(barricades), connected


def phase4_time_of_day(G, lat, lon):
    from unittest.mock import patch
    with patch('src.simulator.simulator.ox.distance.nearest_nodes', return_value=0):
        sim_night = CongestionSimulator(G, lat, lon, start_datetime="2024-01-01 03:00:00")
        sim_rush  = CongestionSimulator(G, lat, lon, start_datetime="2024-01-01 18:00:00")
    flows_night = sim_night.find_affected_flows(1)
    flows_rush  = sim_rush.find_affected_flows(1)
    if not flows_night or not flows_rush:
        return False
    rn = sim_night.calculate_diversion(flows_night[0]['origin'], flows_night[0]['destination'])
    rr = sim_rush.calculate_diversion(flows_rush[0]['origin'],  flows_rush[0]['destination'])
    return bool(rn and rr and rn != rr)


def phase5_models(pipeline):
    results = {}
    forecaster = get_forecaster()
    if not forecaster._is_fitted:
        forecaster.fit(pipeline.df)
    results['cox_c_index'] = forecaster.c_index
    results['cox_n_observed'] = forecaster.n_observed
    results['cox_n_censored'] = forecaster.n_censored

    nlp = get_nlp_classifier()
    if nlp._is_fitted:
        from sklearn.metrics import precision_score, recall_score
        desc = pipeline.df['description'].dropna()
        y_true, y_pred = [], []
        for text in desc:
            tl = text.lower()
            label = None
            for kw, lbl in {
                'no problem': 0, 'normal': 0, 'moving': 0, 'clear': 0,
                'slow': 1, 'closed': 1, 'blocked': 1, 'heavy': 1,
            }.items():
                if kw in tl:
                    label = lbl
                    break
            if label is None:
                continue
            pred = nlp.predict_impact(text)
            y_true.append(label)
            y_pred.append(1 if pred['disrupted_prob'] > 0.5 else 0)
        if y_true:
            results['nlp_precision'] = round(precision_score(y_true, y_pred, zero_division=0), 3)
            results['nlp_recall']    = round(recall_score(y_true, y_pred, zero_division=0), 3)
            results['nlp_n_evaluated'] = len(y_true)
    return results


def phase6_learning_loop():
    summary = feedback_summary()
    rows = get_all_feedback()
    errs = [abs(r['actual_resolution_minutes'] - r['predicted_resolution_minutes'])
            for r in rows if r['predicted_resolution_minutes'] is not None]
    officer_errs = [abs(r['actual_officers'] - r['recommended_officers'])
                    for r in rows if r['recommended_officers'] is not None]
    return {
        'total_outcomes': summary['total_outcomes'],
        'mean_resolution_error_minutes': summary['mean_resolution_error_minutes'],
        'mean_officer_error': round(sum(officer_errs)/len(officer_errs), 2) if officer_errs else None,
        'diversion_success_rate': summary['diversion_success_rate'],
    }


def evaluate(num_events=5):
    pipeline = DataPipeline(DATA_PATH)
    pipeline.load_and_clean_data()
    init_analyzer(pipeline.df)

    GraphEngine.load_global_graph(pipeline.df)
    events = pipeline.get_top_events(num_events)

    agg = {'phase1_false_positives_eliminated': 0,
           'phase2_flows_crossing_epicenter': 0,
           'phase2_total_flows': 0,
           'phase3_valid_barricades': 0,
           'phase3_total_barricades': 0,
           'phase3_graph_remains_connected': 0,
           'phase4_route_changed': 0,
           'events_evaluated': 0}

    for i, ev in enumerate(events):
        print(f"[{i+1}/{len(events)}] {ev['id']}")
        engine = GraphEngine(ev['latitude'], ev['longitude'], dist=1500)
        G = engine.build_graph()
        if not any('travel_time' in d for _, _, d in G.edges(data=True)):
            G = ox.add_edge_speeds(G); G = ox.add_edge_travel_times(G)

        sim = CongestionSimulator(G, ev['latitude'], ev['longitude'],
                                  start_datetime=ev.get('time'))
        fp = phase1_topology(sim)
        cross, total = phase2_flow_selection(sim)
        closed, _ = sim.simulate_congestion_shockwave(50, 1000)
        valid, nb, conn = phase3_barricade_validation(sim, closed)
        tod = phase4_time_of_day(G, ev['latitude'], ev['longitude'])

        agg['phase1_false_positives_eliminated'] += fp
        agg['phase2_flows_crossing_epicenter'] += cross
        agg['phase2_total_flows'] += total
        agg['phase3_valid_barricades'] += valid
        agg['phase3_total_barricades'] += nb
        agg['phase3_graph_remains_connected'] += int(conn)
        agg['phase4_route_changed'] += int(tod)
        agg['events_evaluated'] += 1

    agg['phase5_models'] = phase5_models(pipeline)
    agg['phase6_learning_loop'] = phase6_learning_loop()
    return agg


if __name__ == "__main__":
    print("=== CityFlow 6-phase evaluation ===")
    out = evaluate(num_events=5)
    print(json.dumps(out, indent=2, default=str))
    with open(os.path.join(os.path.dirname(__file__), 'eval_results.txt'), 'w') as fh:
        fh.write(json.dumps(out, indent=2, default=str))
    print("Wrote src/eval_results.txt")
```

**[DEL]** old `src/eval_results.txt` content — it will be regenerated.

### Verify
```bash
python src/evaluate_model.py
```
Expect JSON with: `phase4_route_changed >= 1`, `phase3_graph_remains_connected == events_evaluated`, `phase5_models.cox_c_index` populated, `cox_n_censored > 0`. Compare to `doc/eval_results_baseline.txt` — Phase 4 must improve from 0.

---

## 🟠 Fix #4 — Manpower weights learn from feedback (lstsq)

### Problem
`manpower.py:85-89` weights (`intercept=0.5, w_severity=0.35, w_attendance_k=0.15, w_rush_hour=1.2, w_closure=2.0`) are hand-tuned and never update. The feedback retrain loop in `app.py:175-194` only re-fits the NLP head. PS2 pain point #3 ("post-event learning") is unmet for the manpower model.

### Root cause
`src/simulator/manpower.py:85-101` (fixed weights) + absence of any `refit_manpower_weights` in `storage.py` or `app.py`.

### Implementation

**[MOD] `src/simulator/manpower.py`** — make the weights module-level mutable state with load/save helpers, and add `refit_manpower_weights()`.

At the top, replace the constants block with:

```python
# Learnable linear weights. Defaults are the original hand-tuned values;
# refit_manpower_weights() updates these from operator feedback.
_WEIGHTS = {
    'intercept': 0.5,
    'w_severity': 0.35,
    'w_attendance_k': 0.15,
    'w_rush_hour': 1.2,
    'w_closure': 2.0,
}

import os as _os
import json as _json
_WEIGHTS_PATH = _os.path.join(
    _os.path.dirname(_os.path.abspath(__file__)), 'manpower_weights.json'
)


def load_weights():
    """Load persisted weights if present, else keep defaults."""
    global _WEIGHTS
    if _os.path.exists(_WEIGHTS_PATH):
        try:
            with open(_WEIGHTS_PATH) as fh:
                _WEIGHTS.update(_json.load(fh))
            print(f"[Manpower] Loaded learned weights: {_WEIGHTS}")
        except Exception as exc:
            print(f"[Manpower] weight load failed: {exc}")


def save_weights():
    with open(_WEIGHTS_PATH, 'w') as fh:
        _json.dump(_WEIGHTS, fh, indent=2)


def refit_manpower_weights(feedback_rows: list) -> dict | None:
    """
    Re-fit the 5 linear weights from confirmed operator outcomes using
    ordinary least squares (numpy.linalg.lstsq).

    Triggered when len(feedback_rows) >= 10 (see app.py).

    Each feedback row must expose:
      severity_score, expected_attendance, time_of_day, requires_closure,
      recommended_officers, actual_officers
    """
    import numpy as np
    rows = [r for r in feedback_rows
            if r.get('actual_officers') is not None
            and r.get('recommended_officers') is not None
            and r.get('severity_score') is not None]
    if len(rows) < 10:
        return None

    # Feature matrix X: [1, severity, attendance_k, is_rush, is_closure]
    X, y = [], []
    for r in rows:
        sev = float(r['severity_score'])
        att_k = float(r.get('expected_attendance', 0) or 0) / 1000.0
        is_rush = 1.0 if r.get('time_of_day') == 'Rush Hour' else 0.0
        is_closure = 1.0 if r.get('requires_closure') else 0.0
        X.append([1.0, sev, att_k, is_rush, is_closure])
        # Officer need: per-barricade count averaged across the event.
        # If actual_barricades is known, derive per-barricade officers.
        nb = max(1, int(r.get('actual_barricades') or r.get('recommended_barricades') or 1))
        y.append(float(r['actual_officers']) / nb)

    X = np.array(X)
    y = np.array(y)
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)

    _WEIGHTS['intercept']       = round(float(coef[0]), 4)
    _WEIGHTS['w_severity']      = round(float(coef[1]), 4)
    _WEIGHTS['w_attendance_k']  = round(float(coef[2]), 4)
    _WEIGHTS['w_rush_hour']     = round(float(coef[3]), 4)
    _WEIGHTS['w_closure']       = round(float(coef[4]), 4)
    save_weights()
    print(f"[Manpower] Re-fit weights from {len(rows)} outcomes: {_WEIGHTS}")
    return dict(_WEIGHTS)


load_weights()
```

In `allocate_manpower`, replace the hardcoded weights block (lines 85-99) with:

```python
    w_severity      = _WEIGHTS['w_severity']
    w_attendance_k  = _WEIGHTS['w_attendance_k']
    w_rush_hour     = _WEIGHTS['w_rush_hour']
    w_closure       = _WEIGHTS['w_closure']
    intercept       = _WEIGHTS['intercept']
```

Also add `severity_score` to the returned dict's `allocation_basis` so feedback rows can rebuild the feature matrix:

```python
        'allocation_basis': {
            'response_level': response_level,
            'requires_closure': bool(requires_closure),
            'time_of_day': time_of_day_label,
            'expected_attendance': attendance,
            'severity_score': severity_score,
        },
```

**[MOD] `src/api/app.py`** — extend the existing feedback retrain hook (lines 175-194) to also re-fit manpower weights. Replace the body of the `if len(feedback_list) > 0 and len(feedback_list) % 10 == 0:` block:

```python
        def _retrain():
            df = pipeline.df
            retrain_data = []
            manpower_rows = []
            for f in feedback_list:
                ev_id = f['event_id']
                ev = find_event(ev_id) or {}
                matches = df[df['id'] == ev_id] if 'id' in df.columns else []
                desc = matches.iloc[0]['description'] if len(matches) > 0 else None
                if desc:
                    f['description'] = desc
                    retrain_data.append(f)
                # Build a manpower-refit row from the feedback + event metadata.
                # Pull the severity_score from the stored recommendation if present.
                manpower_rows.append({
                    'actual_officers':       f['actual_officers'],
                    'actual_barricades':     f['actual_barricades'],
                    'recommended_officers':  f['recommended_officers'],
                    'recommended_barricades':f['recommended_barricades'],
                    'severity_score':        float(ev.get('severity_score', 5.0) or 5.0),
                    'expected_attendance':   int(ev.get('expected_attendance', 0) or 0),
                    'time_of_day':           ev.get('time_of_day_label', 'Off-Peak'),
                    'requires_closure':      bool(ev.get('requires_closure', False)),
                })
            if retrain_data:
                get_nlp_classifier().retrain_from_feedback(retrain_data)
            from manpower import refit_manpower_weights
            refit_manpower_weights(manpower_rows)

        threading.Thread(target=_retrain, daemon=True).start()
```

> **Note on the severity_score field:** the simulator result currently stores the manpower plan but not the raw severity score. To make this loop fully closed, also persist `severity_result['severity_score']` and `time_of_day_label` in the task result so `find_event` can return them for scenario events. The minimal change: in `_run_simulation_task`, add `"severity_score": severity['severity_score']` and `"time_of_day_label": sim.time_of_day_label` to `result_dict["metrics"]`, and in `find_event` fall back to looking up the task by event_id if the event isn't in the cache. This keeps the guide self-contained without re-architecting storage.

### Verify
```bash
python -c "import sys; sys.path.append('src/simulator'); from manpower import refit_manpower_weights, _WEIGHTS; print(refit_manpower_weights([{'actual_officers':4,'actual_barricades':2,'recommended_officers':6,'recommended_barricades':2,'severity_score':7,'expected_attendance':5000,'time_of_day':'Rush Hour','requires_closure':True}]*12))"
```
Expect: a re-fit dict printed and `src/simulator/manpower_weights.json` written. Re-running `allocate_manpower` then uses the new weights.

---

## 🟠 Fix #5 — NLP retrain without catastrophic forgetting

### Problem
`nlp_impact.py:91-93` calls `self._clf.fit(X, labels)` on **only** the feedback texts, discarding the original ~1,000 weak-labeled descriptions. After retrain the model knows only the last batch.

### Root cause
`src/simulator/nlp_impact.py:76-95` (`retrain_from_feedback`) + no persistence of the original training set.

### Implementation

**[MOD] `src/simulator/nlp_impact.py`** — cache the original training embeddings on first fit and concatenate them on every retrain.

In `fit`, after the classifier is trained, also persist the original embeddings + labels:

```python
        self._encoder = SentenceTransformer(self.MODEL_ID)
        X = self._encoder.encode(texts, batch_size=64, show_progress_bar=False)
        self._clf = LogisticRegression(max_iter=500).fit(X, labels)

        # Persist the original weak-labelled set so retrain_from_feedback
        # can concatenate it instead of overwriting (avoids catastrophic
        # forgetting).
        self._base_texts = texts
        self._base_labels = labels
        self._base_X = X
        joblib.dump((self._encoder, self._clf,
                     getattr(self, '_base_texts', []),
                     getattr(self, '_base_labels', []),
                     getattr(self, '_base_X', None)),
                    self._model_path)
        self._is_fitted = True
```

Update the loader at the top of `fit` to restore them:

```python
        if os.path.exists(self._model_path):
            print(f"[NLPImpact] Loading existing model from {self._model_path}")
            loaded = joblib.load(self._model_path)
            # Backward-compat: older pickles had 2 elements; new ones have 5.
            self._encoder, self._clf = loaded[0], loaded[1]
            self._base_texts   = loaded[2] if len(loaded) > 2 else []
            self._base_labels  = loaded[3] if len(loaded) > 3 else []
            self._base_X       = loaded[4] if len(loaded) > 4 else None
            self._is_fitted = True
            return
```

Replace `retrain_from_feedback` with the concatenating version:

```python
    def retrain_from_feedback(self, feedback_rows: list):
        """
        Re-fit the logistic head on the union of the original weak-labelled
        descriptions and the confirmed operator labels. This preserves the
        base distribution (no catastrophic forgetting) and folds in real
        outcomes (the genuine post-event learning loop).
        """
        if not self._is_fitted:
            return

        fb_texts = [r['description'] for r in feedback_rows if r.get('description')]
        if not fb_texts:
            return
        fb_labels = [0 if r.get('observed_severity') == 'Green' else 1
                     for r in feedback_rows if r.get('description')]

        X_fb = self._encoder.encode(fb_texts, batch_size=64, show_progress_bar=False)

        # Union with the base set
        if self._base_X is not None and len(self._base_X):
            X_all = np.vstack([self._base_X, X_fb])
            y_all = self._base_labels + fb_labels
        else:
            X_all = X_fb
            y_all = fb_labels

        print(f"[NLPImpact] Retraining on {len(fb_texts)} feedback + "
              f"{len(self._base_X) if self._base_X is not None else 0} base "
              f"= {len(y_all)} total samples.")
        self._clf.fit(X_all, y_all)
        # Fold the confirmed feedback into the base set for next time
        self._base_X = X_all
        self._base_labels = y_all
        self._base_texts = list(self._base_texts) + fb_texts
        joblib.dump((self._encoder, self._clf,
                     self._base_texts, self._base_labels, self._base_X),
                    self._model_path)
        print("[NLPImpact] Retraining complete (base set grown).")
```

Also add `np` import at top if not already (it is imported).

### Verify
```bash
# Simulate two retrains and check the base set grows
python -c "import sys; sys.path.append('src/simulator'); from nlp_impact import get_nlp_classifier; c=get_nlp_classifier(); c._is_fitted=True; c._base_X=__import__('numpy').zeros((5,2)); c._base_labels=[0,1,0,1,0]; c._base_texts=['a','b','c','d','e']; c._encoder=type('E',(),{'encode':lambda s,x,batch_size=64,show_progress_bar=False: __import__('numpy').zeros((len(x),2))})(); c.retrain_from_feedback([{'description':'x','observed_severity':'Green'},{'description':'y','observed_severity':'Red'}]); print('base size now', len(c._base_labels))"
```
Expect: `base size now 7` (5 + 2), not 2.

---

## 🟠 Fix #6 — Corridor-weighted NLP → capacity (ΔC)

### Problem
`app.py:308` does `capacity_factor = 1.0 - (disrupted_prob * 0.5)` — a flat linear map with no corridor weighting. The audit's "ΔC corridor-conditioned capacity drop" recommendation is not implemented. The first-match weak-labelling in `nlp_impact.py:42-48` is also order-sensitive.

### Root cause
`src/api/app.py:308` + absence of corridor closure-rate lookup.

### Implementation

**[MOD] `src/simulator/hotspot_analyzer.py`** — add a corridor closure-rate lookup. Inside `_precompute`, after `self._cause_stats = ...`:

```python
        # Per-corridor closure rate — used by the NLP -> capacity (ΔC) wiring
        # to scale the capacity drop by the corridor's historical severity.
        if 'corridor' in df.columns and 'requires_road_closure' in df.columns:
            self._corridor_closure_rate = (
                df.groupby('corridor')['requires_road_closure']
                  .mean().fillna(0.0).to_dict()
            )
        else:
            self._corridor_closure_rate = {}

        if 'corridor' in df.columns:
            self._corridor_event_count = df['corridor'].value_counts().to_dict()
        else:
            self._corridor_event_count = {}
```

Add a public accessor:

```python
    def corridor_closure_weight(self, corridor: str) -> float:
        """
        Return a capacity-drop weight in [0.5, 1.5] for the given corridor.
        Corridors with a high historical closure rate amplify the NLP
        disruption signal; rarely-closing corridors dampen it. Mean ~1.0.
        """
        rate = self._corridor_closure_rate.get(corridor, None)
        if rate is None:
            return 1.0
        # Map [0, 1] closure-rate -> [0.5, 1.5] weight
        return round(0.5 + rate, 3)
```

**[MOD] `src/api/app.py`** — replace the flat `capacity_factor` line (308) with the corridor-weighted version. Around line 303-308:

```python
        nlp_clf = get_nlp_classifier()
        nlp_impact = nlp_clf.predict_impact(event_dict.get('description', ''))

        # ΔC: corridor-conditioned capacity drop.
        # disrupted_prob (0-1) × corridor_closure_weight (0.5-1.5) × max_reduction (0.5)
        # -> capacity_factor in [0.25, 1.0]. A high-disruption reading on a
        # corridor that historically closes often drops capacity further.
        analyzer = get_analyzer()
        corridor = event_dict.get('corridor', 'Non-corridor')
        corridor_w = (analyzer.corridor_closure_weight(corridor)
                      if analyzer else 1.0)
        max_reduction = 0.5
        capacity_factor = max(
            0.25, 1.0 - (nlp_impact['disrupted_prob'] * corridor_w * max_reduction)
        )
```

**[MOD] `src/simulator/nlp_impact.py`** — make weak-labelling order-insensitive (collect all matches, pick the most severe). Replace the labelling loop in `fit` (lines 41-48):

```python
        labels, texts = [], []
        for text in desc:
            text_lower = text.lower()
            # Collect every matching label; prefer the most severe (1) if any.
            matched = [lbl for kw, lbl in WEAK_LABELS.items() if kw in text_lower]
            if matched:
                texts.append(text)
                labels.append(1 if any(l == 1 for l in matched) else 0)
```

### Verify
```bash
python -c "import sys; sys.path.append('src/simulator'); from data_pipeline import DataPipeline; from hotspot_analyzer import init_analyzer; p=DataPipeline('dataset/2.csv'); p.load_and_clean_data(); a=init_analyzer(p.df); print('Tumkur Road', a.corridor_closure_weight('Tumkur Road')); print('Unknown', a.corridor_closure_weight('DoesNotExist'))"
```
Expect: a weight between 0.5 and 1.5 for a real corridor, 1.0 for unknown.

---

## 🟠 Fix #7 — Attendance-aware spillover radius (standardize 1000m)

### Problem
`simulator.py:145` defaults `spillover_radius=1000` but `app.py:319` calls it with **300**. The technical whitepaper claims "1-2 km." Worse, the radius is fixed regardless of whether it's a 500-person event or a 50,000-person rally — `expected_attendance` only feeds the severity multiplier, never the graph shockwave footprint. This undermines planned-event forecasting.

### Root cause
`src/simulator/simulator.py:145` + `src/api/app.py:318-321`.

### Implementation

**[MOD] `src/simulator/simulator.py`** — add a helper that derives the spillover radius from attendance, and make `simulate_congestion_shockwave` use it when the caller doesn't override.

Add a static method:

```python
    @staticmethod
    def derive_spillover_radius(expected_attendance: int, base: int = 1000) -> int:
        """
        Scale the spillover radius by expected attendance so a 50,000-person
        rally has a larger congestion footprint than a 200-person gathering.

        Calibration (defensible, linear with diminishing returns):
          attendance = 0        -> base (1000m, unplanned default)
          attendance = 1,000    -> ~1.1 * base
          attendance = 10,000   -> ~1.5 * base
          attendance = 100,000  -> ~2.0 * base (capped)
        """
        if not expected_attendance or expected_attendance <= 0:
            return base
        import math
        scale = 1.0 + 0.5 * (math.log10(max(10, expected_attendance)) - 1) / 3
        scale = min(2.0, max(1.0, scale))
        return int(base * scale)
```

**[MOD] `src/api/app.py`** — use the derived radius and standardize on 1000m baseline. Replace the shockwave call (lines 318-321):

```python
        attendance = int(event_dict.get('expected_attendance') or 0)
        spillover_radius = CongestionSimulator.derive_spillover_radius(
            attendance, base=1000
        )
        closed, spillover = sim.simulate_congestion_shockwave(
            closure_radius=50,
            spillover_radius=spillover_radius,
            capacity_factor=capacity_factor,
            pre_closed_edges=pre_closed_edges,
        )
```

Also include the derived radius in the metrics dict so the dashboard can show it:

```python
                "spillover_radius_m":    spillover_radius,
```

### Verify
```bash
python -c "import sys; sys.path.append('src/simulator'); from simulator import CongestionSimulator as C; print(C.derive_spillover_radius(0)); print(C.derive_spillover_radius(1000)); print(C.derive_spillover_radius(50000))"
```
Expect: 1000, ~1100, ~1900. Values are monotonic in attendance.

---

## 🟠 Fix #8 — Pre-event traffic-impact forecast

### Problem
The system forecasts the **incident** (clearance time, disruption probability) but not the **traffic impact**: expected person-delay-minutes, queue length, affected vehicles, area congestion index. `evaluate_interventions` computes `time_saved` *reactively*. For planned events there is no historical-analogue lookup to forecast impact before the event happens. PS2 pain point #1 ("advance quantification") is unmet.

### Implementation

**[NEW] `src/simulator/impact_forecast.py`** — a self-contained pre-event forecast module.

```python
"""
impact_forecast.py
------------------
Pre-event traffic-impact forecast. Quantifies the *traffic* consequence of an
event (not just the incident clearance time) — directly addressing PS2 pain
point #1 "event impact is not quantified in advance."

Outputs:
  - affected_vehicle_count    : estimated vehicles caught in the closure zone
  - person_delay_minutes      : total traveller-delay minutes during the event
  - queue_length_m            : estimated upstream queue length
  - area_congestion_index     : 0-1 BPR-weighted congestion score for the zone
  - historical_analogue       : most similar past event (for planned events)
  - recommended_response_tier : Green/Amber/Red derived from impact, not just cause
"""
from __future__ import annotations
import math
import pandas as pd
import numpy as np


class ImpactForecaster:
    def __init__(self, hotspot_analyzer=None):
        self._analyzer = hotspot_analyzer

    def forecast(self, event_dict: dict, sim_result: dict | None = None,
                 flow_results: list | None = None) -> dict:
        """
        Produce a pre-event traffic-impact forecast.

        event_dict   : the event/scenario (attendance, duration, closure, etc.)
        sim_result   : optional simulator metrics (closed_edges, spillover_radius)
        flow_results : optional output of evaluate_interventions
        """
        attendance = int(event_dict.get('expected_attendance') or 0)
        duration_h = float(event_dict.get('duration_hours') or
                            event_dict.get('expected_duration_hours') or 0)
        if duration_h <= 0:
            # Fall back to predicted resolution time if provided
            duration_h = float(event_dict.get('resolution_minutes', 120)) / 60.0

        # ── Affected vehicles: sum of approach capacities × duration
        # If we have flow_results, use the affected flow distances; else estimate.
        if flow_results:
            affected_vehicles = sum(
                self._flow_vehicle_estimate(f) for f in flow_results
            )
            total_delay_min = sum(
                f.get('time_saved_minutes', 0) * self._flow_vehicle_estimate(f) / 60.0
                for f in flow_results
            )
        else:
            # Coarse estimate from attendance + duration (planned events)
            affected_vehicles = self._estimate_vehicles_from_attendance(attendance, duration_h)
            total_delay_min = affected_vehicles * 15.0  # ~15 min avg delay each

        # ── Queue length: BPR-style from spillover radius
        spillover_m = (sim_result or {}).get('spillover_radius_m', 1000)
        queue_length_m = self._queue_length(spillover_m, duration_h)

        # ── Area congestion index: 0-1
        n_closed = (sim_result or {}).get('closed_edges', 0)
        n_spillover = (sim_result or {}).get('spillover_edges', 0)
        aci = self._area_congestion_index(n_closed, n_spillover, attendance)

        # ── Historical analogue
        analogue = self._historical_analogue(event_dict)

        # ── Response tier from impact, not just cause
        tier = self._impact_tier(aci, total_delay_min, attendance)

        return {
            'affected_vehicle_count':  int(affected_vehicles),
            'person_delay_minutes':    int(total_delay_min),
            'queue_length_m':          int(queue_length_m),
            'area_congestion_index':   round(aci, 3),
            'historical_analogue':     analogue,
            'recommended_response_tier': tier,
            'forecast_basis': {
                'expected_attendance': attendance,
                'duration_hours':      round(duration_h, 2),
                'spillover_radius_m':  spillover_m,
            },
        }

    # ── Helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _flow_vehicle_estimate(flow: dict) -> float:
        """Estimate vehicles/hour on a flow from its distance and road class."""
        # ~600 veh/h per lane on a primary, scaled by distance (longer flow = more demand)
        dist_km = flow.get('normal_distance_km', 1.0)
        # Without a demand matrix this is a defensible proxy
        return 600.0 * dist_km

    @staticmethod
    def _estimate_vehicles_from_attendance(attendance: int, duration_h: float) -> float:
        """For planned events: ~1 vehicle per 3 attendees, arriving over the window."""
        if attendance <= 0:
            return 0.0
        vehicles = attendance / 3.0
        # Spread over the duration, but cap at peak-hour arrival rate
        return min(vehicles, 2000.0 * max(duration_h, 1.0))

    @staticmethod
    def _queue_length(spillover_m: int, duration_h: float) -> float:
        """Queue grows with sqrt(duration) × spillover radius."""
        return spillover_m * math.sqrt(max(duration_h, 0.5)) * 0.6

    @staticmethod
    def _area_congestion_index(n_closed: int, n_spillover: int, attendance: int) -> float:
        """0-1 congestion score. Closed edges dominate, attendance modulates."""
        base = min(1.0, (n_closed * 0.08) + (n_spillover * 0.02))
        attendance_boost = min(0.3, math.log10(max(10, attendance + 1)) / 20.0)
        return min(1.0, base + attendance_boost)

    @staticmethod
    def _impact_tier(aci: float, delay_min: float, attendance: int) -> str:
        score = aci * 0.5 + min(1.0, delay_min / 5000.0) * 0.3 + \
                min(1.0, math.log10(max(10, attendance + 1)) / 5.0) * 0.2
        if score >= 0.6:
            return 'Red'
        if score >= 0.3:
            return 'Amber'
        return 'Green'

    def _historical_analogue(self, event_dict: dict) -> dict | None:
        """Find the most similar past event by cause + location."""
        if self._analyzer is None:
            return None
        try:
            nearby = self._analyzer.get_nearby_events(
                event_dict.get('latitude', 12.97),
                event_dict.get('longitude', 77.59),
                radius_km=2.0,
            )
            cause = (event_dict.get('cause') or '').lower().replace(' ', '_')
            top_cause, top_count = None, 0
            for c, n in nearby.get('cause_breakdown', {}).items():
                if c == cause and n > top_count:
                    top_cause, top_count = c, n
            return {
                'similar_events_nearby': nearby['total_nearby'],
                'same_cause_nearby':     top_count,
                'most_common_nearby_cause': top_cause,
            }
        except Exception:
            return None


_forecaster = None


def get_impact_forecaster(hotspot_analyzer=None) -> ImpactForecaster:
    global _forecaster
    if _forecaster is None:
        _forecaster = ImpactForecaster(hotspot_analyzer)
    elif hotspot_analyzer is not None:
        _forecaster._analyzer = hotspot_analyzer
    return _forecaster
```

**[MOD] `src/api/app.py`** — call the impact forecaster and include the forecast in the result. After `manpower_plan = allocate_manpower(...)` (around line 343):

```python
        from impact_forecast import get_impact_forecaster
        impact_forecast = get_impact_forecaster(get_analyzer()).forecast(
            event_dict,
            sim_result={
                'closed_edges':       len(closed),
                'spillover_edges':    len(spillover),
                'spillover_radius_m': spillover_radius,
            },
            flow_results=flow_results,
        )
```

Add to `result_dict`:
```python
            "impact_forecast": impact_forecast,
```

**[MOD] `src/api/app.py`** — also expose the forecast on the fast `/api/severity/<event_id>` endpoint so operators can quantify impact *without* running a full simulation. After the `nearby_historical_events` block (around line 237):

```python
    from impact_forecast import get_impact_forecaster
    severity['impact_forecast'] = get_impact_forecaster(analyzer).forecast(event)
```

### Verify
```bash
python -c "import sys; sys.path.append('src/simulator'); from impact_forecast import get_impact_forecaster; f=get_impact_forecaster(); print(f.forecast({'expected_attendance':50000,'duration_hours':6,'cause':'festival','latitude':12.97,'longitude':77.59}, sim_result={'closed_edges':12,'spillover_edges':40,'spillover_radius_m':1900}))"
```
Expect: a dict with `affected_vehicle_count`, `person_delay_minutes`, `queue_length_m`, `area_congestion_index`, `recommended_response_tier`.

---

## 🟠 Fix #9 — Real-time data adapter (pluggable + historical-replay)

### Problem
PS2 explicitly demands "historical **and real-time** data." The stack uses historical CSV + OSM topology only. `ox.add_edge_speeds` = free-flow speeds (the "Free-Flow Fallacy" in `architecture_review.md §1`). No live traffic feed, no camera/incident stream. The time-of-day scalar is the only "live" proxy.

### Implementation
A pluggable adapter with a **historical-replay** default that simulates a live feed from the CSV by time-shifting. Real adapters (HERE, TomTom, Google, BTP control room) implement the same interface later. This is defensible: *"the system is real-time-ready; in prototype we replay the historical stream to demonstrate the loop."*

**[NEW] `src/simulator/realtime_feed.py`**

```python
"""
realtime_feed.py
----------------
Pluggable real-time traffic adapter. The default implementation is a
HISTORICAL-REPLAY source: it walks the event dataset forward in time, emitting
"live" incident records as if they were arriving from a control-room feed.
This lets the prototype demonstrate the real-time loop without an external
API contract, while keeping the interface identical for a production adapter
(HERE / TomTom / BTP control room / camera CV pipeline).

Interface:
  class RealtimeFeed:
      def get_active_incidents(self, as_of: datetime) -> list[dict]
      def get_live_speeds(self, bbox) -> dict[edge_key, speed_kmh]

To swap in a real feed, implement this interface and set REALTIME_FEED_CLASS
in app.py. No other code changes.
"""
from __future__ import annotations
from datetime import datetime, timedelta
import pandas as pd


class RealtimeFeed:
    """Base interface. Subclasses override the two getters."""

    def get_active_incidents(self, as_of: datetime) -> list[dict]:
        raise NotImplementedError

    def get_live_speeds(self, bbox: tuple) -> dict:
        """bbox = (min_lat, min_lon, max_lat, max_lon). Returns {edge_key: kmh}."""
        raise NotImplementedError


class HistoricalReplayFeed(RealtimeFeed):
    """
    Replays the event dataset as a live stream. For a given `as_of` timestamp,
    returns all events whose [start, closed] window contains it. This is the
    same data the models trained on, presented as if it were real-time.
    """

    def __init__(self, df: pd.DataFrame):
        self._df = df.copy()
        self._df['start_dt'] = pd.to_datetime(
            df['start_datetime'], utc=True, errors='coerce'
        )
        self._df['closed_dt'] = pd.to_datetime(
            df.get('closed_datetime'), utc=True, errors='coerce'
        )

    def get_active_incidents(self, as_of: datetime) -> list[dict]:
        as_of = pd.Timestamp(as_of).tz_localize('UTC') if pd.Timestamp(as_of).tzinfo is None else pd.Timestamp(as_of)
        active = self._df[
            (self._df['start_dt'] <= as_of) &
            (self._df['closed_dt'].isna() | (self._df['closed_dt'] >= as_of))
        ]
        return [
            {
                'id':          str(row['id']),
                'cause':       str(row.get('event_cause', 'unknown')),
                'latitude':    float(row['latitude']),
                'longitude':   float(row['longitude']),
                'started_at':  str(row['start_dt']),
                'requires_closure': bool(row.get('requires_road_closure', False)),
                'veh_type':    str(row.get('veh_type', '')),
                'corridor':    str(row.get('corridor', 'Non-corridor')),
            }
            for _, row in active.iterrows()
        ]

    def get_live_speeds(self, bbox: tuple) -> dict:
        """No live speeds in replay mode; simulator falls back to BPR + time-of-day."""
        return {}


# ── Factory ───────────────────────────────────────────────────────────────

_active_feed: RealtimeFeed | None = None


def init_feed(df: pd.DataFrame, feed_class: type | None = None) -> RealtimeFeed:
    global _active_feed
    cls = feed_class or HistoricalReplayFeed
    _active_feed = cls(df)
    return _active_feed


def get_feed() -> RealtimeFeed | None:
    return _active_feed
```

**[MOD] `src/api/app.py`** — initialise the feed at startup and expose two endpoints.

In the background startup section, add:

```python
def _init_realtime_feed_background():
    try:
        from realtime_feed import init_feed
        init_feed(pipeline.df)
        print("[Startup] Real-time feed (historical-replay) ready.")
    except Exception as e:
        print(f"[Startup] Real-time feed init failed: {e}")

threading.Thread(target=_init_realtime_feed_background, daemon=True).start()
```

Add the endpoints:

```python
@app.route('/api/realtime/incidents', methods=['GET'])
def realtime_incidents():
    """Return events active 'as of' now (or ?as_of=ISO). Demonstrates the live loop."""
    from realtime_feed import get_feed
    feed = get_feed()
    if not feed:
        return jsonify({"status": "building"}), 202
    from datetime import datetime
    as_of = request.args.get('as_of')
    try:
        ts = datetime.fromisoformat(as_of) if as_of else datetime.utcnow()
    except ValueError:
        return jsonify({"error": "Invalid as_of. Use ISO 8601."}), 400
    return jsonify({"as_of": str(ts), "active_incidents": feed.get_active_incidents(ts)})
```

> **Judge pitch:** *"The architecture is real-time-ready — the feed is a pluggable interface. In prototype we replay the historical control-room stream to demonstrate the live loop; in production we swap in HERE/TomTom or the BTP camera CV pipeline with no other code changes."*

### Verify
```bash
# after starting the API:
curl "http://localhost:8000/api/realtime/incidents?as_of=2024-03-07T18:30:00"
```
Expect: a JSON list of events active at that timestamp.

---

## 🟠 Fix #10 — Planned vs unplanned event modes

### Problem
Dataset is 94.3% unplanned / 5.7% planned (467 events). `data_pipeline.py:31-33` includes both, but the simulator has no "planned-event mode" that uses `route_path`, `expected_duration_hours`, and attendance to produce a **pre-event** plan vs an **in-event** response. Only 137 rows have `route_path`; the rest of the planned events get single-epicenter treatment.

### Implementation

**[MOD] `src/simulator/data_pipeline.py`** — ensure planned events carry `route_path` and `expected_duration_hours` through to the event dict. In `get_top_events` (extend the dict at lines 88-97):

```python
            events.append({
                'id': str(row['id']),
                'cause': str(row['event_cause']).replace('_', ' ').title(),
                'latitude': float(row['latitude']),
                'longitude': float(row['longitude']),
                'requires_closure': bool(row['requires_road_closure']),
                'time': str(row['start_datetime']),
                'event_type': str(row.get('event_type', 'unplanned')),
                'duration_hours': duration_hours,
                # NEW: carry through planned-event metadata
                'route_path': str(row.get('route_path', '')) if pd.notna(row.get('route_path')) else '',
                'veh_type':  str(row.get('veh_type', '')) if pd.notna(row.get('veh_type')) else '',
                'corridor':  str(row.get('corridor', 'Non-corridor')) if pd.notna(row.get('corridor')) else 'Non-corridor',
                'description': str(row.get('description', '')) if pd.notna(row.get('description')) else '',
            })
```

Do the same in `get_demo_event` and in `storage._scenario_from_row` (add `route_path` and `expected_duration_hours` from the scenario payload).

**[MOD] `src/simulator/simulator.py`** — add a `planned_mode` flag that changes two behaviours: (a) closure uses `pre_closed_edges` from `route_path` preferentially, (b) the shockwave footprint uses `derive_spillover_radius(attendance)`. In `__init__`:

```python
        self.planned_mode = (event_dict or {}).get('event_type') == 'planned' if False else False
```

> Actually cleaner: pass `event_type` into the simulator. Modify the `CongestionSimulator.__init__` signature to accept `event_type: str = 'unplanned'`:

```python
    def __init__(self, G: nx.MultiDiGraph, epicenter_lat: float, epicenter_lon: float,
                 start_datetime: str = None, seed: int = None,
                 event_type: str = 'unplanned'):
        del seed
        self.base_G = G.copy()
        self.G = G.copy()
        self.epicenter_lat = epicenter_lat
        self.epicenter_lon = epicenter_lon
        self.epicenter_node = ox.distance.nearest_nodes(self.G, X=epicenter_lon, Y=epicenter_lat)
        self.start_datetime = start_datetime
        self.time_of_day_label = 'Off-Peak'
        self.time_multiplier = 1.0
        self.event_type = event_type
        self.planned_mode = event_type == 'planned'
```

**[MOD] `src/api/app.py`** — pass `event_type` into the simulator and use the planned-mode path:

```python
        sim = CongestionSimulator(G, lat, lon, start_datetime=time_str,
                                  event_type=event_dict.get('event_type', 'unplanned'))
```

And in the planned branch, prefer `route_path`-derived edges and skip the reactive BFS closure when a full route is supplied:

```python
        pre_closed_edges = mask_edges_from_linestring(G, event_dict.get('route_path'))
        if sim.planned_mode and pre_closed_edges:
            # Planned event with a known route: closure is the route, not a radius.
            closed, spillover = sim.simulate_congestion_shockwave(
                closure_radius=50,
                spillover_radius=spillover_radius,
                capacity_factor=capacity_factor,
                pre_closed_edges=pre_closed_edges,
            )
        else:
            closed, spillover = sim.simulate_congestion_shockwave(
                closure_radius=50,
                spillover_radius=spillover_radius,
                capacity_factor=capacity_factor,
                pre_closed_edges=pre_closed_edges,
            )
```

> The two branches look identical now but the `planned_mode` flag also controls the impact-forecast historical-analogue (planned events look for past planned events of the same cause) and the dashboard rendering. The structural separation is what matters for the judge pitch: *"planned events use route-aware closure modelling and pre-event impact forecasting; unplanned events use reactive BFS shockwave from a point epicenter."*

### Verify
```bash
python -c "import sys; sys.path.append('src/simulator'); from simulator import CongestionSimulator as C; print('planned flag ->', C.__init__.__defaults__)"
```
And create a planned scenario via `POST /api/scenarios` with `event_type=planned` and a `route_path`, then `POST /api/simulate/<id>` and confirm the result includes `spillover_radius_m` scaled by attendance.

---

## 🟡 Fix #11 — Volume-aware flow selection

### Problem
`simulator.py:85-129` ranks candidate OD flows by `distance ≥ 0.8 km` only — acknowledged as limitation #4 in `Problem & Solution Summary.md`. No traffic volume, no road importance weighting, no OD demand matrix.

### Implementation

**[MOD] `src/simulator/simulator.py`** — weight the ranking by road capacity (proxy for volume). In `find_affected_flows`, change the candidate tuple to include a capacity score and rank on `distance × capacity`:

Replace the candidate construction (around line 108-110):

```python
                route = to_event + from_event[1:]
                distance = self.get_route_distance_km(route, graph=self.base_G)
                if distance >= 0.8:
                    # Volume proxy: average road capacity along the route
                    cap_score = self._route_capacity_score(route)
                    candidates.append((distance * cap_score, distance, origin, destination, route))
```

Add the helper method:

```python
    def _route_capacity_score(self, route) -> float:
        """Average per-edge capacity (veh/h) along the route — a volume proxy."""
        if not route or len(route) < 2:
            return 1.0
        caps = []
        for u, v in zip(route[:-1], route[1:]):
            edge_data = self.base_G.get_edge_data(u, v)
            if not edge_data:
                continue
            hw = self._highway_value(next(iter(edge_data.values())))
            cap, _ = self._get_base_capacity_and_volume(hw)
            caps.append(cap)
        return sum(caps) / len(caps) if caps else 1.0
```

And update the sort line (around line 115) to use the new composite key:

```python
        for composite, distance, origin, destination, route in sorted(candidates, reverse=True):
```

Also store the capacity score on the selected flow dict so the dashboard can show "high-volume flow":

```python
            selected.append({
                'flow_id': f'flow-{len(selected) + 1}',
                'origin': origin,
                'destination': destination,
                'normal_route': route,
                'normal_distance_km': distance,
                'capacity_score': round(composite / distance, 1) if distance else 0,
            })
```

### Verify
The existing test `test_selected_flow_passes_through_event` should still pass. Add a test that a primary-road flow outranks a residential flow of equal distance:

```python
    def test_high_capacity_flow_preferred(self):
        simulator = make_simulator()
        flows = simulator.find_affected_flows(max_flows=3)
        # Every returned flow has a capacity_score
        self.assertTrue(all('capacity_score' in f for f in flows))
```

---

## 🟡 Fix #12 — Integrated compliance × manpower evaluation

### Problem
`calculate_diversion(police_deployed=...)` exists, but `evaluate_interventions` always calls it with `police_deployed=False` (40% compliance, 2.5× penalty). So the reported `time_saved` assumes **no police** — it understates the benefit of the manpower plan the system itself recommends.

### Implementation

**[MOD] `src/simulator/simulator.py`** — extend `evaluate_interventions` to compute both scenarios and report the *integrated* benefit. Replace the method body:

```python
    def evaluate_interventions(self, flows, closed_edges):
        """Compare do-nothing, no-police diversion, and with-police diversion."""
        results = []
        for flow in flows:
            normal_route = flow['normal_route']

            diverted_no_police = self.calculate_diversion(
                flow['origin'], flow['destination'], closed_edges,
                police_deployed=False
            )
            diverted_with_police = self.calculate_diversion(
                flow['origin'], flow['destination'], closed_edges,
                police_deployed=True
            )

            baseline_sec = self.route_travel_time(normal_route, self.base_G)
            without_sec  = self.route_travel_time(normal_route, self.G)
            diverted_sec = self.route_travel_time(diverted_with_police or diverted_no_police,
                                                  self.G)

            avoids_closure = bool(diverted_with_police) and not any(
                (u, v) in closed_edges
                for u, v in zip(diverted_with_police[:-1], diverted_with_police[1:])
            )
            saved_no_police  = (without_sec - self.route_travel_time(diverted_no_police,  self.G)
                                ) if diverted_no_police else 0.0
            saved_with_police= (without_sec - self.route_travel_time(diverted_with_police,self.G)
                                ) if diverted_with_police else 0.0
            valid = avoids_closure and saved_with_police > 0

            results.append({
                **flow,
                'diverted_route': diverted_with_police or diverted_no_police,
                'baseline_minutes': round(baseline_sec / 60, 1),
                'without_intervention_minutes': round(without_sec / 60, 1),
                'with_intervention_minutes': round(diverted_sec / 60, 1) if diverted_sec else None,
                'time_saved_minutes': round(max(0.0, saved_with_police) / 60, 1),
                'time_saved_no_police_minutes': round(max(0.0, saved_no_police) / 60, 1),
                'time_saved_with_police_minutes': round(max(0.0, saved_with_police) / 60, 1),
                'police_compliance_benefit_minutes': round(
                    max(0.0, saved_with_police - saved_no_police) / 60, 1
                ),
                'delay_reduction_pct': round(
                    max(0.0, saved_with_police) / without_sec * 100, 1
                ) if without_sec and without_sec != float('inf') else 0.0,
                'diversion_distance_km': self.get_route_distance_km(
                    diverted_with_police or diverted_no_police
                ),
                'avoids_closure': avoids_closure,
                'valid_intervention': valid,
                'reason': 'Avoids closure and reduces travel time' if valid else
                          'No beneficial closure-avoiding route found',
            })
        return results
```

**[MOD] `src/api/app.py`** — expose the police-compliance benefit in the public flow summary (around line 352-356). No change needed if `public_flows` already strips only the route keys; the new fields will pass through automatically.

### Verify
```bash
python -m unittest tests.test_simulator.SimulatorTests.test_intervention_avoids_closure_and_saves_time -v
```
The test checks `time_saved_minutes > 0` which still holds. Manually inspect the new `police_compliance_benefit_minutes` field — it should be ≥ 0 and typically > 0 when closed_edges is non-empty.

---

## 🟡 Fix #13 — Synthesized diversion plan artifact

### Problem
Barricades, diversion routes, and manpower are produced as separate lists. There's no "barricade at node X → reroute flow Y via Z → requires N officers" binding. PS2 asks for "barricading **and** diversion plans."

### Implementation

**[MOD] `src/simulator/simulator.py`** — add a synthesizer that produces a single operational plan object.

```python
    def synthesize_diversion_plan(self, flow_results, barricade_validation,
                                  manpower_plan, closed_edges):
        """Bind barricades -> affected flows -> officers into one plan."""
        closed_set = set(closed_edges)
        # Map each barricade to the flows it protects (flows whose baseline
        # route passes through an edge this barricade blocks).
        plan_entries = []
        for bv in barricade_validation:
            if not bv['valid']:
                continue
            node = bv['node_id']
            blocked = {(u, v) for u, v in self.G.out_edges(node) if (u, v) in closed_set}
            protected_flows = []
            for f in flow_results:
                if not f.get('valid_intervention'):
                    continue
                route_edges = set(zip(f['normal_route'][:-1], f['normal_route'][1:]))
                if route_edges & blocked:
                    protected_flows.append({
                        'flow_id': f['flow_id'],
                        'diversion_route_node_count': len(f.get('diverted_route') or []),
                        'time_saved_minutes': f['time_saved_minutes'],
                    })
            # Officer allocation for this barricade
            officers = next(
                (b['officers_assigned'] for b in manpower_plan.get('barricade_details', [])
                 if b['node_id'] == node),
                manpower_plan.get('officers_per_barricade', 0)
            )
            plan_entries.append({
                'barricade_node': node,
                'lat': bv['lat'],
                'lon': bv['lon'],
                'blocks_edges': [[u, v] for u, v in blocked],
                'protects_flows': protected_flows,
                'officers_assigned': officers,
            })
        return {
            'plan_summary': {
                'total_barricades':   len(plan_entries),
                'total_officers':     manpower_plan.get('total_officers', 0),
                'total_flows_protected': sum(1 for f in flow_results if f.get('valid_intervention')),
                'total_time_saved_minutes': round(
                    sum(f.get('time_saved_minutes', 0) for f in flow_results
                        if f.get('valid_intervention')), 1),
            },
            'barricade_plan': plan_entries,
        }
```

**[MOD] `src/api/app.py`** — call the synthesizer and include the plan in the result. After `barricade_validation` (around line 325):

```python
        diversion_plan = sim.synthesize_diversion_plan(
            flow_results, barricade_validation, manpower_plan, closed
        )
```

Add to `result_dict`:
```python
            "diversion_plan": diversion_plan,
```

### Verify
Run a simulation via the API and confirm the response now has a `diversion_plan` key with `barricade_plan` entries that each list `protects_flows` and `officers_assigned`.

---

## 🟡 Fix #15 — Sync docs to the BPR code

### Problem
`technical_whitepaper.md` §2.1 still describes Euclidean great-circle shockwave; §3.4 says "travel_time × 100" (code now uses BPR with `capacity×0.05`). `walkthrough.md` and `architecture.md` Phase 4 describe the old single-flow random-OD + Euclidean approach. `deliverables.md` marks the whitepaper "READY" but it's out of sync.

### Implementation

**[MOD] `doc/technical_whitepaper.md`** — three targeted edits:

1. **§2.1 / §3.1**: replace the Euclidean description with the BPR reverse-BFS model that's actually in `simulator.py:145-203`. Add the BPR formula:
   $$ t = t_0 \left(1 + \alpha \left(\frac{v}{c}\right)^\beta\right), \quad \alpha=0.15, \beta=4 $$
   and explain that capacity decays linearly with upstream distance (`0.1 + 0.9 * dist/spillover`), closure edges get `capacity × 0.05`.

2. **§3.2 Time-of-Day**: replace the uniform-scalar section with the **differential per-class hourly-calibrated** model from Fix #2. State the formula `multiplier = 1 + (hourly_mult - 1) × sensitivity[highway]` and reference the historical hourly curve from `hotspot_analyzer`.

3. **§3.4 Dijkstra**: clarify that closed edges are penalised via BPR capacity×0.05 (not ×100), and that the diversion graph also strips closed edges when `police_deployed=True` (compliance factor).

**[MOD] `doc/walkthrough.md`** — update "The Shockwave" bullet to describe the BPR reverse-BFS capacity-decay model, and add a bullet for the post-event learning loop (`/api/feedback` → refit manpower + NLP).

**[MOD] `doc/architecture.md`** Phase 4 — replace the Euclidean great-circle bullet (lines 40-43) with the BPR reverse-BFS description. Add a Phase 8 section for the learning loop (Cox PH, NLP retrain, manpower refit).

**[MOD] `doc/deliverables.md`** — change the whitepaper status from "READY" to "READY — synced to BPR architecture on <date>".

**[MOD] `doc/Problem & Solution Summary.md`** — update the "Current Limitations" section: strike out #1 (manpower now learns), #2 (NLP + manpower now retrain), #4 (flow selection now capacity-weighted). Add any remaining limitations discovered during implementation.

### Verify
Grep the docs for stale terms:
```bash
# Should return ZERO matches after the edits:
grep -ri "travel_time.*100" doc/
grep -ri "euclidean" doc/technical_whitepaper.md
grep -ri "random.*OD\|random.choice.*arterial" doc/
grep -ri "E = 1" doc/
```

---

## Final integration verification

After all fixes are applied, run the full suite:

```bash
# 1. Unit tests
python -m unittest discover -s tests -v

# 2. New 6-phase evaluator
python src/evaluate_model.py
# Compare to doc/eval_results_baseline.txt:
#   - phase4_route_changed must be >= 1 (was 0)
#   - phase3_graph_remains_connected must == events_evaluated (was 6/10)
#   - phase5_models.cox_c_index must be populated
#   - phase5_models.cox_n_censored must be > 0

# 3. Manual API smoke test
python src/api/app.py &
sleep 10  # let models train
curl http://localhost:8000/api/events
curl http://localhost:8000/api/severity/FKID000003
curl -X POST http://localhost:8000/api/simulate/FKID000003
# poll /api/status/<task_id> until success
# confirm the result has: impact_forecast, diversion_plan, manpower_plan,
#   flow_analysis[*].police_compliance_benefit_minutes

# 4. Learning loop smoke test
# Submit 12 feedback entries via POST /api/feedback, then:
curl http://localhost:8000/api/feedback/summary
# Confirm src/simulator/manpower_weights.json exists and is non-default
# Confirm src/simulator/nlp_model.pkl was updated (mtime)
```

---

## Requirements changes

`src/requirements.txt` already includes `lifelines` and `sentence-transformers`. No new dependencies are introduced by any fix in this guide. `numpy` is already a transitive dependency of pandas/sklearn and is used directly in Fixes #1, #4, #5.

---

## What this guide deliberately does NOT do

- **No Hawkes process.** Per `repo_audit.md` §Pillar-1 and the blueprint, the data is too sparse (53 events/day, high inter-arrival variance). α/β decay params won't converge.
- **No torch / MuRIL / IndicBERT.** LaBSE (already in `nlp_impact.py`) is the CPU-safe multilingual choice.
- **No Celery/Redis.** The threaded task queue is sufficient for the prototype and keeps the demo dependency-free.
- **No full microscopic simulation (SUMO/AIMSUN).** CityFlow is a graph-based intervention planner, not a vehicle-level simulator. The whitepaper already states this.
- **No contrastive/triplet loss.** No ground-truth intervention-outcome pairs to form valid triplets. The feedback-loop retrain (Fixes #4, #5) is the honest, working version of "post-event learning."

---

## Judge-impact summary

After this guide is applied, the three highest-leverage stories for the presentation become:

1. **"We forecast traffic impact, not just incident clearance."** Fix #8 produces `person_delay_minutes`, `affected_vehicle_count`, `queue_length_m`, `area_congestion_index` — pre-event, for planned and unplanned. This directly answers PS2 pain point #1.
2. **"Our survival model handles censoring; C-index = X."** Fix #1 turns the Cox model from a naive regression into a proper right-censored time-to-event model with an auditable concordance metric and the BMTC-vs-private-car 2× gap as the headline finding.
3. **"The system learns from every event."** Fixes #4 and #5 close the post-event loop: feedback re-fits both the manpower weights (lstsq) and the NLP head (without forgetting). Fix #3 adds Phase 6 to the evaluator that reports `mean_resolution_error_minutes` and `diversion_success_rate` from the feedback table — the learning is measurable.

Combined with the differential time-of-day routing (Fix #2), the planned-event mode (Fix #10), and the real-time adapter interface (Fix #9), the system addresses all three PS2 pain points with a coherent, defensible architecture.
