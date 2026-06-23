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
from datetime import datetime
import pandas as pd


class RealtimeFeed:
    """Base interface. Subclasses override the two getters."""

    def get_active_incidents(self, as_of: datetime) -> list[dict]:
        raise NotImplementedError

    def get_live_speeds(self, bbox: tuple) -> dict:
        """bbox = (min_lat, min_lon, max_lat, max_lon). Returns {edge_key: kmh}."""
        raise NotImplementedError


class HistoricalReplayFeed(RealtimeFeed):
    """Replays the event dataset as a live stream. Returns events active at as_of timestamp."""

    def __init__(self, df: pd.DataFrame):
        self._df = df.copy()
        self._df['start_dt'] = pd.to_datetime(df['start_datetime'], utc=True, errors='coerce')
        self._df['closed_dt'] = pd.to_datetime(df.get('closed_datetime'), utc=True, errors='coerce')

    def get_active_incidents(self, as_of: datetime) -> list[dict]:
        as_of_ts = pd.Timestamp(as_of)
        if as_of_ts.tzinfo is None:
            as_of_ts = as_of_ts.tz_localize('UTC')
        active = self._df[(self._df['start_dt'] <= as_of_ts) &
                          (self._df['closed_dt'].isna() | (self._df['closed_dt'] >= as_of_ts))]
        return [
            {
                'id': str(row['id']),
                'cause': str(row.get('event_cause', 'unknown')),
                'latitude': float(row['latitude']),
                'longitude': float(row['longitude']),
                'started_at': str(row['start_dt']),
                'requires_closure': bool(row.get('requires_road_closure', False)),
                'veh_type': str(row.get('veh_type', '')),
                'corridor': str(row.get('corridor', 'Non-corridor')),
            }
            for _, row in active.iterrows()
        ]

    def get_live_speeds(self, bbox: tuple) -> dict:
        """No live speeds in replay mode; simulator falls back to BPR + time-of-day."""
        return {}


# Factory
_active_feed: RealtimeFeed | None = None


def init_feed(df: pd.DataFrame, feed_class: type | None = None) -> RealtimeFeed:
    global _active_feed
    cls = feed_class or HistoricalReplayFeed
    _active_feed = cls(df)
    return _active_feed


def get_feed() -> RealtimeFeed | None:
    return _active_feed
