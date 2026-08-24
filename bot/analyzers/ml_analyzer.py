"""
XGBoost ML Model — Level 3 (Phase 4)
Etiketlenmiş verilerle eğitilir, authenticity_score tahminler.
Min. 200 etiketli veri gerektirir.
"""
import os
import structlog
from typing import Optional

logger = structlog.get_logger()

# ML dependencies — Phase 4'te aktif edilecek
try:
    import numpy as np
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, classification_report
    import xgboost as xgb
    import joblib
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    logger.warning("ml_dependencies_not_installed", message="XGBoost/sklearn yüklü değil — Phase 4'te aktif edilecek")


MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'models', 'authenticity_model.pkl')
MIN_TRAINING_SAMPLES = 200


class MLAnalyzer:
    """XGBoost tabanlı authenticity tahmin modeli"""

    def __init__(self):
        self.model = None
        self.feature_names = [
            'view_count', 'like_count', 'comment_count', 'save_count',
            'share_count', 'reach', 'engagement_rate', 'historical_zscore',
            'like_view_ratio', 'comment_view_ratio', 'save_view_ratio',
        ]

    def is_ready(self) -> bool:
        """Model yüklü mü?"""
        return self.model is not None and ML_AVAILABLE

    def load_model(self) -> bool:
        """Eğitilmiş modeli yükle"""
        if not ML_AVAILABLE:
            return False
        try:
            if os.path.exists(MODEL_PATH):
                self.model = joblib.load(MODEL_PATH)
                logger.info("model_loaded", path=MODEL_PATH)
                return True
        except Exception as e:
            logger.error("model_load_failed", error=str(e))
        return False

    def extract_features(self, reel_data: dict) -> Optional[list]:
        """Reel verisinden feature vector çıkar"""
        if not ML_AVAILABLE:
            return None

        views = reel_data.get('view_count', 0) or 1  # Division by zero
        likes = reel_data.get('like_count', 0)
        comments = reel_data.get('comment_count', 0)
        saves = reel_data.get('save_count', 0)

        return [
            reel_data.get('view_count', 0),
            likes,
            comments,
            saves,
            reel_data.get('share_count', 0),
            reel_data.get('reach', 0),
            reel_data.get('engagement_rate', 0),
            reel_data.get('historical_zscore', 0) or 0,
            likes / views,           # like_view_ratio
            comments / views,        # comment_view_ratio
            saves / views,           # save_view_ratio
        ]

    def predict(self, reel_data: dict) -> Optional[dict]:
        """Tek bir reel için authenticity tahmini"""
        if not self.is_ready():
            return None

        features = self.extract_features(reel_data)
        if features is None:
            return None

        try:
            X = np.array([features])
            prob = self.model.predict_proba(X)[0]
            is_authentic = bool(prob[1] >= 0.5)
            score = float(prob[1] * 100)

            return {
                'ml_score': round(score, 2),
                'is_authentic': is_authentic,
                'confidence': round(max(prob) * 100, 2),
                'analysis_level': 'ml',
            }
        except Exception as e:
            logger.error("prediction_failed", error=str(e))
            return None

    def train(self, training_data: list[dict]) -> dict:
        """
        Etiketli verilerle model eğit.
        
        Args:
            training_data: [{reel_data..., is_authentic: bool}, ...]
        
        Returns: Eğitim metrikleri
        """
        if not ML_AVAILABLE:
            return {"error": "ML bağımlılıkları yüklü değil"}

        if len(training_data) < MIN_TRAINING_SAMPLES:
            return {"error": f"En az {MIN_TRAINING_SAMPLES} etiketli veri gerekli, mevcut: {len(training_data)}"}

        try:
            # Feature extraction
            X = []
            y = []
            for item in training_data:
                features = self.extract_features(item)
                if features:
                    X.append(features)
                    y.append(1 if item.get('is_authentic') else 0)

            X = np.array(X)
            y = np.array(y)

            # Train/test split
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42, stratify=y
            )

            # XGBoost model
            self.model = xgb.XGBClassifier(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                use_label_encoder=False,
                eval_metric='logloss',
                random_state=42,
            )
            self.model.fit(X_train, y_train)

            # Evaluation
            y_pred = self.model.predict(X_test)
            accuracy = accuracy_score(y_test, y_pred)

            # Save model
            joblib.dump(self.model, MODEL_PATH)

            result = {
                "accuracy": round(accuracy, 4),
                "training_samples": len(X_train),
                "test_samples": len(X_test),
                "model_path": MODEL_PATH,
                "feature_importance": dict(zip(
                    self.feature_names,
                    [round(float(x), 4) for x in self.model.feature_importances_]
                )),
            }

            logger.info("model_trained", **result)
            return result

        except Exception as e:
            logger.error("training_failed", error=str(e))
            return {"error": str(e)}
