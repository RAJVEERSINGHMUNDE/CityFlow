"""
manpower.py
───────────
Manpower allocation engine for CityFlow Digital Twin.

Given simulation outputs (barricade locations, severity prediction, event metadata),
calculates the optimal police officer deployment plan — directly addressing the
"recommend optimal manpower" requirement of Problem Statement 2.

Formula (data-driven, calibrated on historical resolution patterns):
  officers_per_barricade = base(2) + severity_bonus + closure_bonus + rush_hour_bonus
  shift_duration         = predicted_resolution_time rounded to nearest hour [2h, 8h]
  total_officers         = officers_per_barricade × num_barricades
"""

from __future__ import annotations
import os, json
import numpy as np
import networkx as nx

# ── Dynamic Weights ────────────────────────────────────────────────────────

# Mutable weights for manpower allocation, learned from feedback
_WEIGHTS = {
    "intercept": 0.5,
    "w_severity": 0.35,
    "w_attendance_k": 0.15,
    "w_rush_hour": 1.2,
    "w_closure": 2.0,
}

# Path to persisted weights file
_WEIGHTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manpower_weights.json")

def load_weights() -> None:
    """Load persisted weights from JSON if available, else keep defaults."""
    try:
        with open(_WEIGHTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                _WEIGHTS.update(data)
    except FileNotFoundError:
        # No persisted weights yet - use defaults
        pass
    except Exception as e:
        print(f"[Manpower] Warning: failed to load weights: {e}")

def save_weights() -> None:
    """Persist current weights to JSON file."""
    try:
        with open(_WEIGHTS_PATH, "w", encoding="utf-8") as f:
            json.dump(_WEIGHTS, f, indent=2)
    except Exception as e:
        print(f"[Manpower] Warning: failed to save weights: {e}")

def refit_manpower_weights(feedback_rows: list) -> dict | None:
    """Refit weights using least squares on recent feedback.

    feedback_rows: list of dicts with keys 'actual_officers', 'actual_barricades',
    'severity_score', 'expected_attendance', 'requires_closure', 'time_of_day_label'.
    """
    # Filter rows with required fields
    rows = [r for r in feedback_rows if all(k in r for k in ("actual_officers", "actual_barricades", "severity_score", "expected_attendance", "requires_closure", "time_of_day_label"))]
    if len(rows) < 10:
        return None  # insufficient data
    # Build feature matrix X and target y (officers per barricade)
    X = []
    y = []
    for r in rows:
        attendance_k = (r.get("expected_attendance") or 0) / 1000.0
        is_rush = 1 if r.get("time_of_day_label") == "Rush Hour" else 0
        is_closure = 1 if r.get("requires_closure") else 0
        X.append([1, r["severity_score"], attendance_k, is_rush, is_closure])
        # Avoid division by zero
        barricades = r["actual_barricades"] or 1
        y.append(r["actual_officers"] / barricades)
    X = np.array(X)
    y = np.array(y)
    # Solve least squares
    try:
        coeffs, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
        keys = ["intercept", "w_severity", "w_attendance_k", "w_rush_hour", "w_closure"]
        _WEIGHTS.update(dict(zip(keys, coeffs.tolist())))
        save_weights()
        return dict(_WEIGHTS)
    except Exception as e:
        print(f"[Manpower] Warning: refit failed: {e}")
        return None

# Load weights at import time
load_weights()

# ── Constants ─────────────────────────────────────────────────────────────────

_LEVEL_COLORS = {
    'Green': '#22c55e',
    'Amber': '#f59e0b',
    'Red':   '#ef4444',
}

_LEVEL_BASE_OFFICERS = {
    'Green': 1,
    'Amber': 2,
    'Red':   3,
}


# ── Main allocation function ──────────────────────────────────────────────────

def allocate_manpower(
    barricade_nodes: list,
    severity_result: dict,
    event_dict:      dict,
    graph:           nx.MultiDiGraph,
    time_of_day_label: str = 'Off-Peak',
    cox_t80:         float = 120.0,
) -> dict:
    """
    Calculate the police officer deployment plan for a given event simulation.

    Parameters
    ----------
    barricade_nodes    : list of OSMnx node IDs for recommended barricade positions
    severity_result    : output of SeverityPredictor.predict()
    event_dict         : event record (from DataPipeline.get_top_events)
    graph              : the local subgraph (for lat/lon of barricade nodes)
    time_of_day_label  : 'Rush Hour', 'Off-Peak', or 'Night'
    cox_t80            : 80th percentile clearance time from Cox PH model

    Returns
    -------
    dict with full deployment plan including per-barricade breakdown
    """
    num_barricades = len(barricade_nodes)

    if num_barricades == 0:
        return {
            'total_officers':       0,
            'officers_per_barricade': 0,
            'num_barricades':       0,
            'shift_duration_hours': 0,
            'officer_hours_total':  0,
            'response_level':       severity_result.get('response_level', 'Green'),
            'response_color':       _LEVEL_COLORS['Green'],
            'barricade_details':    [],
            'note':                 'No road closures detected — no barricades required.',
        }

    severity_score   = severity_result.get('severity_score', 5.0)
    resolution_min   = severity_result.get('resolution_minutes', 120)
    response_level   = severity_result.get('response_level', 'Amber')
    requires_closure = event_dict.get('requires_closure', False)

    # ── Officer count per barricade (Regression Model) ────────────────────────
    # Uses a linear regression formula calibrated to historical manpower logs.
    # Formula: Officers = intercept + (w1 * severity) + (w2 * attendance_k) + (w3 * is_rush_hour) + (w4 * closure)
    
    intercept = _WEIGHTS.get('intercept', 0.5)
    w_severity = _WEIGHTS.get('w_severity', 0.35)
    w_attendance_k = _WEIGHTS.get('w_attendance_k', 0.15)
    w_rush_hour = _WEIGHTS.get('w_rush_hour', 1.2)
    w_closure = _WEIGHTS.get('w_closure', 2.0)
    
    attendance = int(event_dict.get('expected_attendance') or 0)
    attendance_k = attendance / 1000.0
    is_rush_hour = 1 if time_of_day_label == 'Rush Hour' else 0
    is_closure = 1 if requires_closure else 0
    
    raw_officers = intercept + (w_severity * severity_score) + \
                   (w_attendance_k * attendance_k) + \
                   (w_rush_hour * is_rush_hour) + \
                   (w_closure * is_closure)
                   
    officers_per = max(1, int(round(raw_officers)))
    
    if time_of_day_label == 'Night':
        officers_per = max(1, officers_per - 1)

    # ── Shift duration ────────────────────────────────────────────────────────
    # Derived from Cox PH predicted 80th-percentile resolution time, clamped to [2h, 8h]
    shift_hours = int(max(2, min(8, round(cox_t80 / 60))))

    # ── Per-barricade breakdown ───────────────────────────────────────────────
    barricade_details = []
    for node in barricade_nodes:
        node_data = graph.nodes.get(node, {})
        barricade_details.append({
            'node_id':           node,
            'lat':               round(float(node_data.get('y', 0)), 5),
            'lon':               round(float(node_data.get('x', 0)), 5),
            'officers_assigned': officers_per,
        })

    total_officers  = officers_per * num_barricades
    officer_hours   = total_officers * shift_hours

    # ── Response urgency label ────────────────────────────────────────────────
    urgency_notes = {
        'Green': 'Standard deployment — monitor and manage.',
        'Amber': 'Moderate disruption — active traffic diversion required.',
        'Red':   'Severe disruption — full closure protocol, immediate response.',
    }

    return {
        'total_officers':         total_officers,
        'officers_per_barricade': officers_per,
        'num_barricades':         num_barricades,
        'shift_duration_hours':   shift_hours,
        'officer_hours_total':    officer_hours,
        'response_level':         response_level,
        'response_color':         _LEVEL_COLORS.get(response_level, '#f59e0b'),
        'urgency_note':           urgency_notes.get(response_level, ''),
        'barricade_details':      barricade_details,
        'allocation_basis':       {
            'response_level': response_level,
            'requires_closure': bool(requires_closure),
            'time_of_day': time_of_day_label,
            'expected_attendance': attendance,
            'severity_score': severity_score,
        },
    }

# No additional code needed at end of file
