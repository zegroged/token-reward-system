"""
Anomali Dedektörü — Gerçek zamanlı alarm sistemi
5x kazanım, havuz tükenmesi, token süresi, velocity spike tespiti.
"""
import structlog
from datetime import datetime, timedelta, timezone
from decimal import Decimal

logger = structlog.get_logger()


class AnomalyDetector:
    """Çok katmanlı anomali tespit sistemi"""

    def __init__(
        self,
        earning_multiplier_alert: float = 5.0,
        pool_critical_threshold: float = 2000.0,
        velocity_window_hours: int = 1,
        velocity_max_views: int = 50000,
    ):
        self.earning_multiplier_alert = earning_multiplier_alert
        self.pool_critical_threshold = pool_critical_threshold
        self.velocity_window_hours = velocity_window_hours
        self.velocity_max_views = velocity_max_views

    def check_earning_spike(
        self, current_earning: float, user_avg_earning: float, user_name: str
    ) -> dict | None:
        """Kullanıcının kazanımı ortalamasının 5x üstüne çıktı mı?"""
        if user_avg_earning <= 0:
            return None

        ratio = current_earning / user_avg_earning
        if ratio >= self.earning_multiplier_alert:
            alert = {
                "type": "earning_spike",
                "severity": "high" if ratio >= 10 else "medium",
                "user": user_name,
                "current": current_earning,
                "average": user_avg_earning,
                "ratio": round(ratio, 2),
                "message": f"{user_name}: {ratio:.1f}x kazanım spike — {current_earning} TOKEN (ort: {user_avg_earning})",
            }
            logger.warning("anomaly_earning_spike", **alert)
            return alert
        return None

    def check_pool_depletion(
        self, pool_balance: float, daily_distribution: float
    ) -> dict | None:
        """Havuz bakiyesi kritik seviyede mi? Kaç gün yeter?"""
        if daily_distribution <= 0:
            return None

        days_remaining = pool_balance / daily_distribution

        if pool_balance <= self.pool_critical_threshold or days_remaining <= 3:
            alert = {
                "type": "pool_depletion",
                "severity": "critical" if days_remaining <= 1 else "high",
                "balance": pool_balance,
                "daily_usage": daily_distribution,
                "days_remaining": round(days_remaining, 1),
                "message": f"HAVUZ KRİTİK: {pool_balance:.0f}₺ kaldı, {days_remaining:.1f} gün yeter",
            }
            logger.error("anomaly_pool_depletion", **alert)
            return alert
        return None

    def check_token_expiry(
        self, user_name: str, token_expires: datetime, warning_days: int = 10, critical_days: int = 3
    ) -> dict | None:
        """Instagram token süresi dolmak üzere mi?"""
        now = datetime.now(timezone.utc)
        remaining = (token_expires - now).days

        if remaining <= 0:
            alert = {
                "type": "token_expired",
                "severity": "critical",
                "user": user_name,
                "days_remaining": 0,
                "message": f"{user_name}: Instagram token SÜRESİ DOLMUŞ!",
            }
            logger.error("anomaly_token_expired", **alert)
            return alert
        elif remaining <= critical_days:
            alert = {
                "type": "token_expiring",
                "severity": "high",
                "user": user_name,
                "days_remaining": remaining,
                "message": f"{user_name}: Token {remaining} gün sonra dolacak!",
            }
            logger.warning("anomaly_token_expiring", **alert)
            return alert
        elif remaining <= warning_days:
            alert = {
                "type": "token_expiring",
                "severity": "medium",
                "user": user_name,
                "days_remaining": remaining,
                "message": f"{user_name}: Token {remaining} gün sonra dolacak",
            }
            logger.info("anomaly_token_warning", **alert)
            return alert
        return None

    def check_velocity_spike(
        self, reel_views: int, reel_age_hours: float, user_name: str
    ) -> dict | None:
        """Kısa sürede çok fazla izlenme var mı? (bot/fake indicator)"""
        if reel_age_hours <= 0:
            return None

        velocity = reel_views / reel_age_hours

        if velocity > self.velocity_max_views:
            alert = {
                "type": "velocity_spike",
                "severity": "high",
                "user": user_name,
                "views": reel_views,
                "age_hours": round(reel_age_hours, 1),
                "velocity_per_hour": round(velocity, 0),
                "message": f"{user_name}: {velocity:.0f} view/saat — şüpheli velocity",
            }
            logger.warning("anomaly_velocity_spike", **alert)
            return alert
        return None

    def check_multi_account(
        self, user_ip: str, active_users_on_ip: int
    ) -> dict | None:
        """Aynı IP'den birden fazla hesap erişimi var mı?"""
        if active_users_on_ip > 3:
            alert = {
                "type": "multi_account",
                "severity": "medium",
                "ip": user_ip,
                "user_count": active_users_on_ip,
                "message": f"IP {user_ip}: {active_users_on_ip} aktif kullanıcı — çoklu hesap şüphesi",
            }
            logger.warning("anomaly_multi_account", **alert)
            return alert
        return None

    def run_all_checks(self, context: dict) -> list[dict]:
        """Tüm anomali kontrollerini çalıştır"""
        alerts = []

        # Earning spike
        if "current_earning" in context and "avg_earning" in context:
            result = self.check_earning_spike(
                context["current_earning"],
                context["avg_earning"],
                context.get("user_name", "Unknown"),
            )
            if result:
                alerts.append(result)

        # Pool depletion
        if "pool_balance" in context and "daily_distribution" in context:
            result = self.check_pool_depletion(
                context["pool_balance"],
                context["daily_distribution"],
            )
            if result:
                alerts.append(result)

        # Token expiry
        if "token_expires" in context:
            result = self.check_token_expiry(
                context.get("user_name", "Unknown"),
                context["token_expires"],
            )
            if result:
                alerts.append(result)

        # Velocity spike
        if "reel_views" in context and "reel_age_hours" in context:
            result = self.check_velocity_spike(
                context["reel_views"],
                context["reel_age_hours"],
                context.get("user_name", "Unknown"),
            )
            if result:
                alerts.append(result)

        return alerts
