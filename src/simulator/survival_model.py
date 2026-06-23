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
                'n_observed': 0,
                'n_censored': 0,
            }

        veh = event_dict.get('veh_type', '')
        corridor = event_dict.get('corridor', 'Non-corridor')
        try:
            import pandas as _pd
            hour = _pd.to_datetime(event_dict.get('time', '')).hour
        except Exception:
            hour = 12

        row = pd.DataFrame({
            'is_bmtc':          int(veh == 'bmtc_bus'),
            'is_heavy':         int(veh == 'heavy_vehicle'),
            'is_lcv':           int(veh == 'lcv'),
            'is_hcorridor':     int(not pd.isna(corridor) and corridor != 'Non-corridor'),
            'requires_closure': int(bool(event_dict.get('requires_closure', False))),
            'hour_sin':         float(np.sin(2 * np.pi * hour / 24)),
            'hour_cos':         float(np.cos(2 * np.pi * hour / 24)),
        }, index=[0])

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
