import os
import re
import numpy as np
import joblib
import warnings
warnings.filterwarnings('ignore')

from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression

WEAK_LABELS = {
    'no problem': 0, 'normal': 0, 'moving': 0, 'clear': 0, 'cleared': 0,
    'slow': 1, 'closed': 1, 'blocked': 1, 'gridlock': 1, 'heavy': 1,
    'ನಿಧಾನ': 1,   # "slow" in Kannada
    'ಸಮಸ್ಯ': 1,   # "problem"
    'ನಿಂತಿದೆ': 1, # "standing/stopped"
    'ಕ್ಲೋಸ್': 1,  # "close"
}

class NLPImpactClassifier:
    MODEL_ID = "sentence-transformers/LaBSE"

    def __init__(self):
        self._encoder = None
        self._clf = None
        self._is_fitted = False
        self._model_path = 'nlp_model.pkl'

    def fit(self, df):
        print("[NLPImpact] Starting NLP weak-label training...")
        
        if os.path.exists(self._model_path):
            print(f"[NLPImpact] Loading existing model from {self._model_path}")
            self._encoder, self._clf = joblib.load(self._model_path)
            self._is_fitted = True
            return

        desc = df['description'].dropna()
        
        # Weak labelling from keyword presence
        labels, texts = [], []
        for text in desc:
            text_lower = text.lower()
            for kw, lbl in WEAK_LABELS.items():
                if kw in text_lower:
                    texts.append(text)
                    labels.append(lbl)
                    break
                    
        print(f"[NLPImpact] Found {len(texts)} weak-labeled descriptions for training.")
        
        if len(texts) < 10:
            print("[NLPImpact] Not enough labeled data to train.")
            return
            
        self._encoder = SentenceTransformer(self.MODEL_ID)
        X = self._encoder.encode(texts, batch_size=64, show_progress_bar=False)
        self._clf = LogisticRegression(max_iter=500).fit(X, labels)
        
        joblib.dump((self._encoder, self._clf), self._model_path)
        self._is_fitted = True
        print("[NLPImpact] DONE - Trained and saved NLP Impact Classifier.")

    def predict_impact(self, text: str) -> dict:
        if not self._is_fitted or not text or not isinstance(text, str):
            return {'disrupted_prob': 0.5, 'label': 'Unknown'}
            
        X = self._encoder.encode([text], show_progress_bar=False)
        prob = self._clf.predict_proba(X)[0]
        
        return {
            'disrupted_prob': round(float(prob[1]), 3),
            'label': 'Disrupted' if prob[1] > 0.5 else 'Contained'
        }

    def retrain_from_feedback(self, feedback_rows: list):
        """
        Re-fit the logistic head using confirmed operator labels from feedback.
        """
        if not self._is_fitted:
            return
            
        texts = [r['description'] for r in feedback_rows if r.get('description')]
        if not texts:
            return
            
        # Map observed severity to binary labels: Green -> 0 (Contained), Amber/Red -> 1 (Disrupted)
        labels = [0 if r.get('observed_severity') == 'Green' else 1 for r in feedback_rows if r.get('description')]
        
        print(f"[NLPImpact] Retraining on {len(texts)} confirmed feedback records...")
        X = self._encoder.encode(texts, batch_size=64, show_progress_bar=False)
        
        self._clf.fit(X, labels)
        joblib.dump((self._encoder, self._clf), self._model_path)
        print("[NLPImpact] Retraining complete.")

_classifier = None

def get_nlp_classifier() -> NLPImpactClassifier:
    global _classifier
    if _classifier is None:
        _classifier = NLPImpactClassifier()
    return _classifier
