import os
import re
import numpy as np
import joblib
import warnings
warnings.filterwarnings('ignore')

try:
    from sentence_transformers import SentenceTransformer
except ImportError:  # pragma: no cover
    SentenceTransformer = None
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
        self._base_texts = []
        self._base_labels = []
        self._base_X = None

    def fit(self, df):
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

        desc = df['description'].dropna()
        
        # Weak labelling from keyword presence
        labels, texts = [], []
        for text in desc:
            text_lower = text.lower()
            matched = [lbl for kw, lbl in WEAK_LABELS.items() if kw in text_lower]
            if matched:
                texts.append(text)
                labels.append(1 if any(l == 1 for l in matched) else 0)
                    
        print(f"[NLPImpact] Found {len(texts)} weak-labeled descriptions for training.")
        
        if len(texts) < 10:
            print("[NLPImpact] Not enough labeled data to train.")
            return
            
        self._encoder = SentenceTransformer(self.MODEL_ID)
        X = self._encoder.encode(texts, batch_size=64, show_progress_bar=False)
        self._clf = LogisticRegression(max_iter=500).fit(X, labels)
        
        # Store base training data for future incremental retraining
        self._base_texts = texts
        self._base_labels = labels
        self._base_X = X

        joblib.dump((self._encoder, self._clf,
                     self._base_texts, self._base_labels, self._base_X),
                    self._model_path)
        self._is_fitted = True
        print("[NLPImpact] DONE - Trained and saved NLP Impact Classifier.")

    def predict_impact(self, text: str) -> dict:
        if not self._is_fitted or not text or not isinstance(text, str):
            return {'disrupted_prob': 0.5, 'label': 'Unknown', 'flagged_words': []}
            
        X = self._encoder.encode([text], show_progress_bar=False)
        prob = self._clf.predict_proba(X)[0]
        
        text_lower = text.lower()
        flagged = [kw for kw in WEAK_LABELS.keys() if kw in text_lower]
        
        return {
            'disrupted_prob': round(float(prob[1]), 3),
            'label': 'Disrupted' if prob[1] > 0.5 else 'Contained',
            'flagged_words': flagged
        }

    def retrain_from_feedback(self, feedback_rows: list):
        """
        Re-fit the logistic head using confirmed operator labels from feedback,
        concatenating with existing base training data to avoid catastrophic forgetting.
        """
        if not self._is_fitted:
            return

        # Extract feedback texts and corresponding binary labels
        fb_texts = [r['description'] for r in feedback_rows if r.get('description')]
        if not fb_texts:
            return
        fb_labels = [0 if r.get('observed_severity') == 'Green' else 1 for r in feedback_rows if r.get('description')]

        print(f"[NLPImpact] Retraining on {len(fb_texts)} confirmed feedback records...")
        X_fb = self._encoder.encode(fb_texts, batch_size=64, show_progress_bar=False)

        # Combine with base training data if available
        if self._base_X is not None and len(self._base_X) > 0:
            X_all = np.vstack([self._base_X, X_fb])
            y_all = self._base_labels + fb_labels
        else:
            X_all = X_fb
            y_all = fb_labels

        # Fit on the combined dataset
        if self._clf is None:
            self._clf = LogisticRegression(max_iter=500)
        self._clf.fit(X_all, y_all)

        # Update base sets for future incremental training
        self._base_X = X_all
        self._base_labels = y_all
        self._base_texts = list(self._base_texts) + fb_texts

        try:
            joblib.dump((self._encoder, self._clf,
                         self._base_texts, self._base_labels, self._base_X),
                        self._model_path)
        except Exception as e:
            print(f"[NLPImpact] Warning: failed to dump model: {e}")
        print(f"[NLPImpact] Retraining complete. Total training size now {len(self._base_labels)}.")

_classifier = None

def get_nlp_classifier() -> NLPImpactClassifier:
    global _classifier
    if _classifier is None:
        _classifier = NLPImpactClassifier()
    return _classifier
