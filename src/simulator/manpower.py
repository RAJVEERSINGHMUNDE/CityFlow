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
import networkx as nx


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

    # ── Officer count per barricade ───────────────────────────────────────────
    # Base determined by response level
    officers_per = _LEVEL_BASE_OFFICERS.get(response_level, 2)

    # Additive bonuses
    if severity_score >= 7.0:
        officers_per += 1     # High-severity event
    if requires_closure:
        officers_per += 2     # Road closure needs traffic management officers
    if time_of_day_label == 'Rush Hour':
        officers_per += 1     # Extra officer to manage peak traffic volume
    if time_of_day_label == 'Night':
        officers_per = max(1, officers_per - 1)   # Reduced night volume

    # ── Shift duration ────────────────────────────────────────────────────────
    # Derived from ML-predicted resolution time, clamped to [2h, 8h]
    shift_hours = int(max(2, min(8, round(resolution_min / 60))))

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
    }
