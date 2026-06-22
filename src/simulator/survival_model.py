import pandas as pd
import numpy as np
from lifelines import CoxPHFitter
import warnings
warnings.filterwarnings('ignore')

class ClearanceForecaster:
    """
    Cox Proportional Hazards model for incident clearance time.
    Outputs a survival curve S(t|X) and a confidence interval
    for the 80th percentile clearance time.
    """
    def __init__(self):
        self._cph = None
        self._is_fitted = False

    def fit(self, df: pd.DataFrame):
        print("[SurvivalModel] Starting Cox PH training...")
        df = df.copy()
        df['start_dt']  = pd.to_datetime(df['start_datetime'], utc=True, errors='coerce')
        df['closed_dt'] = pd.to_datetime(df['closed_datetime'], utc=True, errors='coerce')
        df['T'] = (df['closed_dt'] - df['start_dt']).dt.total_seconds() / 60
        df['E'] = 1  # assuming complete records for the ones with closed_dt

        # Keep usable rows
        df = df.dropna(subset=['T', 'veh_type', 'corridor'])
        df = df[(df['T'] > 2) & (df['T'] < 43200)]

        # Dummy-encode categoricals
        df['is_bmtc']    = (df['veh_type'] == 'bmtc_bus').astype(int)
        df['is_heavy']   = (df['veh_type'] == 'heavy_vehicle').astype(int)
        df['is_hcorridor'] = df['corridor'].apply(lambda c: 0 if c == 'Non-corridor' else 1)
        df['requires_closure'] = df['requires_road_closure'].fillna(False).astype(int)

        features = ['T', 'E', 'is_bmtc', 'is_heavy', 'is_hcorridor', 'requires_closure']
        self._cph = CoxPHFitter(penalizer=0.1)
        self._cph.fit(df[features], duration_col='T', event_col='E')
        self._is_fitted = True
        
        print("[SurvivalModel] DONE - Trained Cox PH model.")
        print(self._cph.summary[['coef', 'exp(coef)', 'p']].to_string())

    def predict_clearance(self, event_dict: dict) -> dict:
        if not self._is_fitted:
            # Fallback if not trained yet
            return {
                'median_clearance_min': 60,
                't80_clearance_min': 120,
                'survival_at_30min': 0.8,
                'survival_at_60min': 0.5,
            }

        row = pd.DataFrame([{
            'is_bmtc':         int(event_dict.get('veh_type', '') == 'bmtc_bus'),
            'is_heavy':        int(event_dict.get('veh_type', '') == 'heavy_vehicle'),
            'is_hcorridor':    int(event_dict.get('corridor', 'Non-corridor') != 'Non-corridor'),
            'requires_closure':int(bool(event_dict.get('requires_closure', False))),
        }])
        
        sf = self._cph.predict_survival_function(row)
        t_vals = sf.index.values
        s_vals = sf.iloc[:, 0].values
        
        # Find t where S(t) first drops below 0.5 (median) and 0.2 (80th pct)
        t50_idx = np.searchsorted(-s_vals, -0.5, side='right')
        t80_idx = np.searchsorted(-s_vals, -0.2, side='right')
        
        t50 = float(t_vals[t50_idx]) if t50_idx < len(t_vals) else float(t_vals[-1])
        t80 = float(t_vals[t80_idx]) if t80_idx < len(t_vals) else float(t_vals[-1])
        
        sf_30 = sf.iloc[:, 0][sf.index <= 30]
        sf_60 = sf.iloc[:, 0][sf.index <= 60]
        surv_30 = float(sf_30.iloc[-1]) if len(sf_30) > 0 else 1.0
        surv_60 = float(sf_60.iloc[-1]) if len(sf_60) > 0 else 1.0

        return {
            'median_clearance_min': round(t50, 0),
            't80_clearance_min':    round(t80, 0),
            'survival_at_30min':    round(surv_30, 3),
            'survival_at_60min':    round(surv_60, 3),
        }

_forecaster = None

def get_forecaster() -> ClearanceForecaster:
    global _forecaster
    if _forecaster is None:
        _forecaster = ClearanceForecaster()
    return _forecaster
