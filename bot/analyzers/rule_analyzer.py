"""
Kural Tabanlı Analiz — Level 1 (Geliştirilmiş v2)
Platforma özel dinamik eşikler + takipçi segmentasyonu.
Sabit threshold'lar yerine follower_count × çarpan mantığı.
"""
from datetime import datetime, timezone
import structlog

logger = structlog.get_logger()


# ── Platform Çarpanları ──
# TikTok FYP algoritması viral yayılımı kolaylaştırır → daha toleranslı
PLATFORM_VELOCITY_MULTIPLIER = {
    "instagram": 1.0,
    "tiktok": 3.0,
}

# View/Follower oranı limitleri (üstü şüpheli)
PLATFORM_VIEW_FOLLOWER_LIMIT = {
    "instagram": 5.0,   # 5x follower → şüpheli
    "tiktok": 20.0,     # 20x follower → FYP etkisi (daha toleranslı)
}


def _get_segment(follower_count: int) -> tuple[str, float]:
    """
    Takipçi segmenti ve velocity çarpanı döndür.
    
    Micro  (<5K):   saatte max 2x takipçi kadar view
    Mid    (5K-50K): saatte max 1.5x takipçi kadar view
    Macro  (50K+):  saatte max 1x takipçi kadar view
    """
    if follower_count < 5_000:
        return "micro", 2.0
    elif follower_count < 50_000:
        return "mid", 1.5
    else:
        return "macro", 1.0


class RuleBasedAnalyzer:
    """Platforma özel, takipçi bazlı dinamik kural analizi"""

    # Fallback — takipçi bilinmiyorsa kullanılacak sabit limitler
    FALLBACK_VELOCITY_MAX = 10_000
    LIKE_VIEW_RATIO_MIN = 0.001
    LIKE_VIEW_RATIO_MAX = 0.3

    def analyze(
        self,
        reel_data: dict,
        platform: str = "instagram",
        follower_count: int = 0,
        is_campaign: bool = False,
    ) -> dict:
        """
        Reel verisini platforma özel dinamik kurallarla analiz et.

        Args:
            reel_data: view_count, like_count, comment_count, save_count, share_count, reach, timestamp
            platform: "instagram" | "tiktok"
            follower_count: kullanıcının takipçi sayısı (0 ise fallback kurallar kullanılır)

        Returns: {
            authenticity_score: 0-100,
            is_authentic: bool,
            flagged: bool,
            flag_reasons: list,
            analysis_level: "rule",
            engagement_rate: float,
            segment: str,
            platform: str,
        }
        """
        views = reel_data.get("view_count", 0)
        likes = reel_data.get("like_count", 0)
        comments = reel_data.get("comment_count", 0)
        saves = reel_data.get("save_count", 0)
        shares = reel_data.get("share_count", 0)
        reach = reel_data.get("reach", 0)
        # ★ FIX O4: Fonksiyon parametrelerini kullan, reel_data yalnızca fallback
        follower_count = follower_count or reel_data.get("follower_count", 0)
        platform = platform or reel_data.get("platform", "instagram")

        score = 100.0
        flags: list[str] = []

        if views == 0:
            return {
                "authenticity_score": 0,
                "is_authentic": False,
                "flagged": True,
                "flag_reasons": ["zero_views"],
                "analysis_level": "rule",
                "engagement_rate": 0,
                "segment": "unknown",
                "platform": platform,
            }

        # ── Segment belirleme ──
        if follower_count > 0:
            segment, velocity_factor = _get_segment(follower_count)
        else:
            segment = "unknown"
            velocity_factor = 1.0

        platform_velocity_mult = PLATFORM_VELOCITY_MULTIPLIER.get(platform, 1.0)
        view_follower_limit = PLATFORM_VIEW_FOLLOWER_LIMIT.get(platform, 5.0)

        # ══════════════════════════════════════════
        # 1. View / Follower Oranı (en güçlü sinyal)
        # ══════════════════════════════════════════
        if follower_count > 0:
            vf_ratio = views / follower_count

            if vf_ratio > view_follower_limit:
                # Limit aşımı oranına göre ceza ağırlığı
                overshoot = vf_ratio / view_follower_limit
                if overshoot > 5:
                    score -= 40
                    flags.append(f"extreme_view_follower:{vf_ratio:.1f}x ({platform})")
                elif overshoot > 2:
                    score -= 25
                    flags.append(f"high_view_follower:{vf_ratio:.1f}x ({platform})")
                else:
                    score -= 10
                    flags.append(f"elevated_view_follower:{vf_ratio:.1f}x ({platform})")

        # ══════════════════════════════════════════
        # 2. Dinamik Velocity Kontrolü
        # ══════════════════════════════════════════
        reel_timestamp = reel_data.get("timestamp", "")
        if reel_timestamp:
            try:
                if isinstance(reel_timestamp, str):
                    reel_time = datetime.fromisoformat(reel_timestamp.replace("Z", "+00:00"))
                else:
                    reel_time = reel_timestamp
                age_hours = max(
                    (datetime.now(timezone.utc) - reel_time).total_seconds() / 3600,
                    0.5  # minimum 30 dakika
                )
                velocity = views / age_hours

                # Dinamik velocity limiti
                if follower_count > 0:
                    max_velocity = follower_count * velocity_factor * platform_velocity_mult
                else:
                    max_velocity = self.FALLBACK_VELOCITY_MAX * platform_velocity_mult

                if velocity > max_velocity:
                    overshoot = velocity / max_velocity
                    if overshoot > 3:
                        score -= 35
                        flags.append(f"extreme_velocity:{velocity:.0f}/h (max:{max_velocity:.0f})")
                    elif overshoot > 1.5:
                        score -= 20
                        flags.append(f"high_velocity:{velocity:.0f}/h (max:{max_velocity:.0f})")

            except (ValueError, TypeError):
                pass  # timestamp parse edilemezse velocity kontrolü atlanır

        # ══════════════════════════════════════════
        # 3. Engagement Rate (genel sağlık kontrolü)
        # ══════════════════════════════════════════
        total_engagement = likes + comments + saves + shares
        engagement_rate = total_engagement / views if views > 0 else 0

        # Çok düşük engagement → botlar genellikle sadece izler, etkileşim yapmaz
        # ★ FIX O6/O7: Kampanya doğrulanmış içeriklerde düşük engagement normal
        # Reklam içerikleri doğası gereği düşük etkileşim alır — ceza uygulanmaz
        if not is_campaign:
            if engagement_rate < 0.002 and views > 1000:
                score -= 15
                flags.append(f"very_low_engagement:{engagement_rate:.4f}")

        # ══════════════════════════════════════════
        # 4. View/Reach Oranı (Instagram'a özel)
        # ══════════════════════════════════════════
        if reach > 0 and platform == "instagram":
            reach_ratio = views / reach
            if reach_ratio > 50:
                score -= 30
                flags.append(f"abnormal_view_reach_ratio:{reach_ratio:.1f}")
            elif reach_ratio > 20:
                score -= 15
                flags.append(f"high_view_reach_ratio:{reach_ratio:.1f}")

        # ══════════════════════════════════════════
        # 5. Sıfır etkileşim kontrolü
        # ══════════════════════════════════════════
        # ★ FIX O6: Kampanya modunda sıfır etkileşim normal (reklam)
        if not is_campaign:
            if likes == 0 and comments == 0 and views > 500:
                score -= 15
                flags.append("zero_interaction_with_views")

        # ── Final ──
        score = max(0, min(100, score))
        is_authentic = score >= 70
        flagged = score < 70 or len(flags) > 0

        logger.info("rule_analysis_complete",
            views=views,
            platform=platform,
            segment=segment,
            followers=follower_count,
            score=score,
            flagged=flagged,
            flags=flags
        )

        return {
            "authenticity_score": round(score, 2),
            "is_authentic": is_authentic,
            "flagged": flagged,
            "flag_reasons": flags,
            "analysis_level": "rule",
            "engagement_rate": round(engagement_rate, 6),
            "segment": segment,
            "platform": platform,
        }
