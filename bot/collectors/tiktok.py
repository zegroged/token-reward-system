"""
TikTok Display API — Veri Toplama Modülü
OAuth token ile kullanıcının video metriklerini çeker.
Circuit breaker + retry + rate limit koruması.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from config import CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_RESET_TIMEOUT

logger = structlog.get_logger()


# Instagram collector'daki CircuitBreaker'ı yeniden kullanıyoruz
from collectors.instagram import CircuitBreaker


class TikTokCollector:
    """TikTok Display API üzerinden video veri toplama"""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30)
        self.circuit = CircuitBreaker()
        self.base_url = "https://open.tiktokapis.com/v2"

    async def close(self):
        await self.client.aclose()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
    )
    async def _api_call(self, url: str, access_token: str, method: str = "GET",
                        params: dict = None, json_body: dict = None) -> dict:
        """TikTok API çağrısı — retry + circuit breaker"""
        if not self.circuit.can_proceed():
            raise Exception("Circuit breaker açık — TikTok API istekleri durduruldu")

        try:
            headers = {"Authorization": f"Bearer {access_token}"}

            if method == "POST":
                response = await self.client.post(url, headers=headers, json=json_body or {})
            else:
                response = await self.client.get(url, headers=headers, params=params or {})

            response.raise_for_status()
            self.circuit.record_success()
            return response.json()
        except Exception as e:
            self.circuit.record_failure()
            raise

    async def get_user_videos(self, access_token: str, cursor: int = 0, max_count: int = 20) -> dict:
        """Kullanıcının videolarını çek — TikTok Display API v2"""
        url = f"{self.base_url}/video/list/"
        params = {
            "fields": "id,title,create_time,share_url,duration,cover_image_url,like_count,comment_count,share_count,view_count",
        }
        json_body = {
            "max_count": max_count,
        }
        if cursor:
            json_body["cursor"] = cursor

        data = await self._api_call(url, access_token, method="POST",
                                     params=params, json_body=json_body)
        return data

    async def get_follower_count(self, access_token: str) -> int:
        """Kullanıcının takipçi sayısını çek"""
        try:
            url = f"{self.base_url}/user/info/"
            params = {"fields": "open_id,follower_count"}
            data = await self._api_call(url, access_token, params=params)
            count = data.get("data", {}).get("user", {}).get("follower_count", 0)
            logger.info("tiktok_follower_count_fetched", followers=count)
            return count
        except Exception as e:
            logger.warning("tiktok_follower_count_failed", error=str(e))
            return 0

    async def collect_user_videos(self, access_token: str, since_hours: int = 30) -> list[dict]:
        """
        Kullanıcının son 30 saatteki videolarını topla + metrikleri çek.
        Bot her gece 04:00'da çalıştığında önceki günün verilerini alır.
        """
        result = await self.get_user_videos(access_token)

        # Takipçi sayısını çek
        follower_count = await self.get_follower_count(access_token)

        videos_data = result.get("data", {}).get("videos", [])
        cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)

        recent_videos = []
        for video in videos_data:
            try:
                # TikTok create_time Unix timestamp
                create_time = video.get("create_time", 0)
                video_time = datetime.fromtimestamp(create_time, tz=timezone.utc)

                if video_time >= cutoff:
                    recent_videos.append({
                        "reel_id": str(video.get("id", "")),
                        "reel_url": video.get("share_url", ""),
                        "timestamp": video_time.isoformat(),
                        "caption": video.get("title", ""),
                        "view_count": video.get("view_count", 0),
                        "like_count": video.get("like_count", 0),
                        "comment_count": video.get("comment_count", 0),
                        "save_count": 0,  # TikTok API'de save_count doğrudan yok
                        "share_count": video.get("share_count", 0),
                        "reach": 0,  # TikTok Display API'de reach yok
                        "impressions": 0,
                        "follower_count": follower_count,
                        "platform": "tiktok",
                        "thumbnail_url": video.get("cover_image_url", ""),
                        "duration": video.get("duration", 0),
                    })

                    # Rate limiting
                    await asyncio.sleep(0.3)
            except (ValueError, KeyError) as e:
                logger.warning("tiktok_video_parse_error",
                               video_id=video.get("id"), error=str(e))
                continue

        logger.info("tiktok_videos_collected",
                    total_videos=len(videos_data),
                    recent_videos=len(recent_videos))
        return recent_videos

    async def check_token_health(self, access_token: str) -> dict:
        """Token'ın geçerliliğini kontrol et — basit kullanıcı bilgisi çekerek"""
        try:
            url = f"{self.base_url}/user/info/"
            params = {"fields": "open_id,display_name"}
            data = await self._api_call(url, access_token, params=params)
            user_data = data.get("data", {}).get("user", {})
            return {
                "valid": bool(user_data.get("open_id")),
                "display_name": user_data.get("display_name", ""),
            }
        except Exception:
            return {"valid": False, "display_name": ""}

    async def get_video_stats(self, video_id: str, access_token: str) -> dict | None:
        """Tek bir videonun güncel metriklerini çek (snapshot için)"""
        try:
            url = f"{self.base_url}/video/query/"
            params = {
                "fields": "id,view_count,like_count,comment_count,share_count",
            }
            json_body = {
                "filters": {
                    "video_ids": [video_id],
                },
            }
            data = await self._api_call(url, access_token, method="POST",
                                         params=params, json_body=json_body)
            videos = data.get("data", {}).get("videos", [])
            if not videos:
                return None
            v = videos[0]
            return {
                "view_count": v.get("view_count", 0),
                "like_count": v.get("like_count", 0),
                "comment_count": v.get("comment_count", 0),
                "share_count": v.get("share_count", 0),
            }
        except Exception as e:
            logger.warning("tiktok_video_stats_failed", video_id=video_id, error=str(e))
            return None
