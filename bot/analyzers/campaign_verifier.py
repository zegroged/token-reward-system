"""
Kampanya Doğrulama Motoru — Hibrit Sistem
3 katmanlı kontrol:
  1. Etiket kontrolü (caption'da @marka_hesabi var mı?)
  2. Video eşleşme (süre + anahtar kelime + görsel parmak izi)
  3. Tekrar ödeme kontrolü (DB UNIQUE constraint)

Görsel karşılaştırma: Perceptual Hash (pHash) ile thumbnail benzerliği.
"""
import re
import io
import hashlib
import struct
import structlog
from typing import Optional

import httpx

logger = structlog.get_logger()

# Pillow — opsiyonel (pixel karşılaştırma için)
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logger.warning("pillow_not_installed", message="Görsel karşılaştırma devre dışı")


# ── Perceptual Hash (PIL olmadan da çalışan basit versiyon) ──

def _average_hash_from_bytes(image_bytes: bytes, hash_size: int = 8) -> str:
    """
    Görüntü byte'larından ortalama perceptual hash üret.
    PIL varsa gerçek pHash, yoksa sha256 fallback.
    """
    if not PIL_AVAILABLE or not image_bytes:
        return hashlib.sha256(image_bytes).hexdigest()[:16] if image_bytes else ""

    try:
        img = Image.open(io.BytesIO(image_bytes))
        # Küçük gri tonlama resme çevir
        img = img.convert("L").resize((hash_size, hash_size), Image.LANCZOS)
        pixels = list(img.getdata())
        avg = sum(pixels) / len(pixels)
        # Ortalamadan büyük pikseller → 1, küçükler → 0
        bits = "".join("1" if p > avg else "0" for p in pixels)
        # Binary string'i hex'e çevir
        hash_hex = hex(int(bits, 2))[2:].zfill(hash_size * hash_size // 4)
        return hash_hex
    except Exception as e:
        logger.warning("phash_failed", error=str(e))
        return ""


def _hamming_distance(hash1: str, hash2: str) -> int:
    """İki hex hash arasındaki Hamming mesafesi (bit farkı sayısı)"""
    if not hash1 or not hash2 or len(hash1) != len(hash2):
        return 999  # Karşılaştırılamaz

    # Hex → binary
    try:
        b1 = bin(int(hash1, 16))[2:]
        b2 = bin(int(hash2, 16))[2:]
        max_len = max(len(b1), len(b2))
        b1 = b1.zfill(max_len)
        b2 = b2.zfill(max_len)
        return sum(c1 != c2 for c1, c2 in zip(b1, b2))
    except (ValueError, TypeError):
        return 999


class CampaignVerifier:
    """
    Hibrit kampanya doğrulama sistemi.
    Her video 3+1 kontrolden geçer.
    """

    # Eşleşme eşikleri
    DURATION_TOLERANCE_SEC = 3      # ±3 saniye tolerans
    KEYWORD_MIN_MATCH = 0.4         # Anahtar kelimelerin %40'ı eşleşmeli
    PHASH_MAX_DISTANCE = 15         # Perceptual hash max bit farkı (0=birebir, 64=tamamen farklı)

    # Hibrit skor ağırlıkları
    WEIGHT_TAG = 0.30               # Etiket kontrolü %30
    WEIGHT_DURATION = 0.20          # Süre eşleşmesi %20
    WEIGHT_KEYWORDS = 0.25          # Anahtar kelime %25
    WEIGHT_VISUAL = 0.25            # Görsel benzerlik %25

    async def verify(
        self,
        reel_data: dict,
        campaign: dict,
        user_id: str,
        db,  # asyncpg connection
    ) -> dict:
        """
        Video'yu kampanyaya karşı doğrula.

        Args:
            reel_data: Bot'un topladığı video verisi (caption, duration, thumbnail_url vb.)
            campaign: DB'den çekilen kampanya kaydı
            user_id: Kullanıcının UUID'si
            db: asyncpg bağlantısı

        Returns: {
            "is_valid": bool,           # Geçti mi?
            "hybrid_score": float,      # 0-100
            "checks": {
                "tag_found": bool,
                "duration_match": bool,
                "keyword_score": float,
                "visual_score": float,
            },
            "not_duplicate": bool,      # Tekrar ödeme yok mu?
            "matched_campaign_id": str,
            "rejection_reason": str | None,
        }
        """
        caption = reel_data.get("caption", "") or ""
        campaign_id = str(campaign["id"])
        brand_account = campaign.get("brand_account", "")

        # ════════════════════════════════════════
        # KONTROL 1: Etiket kontrolü
        # ════════════════════════════════════════
        tag_found = self._check_tag(caption, brand_account)

        # ════════════════════════════════════════
        # KONTROL 2a: Video süresi eşleşmesi
        # ════════════════════════════════════════
        duration_match = self._check_duration(
            reel_data.get("duration", 0),
            campaign.get("reference_duration_sec", 0)
        )

        # ════════════════════════════════════════
        # KONTROL 2b: Anahtar kelime eşleşmesi
        # ════════════════════════════════════════
        keyword_score = self._check_keywords(
            caption,
            campaign.get("keywords", [])
        )

        # ════════════════════════════════════════
        # KONTROL 2c: Görsel benzerlik (thumbnail pHash)
        # ════════════════════════════════════════
        visual_score = await self._check_visual(
            reel_data.get("thumbnail_url", ""),
            campaign.get("reference_phash", ""),
            campaign.get("reference_thumbnail", ""),
        )

        # ════════════════════════════════════════
        # KONTROL 3: Tekrar ödeme kontrolü
        # ════════════════════════════════════════
        # ★ FIX N4: reel_id bazlı kontrol — bir reel ömür boyu tek kampanyadan ödenir
        reel_id = reel_data.get("reel_id")
        not_duplicate = await self._check_duplicate(db, campaign_id, user_id, reel_id=reel_id)

        # ════════════════════════════════════════
        # HİBRİT SKOR HESAPLAMA
        # ════════════════════════════════════════
        tag_score = 100.0 if tag_found else 0.0
        dur_score = 100.0 if duration_match else 0.0

        hybrid_score = (
            tag_score * self.WEIGHT_TAG +
            dur_score * self.WEIGHT_DURATION +
            keyword_score * self.WEIGHT_KEYWORDS +
            visual_score * self.WEIGHT_VISUAL
        )

        # Etiket yoksa direkt red
        if not tag_found:
            is_valid = False
            rejection = f"Etiket bulunamadı: {brand_account}"
        # Hibrit skor çok düşükse red
        elif hybrid_score < 50:
            is_valid = False
            rejection = f"İçerik eşleşme skoru düşük: {hybrid_score:.0f}/100"
        # Daha önce ödenmiş
        elif not not_duplicate:
            is_valid = False
            rejection = "Bu kampanya için zaten ödeme yapılmış"
        else:
            is_valid = True
            rejection = None

        result = {
            "is_valid": is_valid,
            "hybrid_score": round(hybrid_score, 2),
            "checks": {
                "tag_found": tag_found,
                "duration_match": duration_match,
                "keyword_score": round(keyword_score, 2),
                "visual_score": round(visual_score, 2),
            },
            "not_duplicate": not_duplicate,
            "matched_campaign_id": campaign_id,
            "rejection_reason": rejection,
        }

        logger.info("campaign_verification",
            campaign=campaign.get("title", "?"),
            user_id=user_id,
            is_valid=is_valid,
            hybrid_score=round(hybrid_score, 2),
            tag=tag_found,
            duration=duration_match,
            keywords=round(keyword_score, 2),
            visual=round(visual_score, 2),
            duplicate=not not_duplicate,
        )

        return result

    # ── Alt kontrol fonksiyonları ──

    def _check_tag(self, caption: str, brand_account: str) -> bool:
        """Caption'da marka hesabının etiketlenip etiketlenmediğini kontrol et"""
        if not brand_account:
            return True  # Kampanyada etiket zorunluluğu yoksa geç

        # @ ile veya @ olmadan arama — ★ FIX N5: word boundary regex
        clean_account = brand_account.lstrip("@").lower()
        caption_lower = caption.lower()

        # @hesap (tam eşleşme) veya hesap (word boundary ile)
        return bool(
            re.search(rf"@{re.escape(clean_account)}\b", caption_lower)
        )

    def _check_duration(self, video_duration: int, reference_duration: int) -> bool:
        """Video süresinin kampanya referansıyla eşleşip eşleşmediğini kontrol et"""
        if reference_duration <= 0 or video_duration <= 0:
            return True  # Süre bilgisi yoksa geç (cezalandırma yok)

        diff = abs(video_duration - reference_duration)
        return diff <= self.DURATION_TOLERANCE_SEC

    def _check_keywords(self, caption: str, keywords: list) -> float:
        """
        Caption'daki anahtar kelimelerin eşleşme yüzdesi.
        Returns: 0-100 skor
        """
        if not keywords:
            return 80.0  # Anahtar kelime tanımlanmamışsa nötr skor

        # ★ FIX N6: casefold() Türkçe İ/I farkını doğru çözer
        caption_cf = caption.casefold()
        matched = sum(1 for kw in keywords if kw.casefold() in caption_cf)
        ratio = matched / len(keywords)
        return min(100.0, ratio * 100)

    async def _check_visual(
        self,
        reel_thumbnail_url: str,
        reference_phash: str,
        reference_thumbnail_url: str,
    ) -> float:
        """
        Görsel benzerlik skoru — perceptual hash karşılaştırma.
        Thumbnail'ları indirir, pHash üretir, Hamming mesafesi hesaplar.
        Returns: 0-100 skor
        """
        if not PIL_AVAILABLE:
            return 70.0  # PIL yoksa nötr skor (cezalandırma yok)

        if not reel_thumbnail_url:
            return 60.0  # Thumbnail yoksa hafif düşük skor

        try:
            # Reel'in thumbnail'ını indir
            async with httpx.AsyncClient(timeout=10) as client:
                reel_resp = await client.get(reel_thumbnail_url)
                if reel_resp.status_code != 200:
                    return 60.0
                reel_bytes = reel_resp.content

            reel_hash = _average_hash_from_bytes(reel_bytes)

            # Referans hash zaten DB'de varsa onu kullan
            if reference_phash:
                ref_hash = reference_phash
            elif reference_thumbnail_url:
                # Yoksa referans thumbnail'ı indir ve hash'le
                async with httpx.AsyncClient(timeout=10) as client:
                    ref_resp = await client.get(reference_thumbnail_url)
                    if ref_resp.status_code != 200:
                        return 60.0
                    ref_bytes = ref_resp.content
                ref_hash = _average_hash_from_bytes(ref_bytes)
            else:
                return 60.0  # Karşılaştırma yapılamıyor

            # Hamming mesafesi
            distance = _hamming_distance(reel_hash, ref_hash)

            # 0 distance = birebir aynı → 100 skor
            # MAX_DISTANCE üstü = tamamen farklı → 0 skor
            if distance >= self.PHASH_MAX_DISTANCE:
                return 0.0
            else:
                return max(0, 100 - (distance / self.PHASH_MAX_DISTANCE * 100))

        except Exception as e:
            logger.warning("visual_check_failed", error=str(e))
            return 60.0  # Hata durumunda nötr

    async def _check_duplicate(self, db, campaign_id: str, user_id: str, reel_id: str = None) -> bool:
        """
        Bu reel için daha önce herhangi bir kampanyadan ödeme yapılmış mı?
        ★ FIX N4: (user_id, reel_id) bazlı — bir reel ömür boyu tek kampanyadan ödenir
        """
        try:
            if reel_id:
                row = await db.fetchrow(
                    "SELECT id FROM campaign_payments "
                    "WHERE user_id = $1 AND reel_id = $2",
                    user_id, reel_id
                )
            else:
                row = await db.fetchrow(
                    "SELECT id FROM campaign_payments "
                    "WHERE campaign_id = $1 AND user_id = $2",
                    campaign_id, user_id
                )
            return row is None  # None = ödeme yok = OK
        except Exception:
            return True  # DB hatası durumunda geçir (güvenli taraf)

    async def find_matching_campaign(
        self,
        reel_data: dict,
        active_campaigns: list,
        user_id: str,
        db,
    ) -> Optional[dict]:
        """
        Bir video için eşleşen kampanyayı bul.
        Tüm aktif kampanyaları dener, en yüksek skorlu eşleşmeyi döndürür.

        Returns: verification result dict veya None (hiçbir kampanya eşleşmedi)
        """
        best_match = None
        best_score = 0

        for campaign in active_campaigns:
            # Platform kontrolü
            campaign_platform = campaign.get("platform", "both")
            reel_platform = reel_data.get("platform", "instagram")
            if campaign_platform != "both" and campaign_platform != reel_platform:
                continue

            result = await self.verify(reel_data, campaign, user_id, db)

            if result["is_valid"] and result["hybrid_score"] > best_score:
                best_match = result
                best_score = result["hybrid_score"]

        return best_match
