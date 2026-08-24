"""
Büyüme Eğrisi (Growth Curve) Hesaplayıcı — Phase 3
Videoların T+2, T+8 ve T+24 saatlerindeki snapshotlarını alıp
hızlanma (velocity) ve ivme (acceleration) eğrisini çıkarır.
"""
import structlog
from datetime import datetime

logger = structlog.get_logger()

class ViewTracker:
    
    def analyze_growth_curve(self, snapshots: list[dict]) -> dict:
        """
        snapshots listesi snapshot_number'a göre sıralı gelmelidir (1, 2, 3).
        [
           {view_count: 500, snapshot_number: 1},
           {view_count: 2500, snapshot_number: 2},
           {view_count: 3000, snapshot_number: 3}
        ]
        """
        if not snapshots:
            return {"error": "Snapshot verisi yok"}
            
        # Snapshotları ayıkla
        s1 = next((s for s in snapshots if s.get('snapshot_number') == 1), None)
        s2 = next((s for s in snapshots if s.get('snapshot_number') == 2), None)
        s3 = next((s for s in snapshots if s.get('snapshot_number') == 3), None)
        
        v1 = s1.get('view_count', 0) if s1 else 0
        v2 = s2.get('view_count', v1) if s2 else v1
        v3 = s3.get('view_count', v2) if s3 else v2
        
        # Büyüme hızları (Farklar)
        growth_2h = v1
        growth_2h_to_8h = max(0, v2 - v1)
        growth_8h_to_24h = max(0, v3 - v2)
        
        # Normal şartlarda sosyal medya algoritması başlarda hızlı (virallik), sonra yavaşlar.
        # Eğer growth_8h_to_24h > growth_2h_to_8h * 3 ise (sonradan anormal patlama) -> SMM panel şüphesi
        suspicious_late_spike = False
        if v3 > 2000 and growth_8h_to_24h > (growth_2h_to_8h * 3):
            suspicious_late_spike = True
            
        return {
            "v1": v1,
            "v2": v2,
            "v3": v3,
            "growth_2h": growth_2h,
            "growth_2h_to_8h": growth_2h_to_8h,
            "growth_8h_to_24h": growth_8h_to_24h,
            "suspicious_late_spike": suspicious_late_spike,
            "total_views": v3
        }

    def combine_all_scores(
        self,
        rule_score: float,
        stat_adjustment: float = 0,
        ai_score: float | None = None,
        growth_curve_score: float | None = None,
    ) -> dict:
        """
        Tüm analiz katmanlarının skorlarını birleştir.

        Ağırlıklar:
          - Rule:  %40 (her zaman mevcut)
          - AI:    %35 (yoksa rule skoru kullanılır)
          - Growth: %25 (yoksa 0 ağırlığı diğerlerine dağılır)

        stat_adjustment z-score bazlı düzeltme (±puan).
        """
        weights = {"rule": 0.40, "ai": 0.35, "growth": 0.25}
        total_weight = weights["rule"]
        weighted_sum = rule_score * weights["rule"]

        analysis_parts = ["rule"]

        if ai_score is not None:
            weighted_sum += ai_score * weights["ai"]
            total_weight += weights["ai"]
            analysis_parts.append("ai")

        if growth_curve_score is not None:
            weighted_sum += growth_curve_score * weights["growth"]
            total_weight += weights["growth"]
            analysis_parts.append("growth")

        # Normalize
        final = (weighted_sum / total_weight) if total_weight > 0 else 0

        # Stat adjustment (z-score sapması: ±puan)
        final = max(0, min(100, final + stat_adjustment))

        analysis_level = "full" if len(analysis_parts) >= 3 else (
            "ai" if "ai" in analysis_parts else "rule"
        )

        return {
            "final_score": round(final, 2),
            "is_authentic": final >= 70,
            "analysis_level": analysis_level,
            "components": {
                "rule_score": rule_score,
                "stat_adjustment": stat_adjustment,
                "ai_score": ai_score,
                "growth_curve_score": growth_curve_score,
            },
        }
