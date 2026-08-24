"""
Instagram Meta Graph API — Veri Toplama Modülü
OAuth token ile kullanıcının Reels metriklerini çeker.
Circuit breaker + retry + rate limit koruması.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from config import META_API_BASE, META_API_VERSION, CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_RESET_TIMEOUT

logger = structlog.get_logger()


class CircuitBreaker:
    """Basit circuit breaker — API çökerse istekleri durdur"""
    def __init__(self, threshold: int = CIRCUIT_FAILURE_THRESHOLD, reset_timeout: int = CIRCUIT_RESET_TIMEOUT):
        self.threshold = threshold
        self.reset_timeout = reset_timeout
        self.failures = 0
        self.last_failure_time: Optional[datetime] = None
        self.is_open = False

    def record_success(self):
        self.failures = 0
        self.is_open = False

    def record_failure(self):
        self.failures += 1
        self.last_failure_time = datetime.now(timezone.utc)
        if self.failures >= self.threshold:
            self.is_open = True
            logger.error("circuit_breaker_opened", failures=self.failures)

    def can_proceed(self) -> bool:
        if not self.is_open:
            return True
        if self.last_failure_time:
            elapsed = (datetime.now(timezone.utc) - self.last_failure_time).total_seconds()
            if elapsed >= self.reset_timeout:
                self.is_open = False
                self.failures = 0
                logger.info("circuit_breaker_reset")
                return True
        return False


class InstagramCollector:
    """Instagram Graph API üzerinden Reels veri toplama"""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30)
        self.circuit = CircuitBreaker()
        self.base_url = f"{META_API_BASE}/{META_API_VERSION}"

    async def close(self):
        await self.client.aclose()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
    )
    async def _api_call(self, url: str, params: dict) -> dict:
        """Meta API çağrısı — retry + circuit breaker"""
        if not self.circuit.can_proceed():
            raise Exception("Circuit breaker açık — API istekleri durduruldu")

        try:
            response = await self.client.get(url, params=params)
            response.raise_for_status()
            self.circuit.record_success()
            return response.json()
        except Exception as e:
            self.circuit.record_failure()
            raise

    async def get_user_media(self, user_ig_id: str, access_token: str, limit: int = 25) -> list[dict]:
        """Kullanıcının son medyalarını çek"""
        url = f"{self.base_url}/{user_ig_id}/media"
        params = {
            "fields": "id,media_type,media_url,permalink,timestamp,caption,thumbnail_url",
            "limit": limit,
            "access_token": access_token,
        }
        data = await self._api_call(url, params)
        
        # Sadece VIDEO (Reels) olanları filtrele
        media_list = data.get("data", [])
        reels = [m for m in media_list if m.get("media_type") == "VIDEO"]
        
        logger.info("user_media_fetched",
            user_ig_id=user_ig_id,
            total=len(media_list),
            reels=len(reels)
        )
        return reels

    async def get_follower_count(self, user_ig_id: str, access_token: str) -> int:
        """Kullanıcının takipçi sayısını çek"""
        url = f"{self.base_url}/{user_ig_id}"
        params = {
            "fields": "followers_count",
            "access_token": access_token,
        }
        try:
            data = await self._api_call(url, params)
            count = data.get("followers_count", 0)
            logger.info("follower_count_fetched", user_ig_id=user_ig_id, followers=count)
            return count
        except Exception as e:
            logger.warning("follower_count_failed", user_ig_id=user_ig_id, error=str(e))
            return 0

    async def get_media_insights(self, media_id: str, access_token: str) -> dict:
        """Tek bir medyanın metriklerini çek"""
        url = f"{self.base_url}/{media_id}/insights"
        params = {
            "metric": "plays,reach,saved,shares,comments,likes,total_interactions",
            "access_token": access_token,
        }
        
        try:
            data = await self._api_call(url, params)
            insights = {}
            for item in data.get("data", []):
                name = item.get("name")
                values = item.get("values", [{}])
                insights[name] = values[0].get("value", 0) if values else 0
            
            logger.debug("media_insights_fetched", media_id=media_id, metrics=list(insights.keys()))
            return insights
        except Exception as e:
            logger.warning("media_insights_failed", media_id=media_id, error=str(e))
            return {}

    async def collect_user_reels(self, user_ig_id: str, access_token: str, since_hours: int = 30) -> list[dict]:
        """
        Kullanıcının son 30 saatteki Reels'lerini topla + metrikleri çek
        Bot her gece 04:00'da çalıştığında önceki günün verilerini alır
        """
        reels = await self.get_user_media(user_ig_id, access_token)

        # Takipçi sayısını çek
        follower_count = await self.get_follower_count(user_ig_id, access_token)
        
        # Son 30 saatteki reels'leri filtrele
        cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
        recent_reels = []
        
        for reel in reels:
            ts = reel.get("timestamp", "")
            try:
                reel_time = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if reel_time >= cutoff:
                    # Her reel için metrikleri çek
                    insights = await self.get_media_insights(reel["id"], access_token)
                    
                    recent_reels.append({
                        "reel_id": reel["id"],
                        "reel_url": reel.get("permalink", ""),
                        "timestamp": ts,
                        "caption": reel.get("caption", ""),
                        "view_count": insights.get("plays", 0),
                        "like_count": insights.get("likes", 0),
                        "comment_count": insights.get("comments", 0),
                        "save_count": insights.get("saved", 0),
                        "share_count": insights.get("shares", 0),
                        "reach": insights.get("reach", 0),
                        "impressions": insights.get("total_interactions", 0),
                        "follower_count": follower_count,
                        "platform": "instagram",
                        "thumbnail_url": reel.get("thumbnail_url", ""),
                        "duration": reel.get("video_duration", 0),
                    })
                    
                    # Rate limiting — 200 calls/hour Meta limit
                    await asyncio.sleep(0.5)
            except (ValueError, KeyError) as e:
                logger.warning("reel_parse_error", reel_id=reel.get("id"), error=str(e))
                continue
        
        logger.info("user_reels_collected",
            user_ig_id=user_ig_id,
            total_reels=len(reels),
            recent_reels=len(recent_reels)
        )
        return recent_reels

    async def check_token_health(self, access_token: str) -> dict:
        """Token'ın geçerliliğini ve kalan süresini kontrol et"""
        url = f"{self.base_url}/debug_token"
        params = {
            "input_token": access_token,
            "access_token": access_token,
        }
        try:
            data = await self._api_call(url, params)
            token_data = data.get("data", {})
            return {
                "valid": token_data.get("is_valid", False),
                "expires_at": token_data.get("data_access_expires_at", 0),
                "scopes": token_data.get("scopes", []),
            }
        except Exception:
            return {"valid": False, "expires_at": 0, "scopes": []}

    async def get_reel_insights(self, reel_id: str, access_token: str) -> dict | None:
        """Tek bir reel'in güncel metriklerini çek (snapshot için)"""
        try:
            insights = await self.get_media_insights(reel_id, access_token)
            if not insights:
                return None
            return {
                "view_count": insights.get("plays", 0),
                "like_count": insights.get("likes", 0),
                "comment_count": insights.get("comments", 0),
                "save_count": insights.get("saved", 0),
                "share_count": insights.get("shares", 0),
                "reach": insights.get("reach", 0),
            }
        except Exception as e:
            logger.warning("reel_insights_failed", reel_id=reel_id, error=str(e))
            return None
