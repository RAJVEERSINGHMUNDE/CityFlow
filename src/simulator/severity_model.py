"""
severity_model.py
─────────────────
ML-powered event severity predictor for CityFlow Digital Twin.

Two models trained on the historical Bengaluru event dataset:
  1. GradientBoostingRegressor  → predicts resolution time in minutes (R² reported)
  2. RandomForestClassifier     → predicts response level (Green / Amber / Red)

Features used:
  - event_cause (label-encoded)
  - event_type, requires_road_closure, priority (binary)
  - hour_of_day (cyclical sin/cos encoding)
  - day_of_week (0–6)
  - zone (label-encoded)
  - spatial_cluster (KMeans, 10 clusters on lat/lon)
  - junction_hotspot_score (normalised incident frequency at junction)
"""

import pandas as pd
import numpy as np
import warnings
import threading

warnings.filterwarnings('ignore')

# ── Fallback rule table (used when model not yet trained) ─────────────────────
_CAUSE_BASE_SCORE = {
    'accident': 8, 'construction': 6, 'tree_fall': 7, 'public_event': 7,
    'procession': 6, 'protest': 5, 'vip_movement': 5, 'vehicle_breakdown': 4,
    'water_logging': 5, 'congestion': 5, 'road_conditions': 4,
    'pot_holes': 3, 'others': 4, 'debris': 6,
}

# ── Threading control ─────────────────────────────────────────────────────────
model_ready_event = threading.Event()


class SeverityPredictor:
    """
    Trains on historical event data and predicts severity for incoming events.
    Exposes a single `predict(event_dict)` method after `train(df)` is called.
    """

    def __init__(self):
        self.regressor  = None   # GBM → log(resolution_minutes)
        self.classifier = None   # RF  → Green / Amber / Red
        self.label_encoders: dict = {}
        self.spatial_cluster     = None
        self.junction_hotspots: dict = {}
        self.is_trained          = False
        self.r2_score            = None
        self.clf_accuracy        = None
        self.feature_importances_: pd.DataFrame | None = None

    # ── Training ──────────────────────────────────────────────────────────────

    def train(self, df: pd.DataFrame):
        from sklearn.ensemble import GradientBoostingRegressor, RandomForestClassifier
        from sklearn.preprocessing import LabelEncoder
        from sklearn.model_selection import cross_val_score
        from sklearn.cluster import KMeans

        print("[SeverityModel] Starting ML training pipeline...")
        df = df.copy()

        # ── 1. Target: resolution time ────────────────────────────────────────
        df['start_dt']  = pd.to_datetime(df['start_datetime'],  errors='coerce')
        df['closed_dt'] = pd.to_datetime(df['closed_datetime'], errors='coerce')
        df['resolution_min'] = (
            (df['closed_dt'] - df['start_dt']).dt.total_seconds() / 60
        )
        # Keep realistic resolution windows: 2 min → 30 days
        df = df.dropna(subset=['resolution_min', 'latitude', 'longitude'])
        df = df[(df['resolution_min'] >= 2) & (df['resolution_min'] <= 43_200)]

        # ── 2. Temporal features ──────────────────────────────────────────────
        df['hour']    = df['start_dt'].dt.hour.fillna(12)
        df['dow_num'] = df['start_dt'].dt.dayofweek.fillna(0)

        # ── 3. Categorical feature: event_cause ───────────────────────────────
        df['event_cause'] = (
            df['event_cause'].fillna('others').str.lower().str.strip()
        )
        le_cause = LabelEncoder()
        le_cause.fit(df['event_cause'])
        self.label_encoders['event_cause'] = le_cause

        # ── 4. Categorical feature: zone ─────────────────────────────────────
        df['zone'] = df['zone'].fillna('Unknown')
        le_zone = LabelEncoder()
        le_zone.fit(df['zone'])
        self.label_encoders['zone'] = le_zone

        # ── 5. Junction hotspot scoring ───────────────────────────────────────
        self.junction_hotspots = df['junction'].value_counts().to_dict()
        max_junction_count     = max(self.junction_hotspots.values(), default=1)

        # ── 6. Spatial clustering (10 city zones) ─────────────────────────────
        self.spatial_cluster = KMeans(n_clusters=10, random_state=42, n_init=10)
        self.spatial_cluster.fit(df[['latitude', 'longitude']])

        # ── 7. Build feature matrix ───────────────────────────────────────────
        X = self._build_features(df, max_junction_count)
        y_reg = np.log1p(df['resolution_min'])   # log-space regression

        # Severity levels: ≤60 min → Green, ≤480 min → Amber, else → Red
        def _label(m):
            return 0 if m <= 60 else (1 if m <= 480 else 2)
        y_clf = df['resolution_min'].apply(_label)

        # ── 8. Train GBM Regressor ────────────────────────────────────────────
        self.regressor = GradientBoostingRegressor(
            n_estimators=300, max_depth=4, learning_rate=0.05,
            subsample=0.8, min_samples_leaf=5, random_state=42,
        )
        self.regressor.fit(X, y_reg)
        cv_r2 = cross_val_score(self.regressor, X, y_reg, cv=5, scoring='r2')
        self.r2_score = float(cv_r2.mean())

        # ── 9. Train RF Classifier ────────────────────────────────────────────
        self.classifier = RandomForestClassifier(
            n_estimators=150, max_depth=8, random_state=42, n_jobs=-1,
        )
        self.classifier.fit(X, y_clf)
        cv_acc = cross_val_score(self.classifier, X, y_clf, cv=5, scoring='accuracy')
        self.clf_accuracy = float(cv_acc.mean())

        # ── 10. Feature importances (for report) ─────────────────────────────
        self.feature_importances_ = pd.DataFrame({
            'feature':    X.columns.tolist(),
            'importance': self.regressor.feature_importances_,
        }).sort_values('importance', ascending=False)

        self.is_trained = True
        n = len(df)
        print(f"[SeverityModel] DONE - Trained on {n:,} events.")
        print(f"[SeverityModel]    GBM R2 (5-fold CV) = {self.r2_score:.3f}")
        print(f"[SeverityModel]    RF  Acc (5-fold CV) = {self.clf_accuracy:.3f}")
        print("[SeverityModel] Top feature importances:")
        print(self.feature_importances_.head(5).to_string(index=False))

    def _build_features(self, df: pd.DataFrame, max_junc_count: int = 64) -> pd.DataFrame:
        """Build the numeric feature matrix from a DataFrame of events."""
        le_cause = self.label_encoders['event_cause']
        le_zone  = self.label_encoders['zone']

        cause_vals = (
            df['event_cause'].fillna('others').str.lower().str.strip()
             .apply(lambda v: v if v in le_cause.classes_ else le_cause.classes_[0])
        )
        zone_vals = (
            df['zone'].fillna('Unknown')
             .apply(lambda v: v if v in le_zone.classes_ else le_zone.classes_[0])
        )

        hour    = df['hour'].fillna(12).astype(float)
        dow_num = df['dow_num'].fillna(0).astype(float)

        coords = df[['latitude', 'longitude']].fillna(
            {'latitude': 12.97, 'longitude': 77.59}
        )
        spatial = (
            self.spatial_cluster.predict(coords)
            if self.spatial_cluster is not None else np.zeros(len(df))
        )

        junc_score = df['junction'].apply(
            lambda j: self.junction_hotspots.get(str(j), 0) / max(max_junc_count, 1)
            if pd.notna(j) else 0.0
        )

        X = pd.DataFrame({
            'cause_enc':          le_cause.transform(cause_vals),
            'is_unplanned':       (df['event_type'] == 'unplanned').astype(int),
            'requires_closure':   df['requires_road_closure'].fillna(False).astype(int),
            'is_high_priority':   (df.get('priority', 'Low') == 'High').astype(int),
            'hour_sin':           np.sin(2 * np.pi * hour / 24),
            'hour_cos':           np.cos(2 * np.pi * hour / 24),
            'dow':                dow_num,
            'zone_enc':           le_zone.transform(zone_vals),
            'spatial_cluster':    spatial,
            'junc_hotspot_score': junc_score.astype(float),
        })
        return X

    # ── Prediction ────────────────────────────────────────────────────────────

    def predict(self, event_dict: dict) -> dict:
        """
        Predict severity for a single event dict.
        Returns a rich dict immediately (< 5 ms after training).
        Falls back to rule-based scoring if model isn't ready.
        """
        if not self.is_trained:
            return self._rule_based(event_dict)

        cause = (
            event_dict.get('cause', 'others')
            .lower().replace(' ', '_').strip()
        )
        try:
            start_dt = pd.to_datetime(event_dict.get('time', ''))
            hour, dow_num = float(start_dt.hour), float(start_dt.dayofweek)
        except Exception:
            hour, dow_num = 12.0, 0.0

        row = pd.DataFrame([{
            'event_cause':          cause,
            'event_type':           event_dict.get('event_type', 'unplanned'),
            'requires_road_closure': event_dict.get('requires_closure', False),
            'priority':             'High' if event_dict.get('requires_closure') else 'Low',
            'hour':                 hour,
            'dow_num':              dow_num,
            'zone':                 'Unknown',
            'junction':             '',
            'latitude':             event_dict.get('latitude', 12.97),
            'longitude':            event_dict.get('longitude', 77.59),
        }])

        max_junc = max(self.junction_hotspots.values(), default=1)
        X = self._build_features(row, max_junc)

        log_pred       = self.regressor.predict(X)[0]
        resolution_min = max(5.0, float(np.expm1(log_pred)))

        level_idx    = int(self.classifier.predict(X)[0])
        level_proba  = self.classifier.predict_proba(X)[0]
        confidence   = float(level_proba.max())
        levels       = ['Green', 'Amber', 'Red']
        level        = levels[level_idx]

        # Score: 0–10 log-normalised (cap at ~7-day event)
        max_log = np.log1p(43_200)
        score   = min(10.0, round(np.log1p(resolution_min) / max_log * 10, 1))

        result = {
            'severity_score':    score,
            'resolution_minutes': int(round(resolution_min)),
            'resolution_label':  _fmt_duration(resolution_min),
            'response_level':    level,
            'confidence':        round(confidence, 2),
            'model_r2':          round(self.r2_score, 3) if self.r2_score else None,
            'model_accuracy':    round(self.clf_accuracy, 3) if self.clf_accuracy else None,
        }
        return self._apply_scenario_context(result, event_dict)

    def _rule_based(self, event_dict: dict) -> dict:
        """Deterministic fallback before model is trained."""
        cause = event_dict.get('cause', 'others').lower().replace(' ', '_')
        score = _CAUSE_BASE_SCORE.get(cause, 5)
        if event_dict.get('requires_closure'):
            score = min(10, score + 2)
        level = 'Red' if score >= 7 else ('Amber' if score >= 4 else 'Green')
        result = {
            'severity_score':    float(score),
            'resolution_minutes': score * 60,
            'resolution_label':  _fmt_duration(score * 60),
            'response_level':    level,
            'confidence':        0.5,
            'model_r2':          None,
            'model_accuracy':    None,
        }
        return self._apply_scenario_context(result, event_dict)

    @staticmethod
    def _apply_scenario_context(result: dict, event_dict: dict) -> dict:
        """Apply transparent operational modifiers unavailable in historical training."""
        attendance = int(event_dict.get('expected_attendance') or 0)
        closure = event_dict.get('closure_severity')
        multiplier = 1.0
        score_bonus = 0.0
        factors = []
        if attendance >= 10_000:
            multiplier *= 1.35
            score_bonus += 1.0
            factors.append('large attendance (10,000+)')
        elif attendance >= 2_000:
            multiplier *= 1.15
            score_bonus += 0.5
            factors.append('medium attendance (2,000+)')
        if closure == 'full':
            multiplier *= 1.2
            score_bonus += 0.5
            factors.append('full road closure')

        if factors:
            minutes = max(5, round(result['resolution_minutes'] * multiplier))
            score = min(10.0, round(result['severity_score'] + score_bonus, 1))
            result.update({
                'resolution_minutes': minutes,
                'resolution_label': _fmt_duration(minutes),
                'severity_score': score,
                'response_level': 'Red' if score >= 7 else ('Amber' if score >= 4 else 'Green'),
                'scenario_factors': factors,
            })
        else:
            result['scenario_factors'] = []
        return result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_duration(minutes: float) -> str:
    if minutes < 60:
        return f"~{int(minutes)} min"
    elif minutes < 1440:
        return f"~{minutes / 60:.1f} hrs"
    else:
        return f"~{minutes / 1440:.1f} days"


# ── Singleton ─────────────────────────────────────────────────────────────────

_predictor: SeverityPredictor | None = None


def get_predictor() -> SeverityPredictor:
    global _predictor
    if _predictor is None:
        _predictor = SeverityPredictor()
    return _predictor
