"""
Token Hesaplama Engine — Formül v2
views × base_rate × authenticity_multiplier = kazanılan token
Engagement multiplier kaldırıldı (reklam içeriklerinde düşük etkileşim normal).
Authenticity score bazlı çarpan sistemi.
"""
import structlog
from decimal import Decimal

logger = structlog.get_logger()


# Authenticity bazlı çarpanlar
AUTHENTICITY_MULTIPLIERS = {
    90: Decimal("1.00"),    # score >= 90 → tam ödeme
    80: Decimal("0.90"),    # score >= 80 → %90
    70: Decimal("0.70"),    # score >= 70 → %70 (kısmi)
    0:  Decimal("0.00"),    # score <  70 → ödeme yok (bot algılandı)
}


def _get_authenticity_multiplier(score: float) -> Decimal:
    """Authenticity skoruna göre çarpan döndür"""
    for threshold in sorted(AUTHENTICITY_MULTIPLIERS.keys(), reverse=True):
        if score >= threshold:
            return AUTHENTICITY_MULTIPLIERS[threshold]
    return Decimal("0")


class TokenCalculator:
    """Token kazanımı hesaplama — v2 (authenticity bazlı)"""

    def __init__(
        self,
        base_rate: float = 0.01,
        daily_cap: float = 500.0,
        min_authenticity: float = 70.0,
        formula_version: str = "v2",
    ):
        self.base_rate = Decimal(str(base_rate))
        self.daily_cap = Decimal(str(daily_cap))
        self.min_authenticity = min_authenticity
        self.formula_version = formula_version

    def calculate(self, reel_data: dict) -> dict:
        """
        Tek bir Reel için token hesapla.

        Formül v2:
            base_tokens = views × base_rate
            final = base_tokens × authenticity_multiplier
            
        Authenticity multiplier:
            >= 90: 1.0x (tam ödeme)
            >= 80: 0.9x
            >= 70: 0.7x (kısmi)
            <  70: 0x (bot → ödeme yok)
        """
        views = reel_data.get("view_count", 0)
        authenticity = reel_data.get("authenticity_score", 0)

        # Authenticity check — eşik altı → 0 token
        if authenticity < self.min_authenticity:
            logger.warning("reel_below_threshold",
                authenticity=authenticity,
                min=self.min_authenticity,
                views=views,
            )
            return {
                "tokens": Decimal("0"),
                "formula_version": self.formula_version,
                "breakdown": {
                    "reason": "authenticity_below_threshold",
                    "authenticity_score": authenticity,
                    "views": views,
                },
                "raw_input": reel_data,
                "calculated_check": Decimal("0"),
            }

        # Base token = views × base_rate
        base_tokens = Decimal(str(views)) * self.base_rate

        # Authenticity çarpanı
        auth_multiplier = _get_authenticity_multiplier(authenticity)
        final_tokens = (base_tokens * auth_multiplier).quantize(Decimal("0.01"))

        logger.debug("token_calculated",
            views=views,
            authenticity=authenticity,
            multiplier=float(auth_multiplier),
            base=float(base_tokens),
            final=float(final_tokens),
        )

        return {
            "tokens": final_tokens,
            "formula_version": self.formula_version,
            "breakdown": {
                "views": views,
                "base_tokens": float(base_tokens),
                "authenticity_score": authenticity,
                "authenticity_multiplier": float(auth_multiplier),
            },
            "raw_input": reel_data,
            "calculated_check": final_tokens,
        }

    def calculate_daily(self, reels: list[dict]) -> dict:
        """
        Bir kullanıcının günlük toplam token kazanımını hesapla.
        Daily cap uygula.
        """
        total = Decimal("0")
        results = []

        for reel in reels:
            result = self.calculate(reel)
            total += result["tokens"]
            results.append(result)

        # Daily cap uygula
        capped = False
        if total > self.daily_cap:
            total = self.daily_cap
            capped = True
            logger.info("daily_cap_applied", total=float(total), cap=float(self.daily_cap))

        return {
            "total_tokens": total,
            "reel_count": len(reels),
            "capped": capped,
            "daily_cap": float(self.daily_cap),
            "reel_results": results,
            "formula_version": self.formula_version,
        }
