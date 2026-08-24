"""
İstatistiksel Analiz — Level 2
Z-score, view velocity, tarihsel karşılaştırma.
Rule analyzer sonucunu zenginleştirir.
"""
import math
from typing import Optional

import structlog

logger = structlog.get_logger()


class StatisticalAnalyzer:
    """Z-score ve velocity tabanlı istatistiksel analiz"""

    def __init__(self):
        pass

    def calculate_zscore(self, value: float, mean: float, std: float) -> float:
        """Z-score hesapla"""
        if std == 0:
            return 0.0
        return (value - mean) / std

    def analyze(self, reel_data: dict, user_history: list[dict]) -> dict:
        """
        Reel verisini kullanıcının geçmiş verilerine göre istatistiksel analiz et.
        
        Args:
            reel_data: Mevcut reel metrikleri
            user_history: Kullanıcının son 30 günlük geçmiş verileri
        
        Returns: Zenginleştirilmiş analiz sonucu
        """
        views = reel_data.get("view_count", 0)
        score_adjustment = 0.0
        flags: list[str] = []

        if len(user_history) < 5:
            # Yeterli geçmiş yok — sadece rule-based sonucu kullan
            logger.info("insufficient_history", count=len(user_history))
            return {
                "analysis_level": "statistical",
                "score_adjustment": 0,
                "flags": ["insufficient_history"],
                "historical_zscore": None,
                "view_velocity_1h": None,
                "view_velocity_6h": None,
                "view_velocity_24h": None,
            }

        # 1. Tarihsel view z-score
        hist_views = [h.get("view_count", 0) for h in user_history if h.get("view_count", 0) > 0]
        if hist_views:
            mean_views = sum(hist_views) / len(hist_views)
            # ★ FIX O5: Bessel düzeltmesi (N-1) — küçük örneklemde z-score şişmesi engellenir
            std_views = math.sqrt(sum((v - mean_views) ** 2 for v in hist_views) / max(1, len(hist_views) - 1))
            zscore = self.calculate_zscore(views, mean_views, std_views)

            reel_data["historical_zscore"] = round(zscore, 4)

            # Z-score > 3 → çok anormal (olumlu veya olumsuz)
            if abs(zscore) > 3:
                score_adjustment -= 20
                flags.append(f"extreme_zscore:{zscore:.2f}")
            elif abs(zscore) > 2:
                score_adjustment -= 10
                flags.append(f"high_zscore:{zscore:.2f}")

        # 2. Engagement rate karşılaştırma
        hist_engagement = [h.get("engagement_rate", 0) for h in user_history if h.get("engagement_rate")]
        if hist_engagement:
            mean_eng = sum(hist_engagement) / len(hist_engagement)
            current_eng = reel_data.get("engagement_rate", 0)

            if current_eng > 0 and mean_eng > 0:
                eng_ratio = current_eng / mean_eng
                if eng_ratio > 5:  # 5x normal engagement → şüpheli
                    score_adjustment -= 25
                    flags.append(f"engagement_spike:{eng_ratio:.1f}x")
                elif eng_ratio > 3:
                    score_adjustment -= 10
                    flags.append(f"high_engagement_ratio:{eng_ratio:.1f}x")

        # 3. View/follower oranı (varsa)
        follower_count = reel_data.get("follower_count", 0)
        if follower_count > 0 and views > 0:
            vf_ratio = views / follower_count
            if vf_ratio > 10:  # 10x follower kadar view → viral veya bot
                score_adjustment -= 15
                flags.append(f"high_view_follower_ratio:{vf_ratio:.1f}x")

        logger.info("statistical_analysis_complete",
            views=views,
            adjustment=score_adjustment,
            flags=flags
        )

        return {
            "analysis_level": "statistical",
            "score_adjustment": score_adjustment,
            "flags": flags,
            "historical_zscore": reel_data.get("historical_zscore"),
            "view_velocity_1h": reel_data.get("view_velocity_1h"),
            "view_velocity_6h": reel_data.get("view_velocity_6h"),
            "view_velocity_24h": reel_data.get("view_velocity_24h"),
        }

    def combine_scores(
        self,
        rule_score: float,
        stat_adjustment: float,
        ml_score: Optional[float] = None,
    ) -> dict:
        """
        Tüm analiz seviyelerini birleştirip final skor üret.
        
        Ağırlıklar (ML yoksa):
            rule: 70%, statistical: 30%
        
        Ağırlıklar (ML varsa):  
            rule: 20%, statistical: 20%, ml: 60%
        """
        if ml_score is not None:
            final = (rule_score * 0.20) + ((rule_score + stat_adjustment) * 0.20) + (ml_score * 0.60)
            level = "ml"
        else:
            final = (rule_score * 0.70) + ((rule_score + stat_adjustment) * 0.30)
            level = "statistical"

        final = max(0, min(100, final))

        return {
            "final_score": round(final, 2),
            "is_authentic": final >= 70,
            "analysis_level": level,
            "components": {
                "rule_score": rule_score,
                "stat_adjustment": stat_adjustment,
                "ml_score": ml_score,
            },
        }
