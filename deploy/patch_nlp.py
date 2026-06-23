#!/usr/bin/env python3
"""Patch nlp_impact.py to skip training on low-memory servers."""
import sys, os

sys.path.insert(0, 'src/simulator')

with open('src/simulator/nlp_impact.py', 'r') as f:
    content = f.read()

old_fit = '''    def fit(self, df):
        print("[NLPImpact] Starting NLP weak-label training...")
        
        if os.path.exists(self._model_path):
            print(f"[NLPImpact] Loading existing model from {self._model_path}")
            loaded = joblib.load(self._model_path)
            self._encoder, self._clf = loaded[0], loaded[1]
            self._base_texts  = loaded[2] if len(loaded) > 2 else []
            self._base_labels = loaded[3] if len(loaded) > 3 else []
            self._base_X      = loaded[4] if len(loaded) > 4 else None
            self._is_fitted = True
            return

        desc = df['description'].dropna()'''

new_fit = '''    def fit(self, df):
        print("[NLPImpact] NLP training skipped (low-memory server mode)")
        self._is_fitted = False
        return

        # Original training code preserved below for reference:
        _desc_skip = df['description'].dropna()'''

if old_fit in content:
    content = content.replace(old_fit, new_fit)
    with open('src/simulator/nlp_impact.py', 'w') as f:
        f.write(content)
    print('PATCHED: NLP training disabled')
else:
    print('ALREADY PATCHED or code changed')

os.remove('nlp_model.pkl') if os.path.exists('nlp_model.pkl') else None
print('Cleaned up nlp_model.pkl')
