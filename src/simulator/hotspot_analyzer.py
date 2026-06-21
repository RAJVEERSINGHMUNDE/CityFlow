"""
hotspot_analyzer.py
────────────────────
Historical traffic event intelligence for CityFlow Digital Twin.

Mines 8,173+ historical Bengaluru traffic events to provide:
  - Incident heatmap (Folium HeatMap layer)
  - Junction risk ranking (top 20 named Bengaluru hotspots)
  - Nearby historical context (how many similar events near this location)
  - Temporal patterns (hour-of-day, day-of-week distributions)

This module directly addresses the "post-event learning system" gap
identified in Problem Statement 2 — turning raw data into institutional memory.
"""

from __future__ import annotations
import pandas as pd
import numpy as np
import folium
from folium.plugins import HeatMap
import os


class HotspotAnalyzer:
    """
    Pre-computes all historical hotspot statistics at startup.
    All query methods run in O(n) or faster — no blocking on API calls.
    """

    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()
        self._precompute()

    def _precompute(self):
        """Build all cached aggregations at startup."""
        df = self.df

        df['start_dt'] = pd.to_datetime(df['start_datetime'], errors='coerce')
        df['hour']     = df['start_dt'].dt.hour
        df['dow']      = df['start_dt'].dt.day_name()

        # Junction rankings
        self._junction_counts = df['junction'].value_counts()
        self._max_junction    = int(self._junction_counts.iloc[0]) if len(self._junction_counts) else 1

        # Zone rankings
        self._zone_counts = df['zone'].value_counts().to_dict()

        # Cause-level statistics
        self._cause_stats = (
            df.groupby('event_cause')
            .agg(
                count=('id', 'count'),
                closure_rate=('requires_road_closure', 'mean'),
                high_priority_rate=('priority', lambda x: (x == 'High').mean()),
            )
            .round(3)
        )

        # Hourly distribution (for chart data)
        self._hourly = df.groupby('hour').size().reindex(range(24), fill_value=0).to_dict()

        # Day-of-week distribution
        _dow_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        self._dow = {d: int(df[df['dow'] == d].shape[0]) for d in _dow_order}

        print(f"[HotspotAnalyzer] Pre-computed stats for {len(df):,} events.")
        print(f"[HotspotAnalyzer] Top 5 hotspot junctions:")
        for junc, cnt in self._junction_counts.head(5).items():
            print(f"  {junc}: {cnt} events")

    # ── Public query methods ───────────────────────────────────────────────────

    def get_nearby_events(
        self,
        lat:       float,
        lon:       float,
        radius_km: float = 2.0,
    ) -> dict:
        """
        Count and categorise historical events within `radius_km` of (lat, lon).
        Uses vectorised Haversine for speed.
        """
        df = self.df.dropna(subset=['latitude', 'longitude'])

        # Vectorised Haversine
        R     = 6_371.0
        dlat  = np.radians(df['latitude'].values  - lat)
        dlon  = np.radians(df['longitude'].values - lon)
        a     = (np.sin(dlat / 2) ** 2
                 + np.cos(np.radians(lat))
                 * np.cos(np.radians(df['latitude'].values))
                 * np.sin(dlon / 2) ** 2)
        dists = 2 * R * np.arcsin(np.sqrt(a))

        nearby = df[dists <= radius_km]

        return {
            'total_nearby':       int(len(nearby)),
            'radius_km':          radius_km,
            'closure_requiring':  int(nearby['requires_road_closure'].sum()),
            'high_priority':      int((nearby.get('priority', pd.Series()) == 'High').sum()),
            'cause_breakdown':    nearby['event_cause'].value_counts().head(5).to_dict(),
        }

    def get_hotspot_summary(self, top_n: int = 20) -> list[dict]:
        """
        Returns the top-N highest-risk junctions with representative coordinates
        and a risk level derived from incident frequency.
        """
        df_junc = self.df[self.df['junction'].notna()].copy()
        hotspots = []

        for junction, count in self._junction_counts.head(top_n).items():
            events_at = df_junc[df_junc['junction'] == junction]
            if events_at.empty:
                continue

            lat = float(events_at['latitude'].median())
            lon = float(events_at['longitude'].median())

            # Risk level thresholds (calibrated on dataset distribution)
            if count >= 40:
                risk = 'Red'
            elif count >= 20:
                risk = 'Amber'
            else:
                risk = 'Green'

            hotspots.append({
                'junction':    str(junction),
                'count':       int(count),
                'lat':         round(lat, 5),
                'lon':         round(lon, 5),
                'risk_level':  risk,
                'pct_closure': round(
                    float(events_at['requires_road_closure'].mean()) * 100, 1
                ),
            })

        return hotspots

    def get_temporal_patterns(self) -> dict:
        """Hourly and day-of-week event distributions for chart rendering."""
        return {
            'hourly': self._hourly,
            'dow':    self._dow,
        }

    def get_summary_stats(self) -> dict:
        """High-level summary statistics for the dashboard header."""
        df = self.df
        return {
            'total_events':    int(len(df)),
            'unplanned_count': int((df['event_type'] == 'unplanned').sum()),
            'planned_count':   int((df['event_type'] == 'planned').sum()),
            'closure_events':  int(df['requires_road_closure'].sum()),
            'active_events':   int((df['status'] == 'active').sum()),
            'zones_covered':   int(df['zone'].nunique()),
            'top_junction':    str(self._junction_counts.index[0]) if len(self._junction_counts) else 'N/A',
            'top_junction_count': int(self._junction_counts.iloc[0]) if len(self._junction_counts) else 0,
        }

    def generate_heatmap(self, output_path: str) -> str:
        """
        Generate and save a Folium HeatMap of all historical events.
        Top-20 hotspot junctions are annotated with circle markers.
        """
        df_valid = self.df.dropna(subset=['latitude', 'longitude'])

        m = folium.Map(
            location=[12.97, 77.59],
            zoom_start=11,
            tiles='CartoDB dark_matter',
        )

        # ── Heatmap layer ─────────────────────────────────────────────────────
        heat_data = df_valid[['latitude', 'longitude']].values.tolist()
        HeatMap(
            heat_data,
            radius=12,
            blur=15,
            max_zoom=13,
            gradient={0.2: 'blue', 0.5: 'lime', 0.8: 'orange', 1.0: 'red'},
        ).add_to(m)

        # ── Hotspot junction markers ───────────────────────────────────────────
        _colors = {'Red': 'red', 'Amber': 'orange', 'Green': 'green'}
        for hs in self.get_hotspot_summary(top_n=20):
            folium.CircleMarker(
                location=[hs['lat'], hs['lon']],
                radius=6 + (hs['count'] / self._max_junction) * 10,
                color=_colors.get(hs['risk_level'], 'orange'),
                fill=True,
                fill_opacity=0.8,
                popup=folium.Popup(
                    f"<b>{hs['junction']}</b><br>"
                    f"{hs['count']} incidents<br>"
                    f"Closure rate: {hs['pct_closure']}%",
                    max_width=200,
                ),
                tooltip=f"{hs['junction']} — {hs['count']} events",
            ).add_to(m)

        # ── Legend ─────────────────────────────────────────────────────────────
        legend_html = """
        <div style="position:fixed;bottom:30px;left:30px;z-index:1000;
                    background:rgba(15,23,42,0.85);border:1px solid #334155;
                    border-radius:8px;padding:12px;color:#94a3b8;font-size:12px;font-family:monospace;">
          <b style="color:#e2e8f0;">CityFlow Hotspot Map</b><br>
          <span style="color:#ef4444;">●</span> High Risk (&ge;40 events)<br>
          <span style="color:#f59e0b;">●</span> Medium Risk (&ge;20 events)<br>
          <span style="color:#22c55e;">●</span> Low Risk (&lt;20 events)<br>
          <br><span style="color:#64748b;">Heatmap: all 8,173 events</span>
        </div>
        """
        m.get_root().html.add_child(folium.Element(legend_html))

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        m.save(output_path)
        print(f"[HotspotAnalyzer] Heatmap saved -> {output_path}")
        return output_path


# ── Singleton ─────────────────────────────────────────────────────────────────

_analyzer: HotspotAnalyzer | None = None


def get_analyzer() -> HotspotAnalyzer | None:
    return _analyzer


def init_analyzer(df: pd.DataFrame) -> HotspotAnalyzer:
    global _analyzer
    _analyzer = HotspotAnalyzer(df)
    return _analyzer
