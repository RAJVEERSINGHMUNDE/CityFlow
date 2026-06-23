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
        """Produce a pre-event traffic-impact forecast.

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
        return 600.0 * dist_km

    @staticmethod
    def _estimate_vehicles_from_attendance(attendance: int, duration_h: float) -> float:
        """For planned events: ~1 vehicle per 3 attendees, arriving over the window."""
        if attendance <= 0:
            return 0.0
        vehicles = attendance / 3.0
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
