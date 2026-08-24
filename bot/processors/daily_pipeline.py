"""
Bot Günlük Pipeline — Ana İş Akışı
04:00'da çalışır: token health → veri topla → analiz → token hesapla → dağıt → rapor
Instagram + TikTok desteği, site içi bildirimler.
"""
import asyncio
from datetime import datetime, timezone
from decimal import Decimal

import asyncpg
import structlog

from config import read_secret, DRY_RUN, DATABASE_URL, POOL_WARNING_PERCENT
from collectors.instagram import InstagramCollector
from collectors.tiktok import TikTokCollector
from analyzers.rule_analyzer import RuleBasedAnalyzer
from analyzers.stat_analyzer import StatisticalAnalyzer
from analyzers.ai_analyzer import AIAnalyzer
from analyzers.view_tracker import ViewTracker
from analyzers.campaign_verifier import CampaignVerifier
from processors.token_calculator import TokenCalculator
from security.token_encryption import decrypt_token

logger = structlog.get_logger()


class DailyPipeline:
    """Günlük bot döngüsü — Instagram + TikTok"""

    def __init__(self):
        self.ig_collector = InstagramCollector()
        self.tt_collector = TikTokCollector()
        self.rule_analyzer = RuleBasedAnalyzer()
        self.stat_analyzer = StatisticalAnalyzer()
        self.view_tracker = ViewTracker()
        self.campaign_verifier = CampaignVerifier()
        self.calculator = TokenCalculator()
        self.db: asyncpg.Connection | None = None

        # AI Analyzer — OpenAI key varsa aktif, yoksa fallback
        try:
            openai_key = read_secret("openai_api_key")
        except Exception:
            openai_key = ""
        self.ai_analyzer = AIAnalyzer(api_key=openai_key)

    async def setup(self):
        """Bağlantıları kur + DB'den ayarları oku"""
        self.db = await asyncpg.connect(DATABASE_URL)

        # ★ FIX L1: TokenCalculator'ı DB ayarlarıyla yapılandır
        try:
            # system_settings'ten oku
            settings = await self.db.fetch(
                "SELECT key, value FROM system_settings WHERE key IN "
                "('token_per_view', 'daily_cap', 'min_authenticity_score')"
            )
            settings_map = {r["key"]: r["value"] for r in settings}

            # En güncel formül versiyonunu çek
            formula = await self.db.fetchrow(
                "SELECT version, base_rate, daily_cap, min_authenticity_score "
                "FROM formula_versions WHERE effective_from <= NOW() "
                "AND (effective_until IS NULL OR effective_until > NOW()) "
                "ORDER BY effective_from DESC LIMIT 1"
            )

            base_rate = float(settings_map.get("token_per_view", formula["base_rate"] if formula else 0.01))
            daily_cap = float(settings_map.get("daily_cap", formula["daily_cap"] if formula else 500))
            min_auth = float(settings_map.get("min_authenticity_score", formula["min_authenticity_score"] if formula else 70))
            formula_version = formula["version"] if formula else "v1"

            self.calculator = TokenCalculator(
                base_rate=base_rate,
                daily_cap=daily_cap,
                min_authenticity=min_auth,
                formula_version=formula_version,
            )
            logger.info("calculator_configured",
                base_rate=base_rate, daily_cap=daily_cap,
                min_auth=min_auth, formula=formula_version,
            )
        except Exception as e:
            logger.warning("calculator_config_fallback", error=str(e),
                           hint="DB ayarları okunamadı — default değerler kullanılıyor")
            self.calculator = TokenCalculator()

    async def teardown(self):
        """Bağlantıları kapat"""
        await self.ig_collector.close()
        await self.tt_collector.close()
        if self.db:
            await self.db.close()

    async def _notify_admins(self, title: str, message: str,
                              notif_type: str = "info", link: str = None):
        """Admin kullanıcılarına site bildirimi gönder"""
        if not self.db:
            return
        admin_ids = await self.db.fetch(
            "SELECT id FROM users WHERE role IN ('admin', 'super_admin') AND is_active = true"
        )
        for admin in admin_ids:
            await self.db.execute(
                "INSERT INTO notifications (user_id, type, title, message, link) "
                "VALUES ($1, $2, $3, $4, $5)",
                admin["id"], notif_type, title, message, link
            )

    async def _notify_user(self, user_id, title: str, message: str,
                            notif_type: str = "info", link: str = None):
        """Kullanıcıya site bildirimi gönder"""
        if not self.db:
            return
        await self.db.execute(
            "INSERT INTO notifications (user_id, type, title, message, link) "
            "VALUES ($1, $2, $3, $4, $5)",
            user_id, notif_type, title, message, link
        )

    async def _refresh_tiktok_token(self, user, enc_key: str) -> str | None:
        """★ FIX BULGU-3: Süresi dolan TikTok access_token'ı refresh_token ile yenile.
        Returns: yeni access_token veya None (başarısız)
        """
        import httpx
        from security.token_encryption import encrypt_token

        if not user.get("tiktok_refresh_token_enc"):
            logger.warning("tt_no_refresh_token", user=user["full_name"])
            return None

        try:
            # Refresh token'ı decrypt
            refresh_token = decrypt_token(
                user["tiktok_refresh_token_enc"],
                user["tiktok_refresh_iv"],
                enc_key,
            )

            # TikTok API'den yeni access_token al
            client_key = os.getenv("TIKTOK_CLIENT_KEY", "")
            client_secret = read_secret("tiktok_client_secret")

            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://open.tiktokapis.com/v2/oauth/token/",
                    data={
                        "client_key": client_key,
                        "client_secret": client_secret,
                        "grant_type": "refresh_token",
                        "refresh_token": refresh_token,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            new_access = data.get("access_token")
            new_refresh = data.get("refresh_token")
            expires_in = data.get("expires_in", 86400)

            if not new_access:
                return None

            # Yeni token'ları şifrele ve DB'ye yaz
            access_enc, access_iv = encrypt_token(new_access, enc_key)
            refresh_enc, refresh_iv = encrypt_token(new_refresh or refresh_token, enc_key)

            from datetime import timedelta
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

            await self.db.execute(
                "UPDATE users SET "
                "tiktok_token_enc = $1, tiktok_token_iv = $2, "
                "tiktok_token_expires = $3, "
                "tiktok_refresh_token_enc = $4, tiktok_refresh_iv = $5 "
                "WHERE id = $6",
                access_enc, access_iv, expires_at,
                refresh_enc, refresh_iv, user["id"],
            )

            logger.info("tt_token_refreshed", user=user["full_name"], expires_at=expires_at.isoformat())
            return new_access

        except Exception as e:
            logger.error("tt_refresh_error", user=user["full_name"], error=str(e))
            return None

    async def _process_platform_data(self, user, platform: str,
                                      reels: list[dict], enc_key: str,
                                      report: dict):
        """Tek bir platform için veri analiz + token hesaplama (Instagram veya TikTok)
        
        Akış:
        1. Aktif kampanyaları çek
        2. Her video → kampanya doğrulama (etiket + süre + keyword + pixel)
        3. Eşleşen videolar → authenticity analizi → token hesapla
        4. Eşleşmeyenler → logla, ödeme yapma
        """
        if not reels:
            return 0.0, []

        # ═══ Aktif kampanyaları çek ═══
        active_campaigns = []
        try:
            rows = await self.db.fetch(
                "SELECT id, title, brand_name, brand_account, platform, "
                "description, keywords, reference_url, reference_thumbnail, "
                "reference_duration_sec, reference_phash "
                "FROM campaigns WHERE status = 'active' "
                "AND (end_date IS NULL OR end_date > NOW())"
            )
            active_campaigns = [dict(r) for r in rows]
        except Exception as e:
            logger.warning("campaigns_fetch_failed", error=str(e))

        if not active_campaigns:
            logger.info("no_active_campaigns", message="Aktif kampanya yok — videolar işlenmeyecek")
            # Kampanya yoksa hiçbir videoya ödeme yapma
            report["skipped_no_campaign"] = len(reels)
            return 0.0, []

        # ═══ Kullanıcının geçmiş verilerini çek (stat_analyzer için) ═══
        user_history = []
        try:
            rows = await self.db.fetch(
                "SELECT view_count, like_count, comment_count, save_count, "
                "share_count, reach, engagement_rate "
                "FROM instagram_data WHERE user_id = $1 AND platform = $2 "
                "AND snapshot_number = 1 "
                "ORDER BY collected_at DESC LIMIT 30",
                user["id"], platform
            )
            user_history = [dict(r) for r in rows]
        except Exception:
            pass

        analyzed_reels = []
        for reel in reels:
            follower_count = reel.get("follower_count", 0)

            # ═══ KAMPANYA DOĞRULAMA ═══
            campaign_result = await self.campaign_verifier.find_matching_campaign(
                reel, active_campaigns, str(user["id"]), self.db
            )

            if not campaign_result or not campaign_result["is_valid"]:
                # Kampanya eşleşmedi → kişisel video → ATLA
                reason = campaign_result["rejection_reason"] if campaign_result else "Hiçbir kampanyayla eşleşmedi"
                logger.info("reel_skipped",
                    reel_id=reel["reel_id"],
                    platform=platform,
                    reason=reason,
                )
                report["skipped_no_campaign"] = report.get("skipped_no_campaign", 0) + 1
                continue

            # ═══ Kampanya eşleşti — analiz ve ödeme süreci ═══
            matched_campaign_id = campaign_result["matched_campaign_id"]
            reel["campaign_id"] = matched_campaign_id  # ★ Açıkça ata — scope leak önlemi

            # Level 1: Rule-based (dinamik eşikler)
            # ★ FIX O6/O7: is_campaign=True → reklam engagement cezası atla
            rule_result = self.rule_analyzer.analyze(reel, platform=platform, follower_count=follower_count, is_campaign=True)
            reel.update(rule_result)

            # Level 2: İstatistiksel (geçmişe göre z-score)
            stat_result = self.stat_analyzer.analyze(reel, user_history)
            stat_adjustment = stat_result.get("score_adjustment", 0)

            # Level 3: AI analizi
            ai_result = await self.ai_analyzer.analyze(reel)
            reel.update(ai_result)

            # Skor birleştirme
            combined = self.view_tracker.combine_all_scores(
                rule_score=rule_result["authenticity_score"],
                stat_adjustment=stat_adjustment,
                ai_score=ai_result.get("ai_score"),
                growth_curve_score=None,
            )
            reel["authenticity_score"] = combined["final_score"]
            reel["is_authentic"] = combined["is_authentic"]
            reel["analysis_level"] = combined["analysis_level"]

            if rule_result["flagged"]:
                report["flagged"] += 1

            analyzed_reels.append(reel)

            # DB'ye kaydet (kampanya bilgileriyle)
            await self.db.execute(
                "INSERT INTO instagram_data "
                "(user_id, platform, reel_id, reel_url, source, snapshot_number, "
                "view_count, like_count, comment_count, save_count, share_count, "
                "reach, follower_count, engagement_rate, "
                "analysis_level, authenticity_score, is_authentic, flagged, flag_reasons, "
                "ai_score, ai_risk, ai_reason, ai_source, "
                "campaign_id, campaign_verified, tag_found, content_match_score) "
                "VALUES ($1,$2,$3,$4,'api',1,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,"
                "$18,$19,$20,$21,$22,$23,$24,$25)",
                user["id"], platform, reel["reel_id"], reel["reel_url"],
                reel["view_count"], reel["like_count"], reel["comment_count"],
                reel["save_count"], reel["share_count"], reel["reach"],
                follower_count,
                reel.get("engagement_rate", 0), combined["analysis_level"],
                combined["final_score"], combined["is_authentic"],
                rule_result["flagged"], str(reel.get("flag_reasons", [])),
                ai_result.get("ai_score"), ai_result.get("ai_risk"),
                ai_result.get("ai_reason"), ai_result.get("ai_source"),
                matched_campaign_id, True,
                campaign_result["checks"]["tag_found"],
                campaign_result["hybrid_score"],
            )

        report["total_reels"] += len(analyzed_reels)

        if not analyzed_reels:
            return 0.0, []

        # ★ FIX BULGU-1: Scope leak kaldırıldı — campaign_id olmayan reel ödeme almaz
        # (Eski kod: son matched_campaign_id'yi atıyordu → kişisel videolar yanlış kampanyaya yazılırdı)
        analyzed_reels = [r for r in analyzed_reels if r.get("campaign_id")]

        # Token hesapla — ★ FIX L2: Tek platform için hesapla, cap run() seviyesinde uygulanacak
        # (calculate yerine tek tek hesapla, cap uygulamadan)
        reel_tokens = []
        for reel in analyzed_reels:
            result = self.calculator.calculate(reel)
            reel["tokens"] = result["tokens"]
            reel_tokens.append(result)

        platform_total = sum(float(r["tokens"]) for r in reel_tokens)

        # ═══ Kampanya ödemelerini kaydet (tek seferlik) ═══
        # ★ FIX L8: reel başına token yaz (toplam değil)
        # ★ FIX L9: UNIQUE (campaign_id, user_id, reel_id) — aynı reel bir kez
        for reel in analyzed_reels:
            if reel.get("authenticity_score", 0) >= 70:
                try:
                    await self.db.execute(
                        "INSERT INTO campaign_payments "
                        "(campaign_id, user_id, reel_id, platform, tokens_paid, verification_result) "
                        "VALUES ($1, $2, $3, $4, $5, $6) "
                        "ON CONFLICT (campaign_id, user_id, reel_id) DO NOTHING",
                        reel["campaign_id"],
                        user["id"], reel["reel_id"], platform,
                        float(reel.get("tokens", 0)),
                        str(campaign_result),
                    )
                except Exception as e:
                    logger.warning("campaign_payment_save_failed", error=str(e))

        return platform_total, analyzed_reels

    async def run(self) -> dict:
        """Ana pipeline"""
        run_start = datetime.now(timezone.utc)
        report = {
            "date": run_start.isoformat(),
            "total_users": 0,
            "successful": 0,
            "failed": 0,
            "total_reels": 0,
            "tokens_distributed": 0.0,
            "flagged": 0,
            "pool_balance": 0.0,
            "errors": [],
        }

        try:
            await self.setup()
            logger.info("pipeline_started", dry_run=DRY_RUN)

            # 1. Bot run kaydı oluştur
            bot_run_id = await self.db.fetchval(
                "INSERT INTO bot_runs (started_at, status) VALUES ($1, 'running') RETURNING id",
                run_start,
            )

            # 2. Aktif kullanıcıları çek (Instagram VE TikTok bağlı — zorunlu)
            users = await self.db.fetch(
                "SELECT id, full_name, "
                "instagram_user_id, instagram_token_enc, instagram_token_iv, "
                "tiktok_user_id, tiktok_token_enc, tiktok_token_iv, "
                "tiktok_refresh_token_enc, tiktok_refresh_iv, "
                "encryption_key_version "
                "FROM users WHERE is_active = true "
                "AND instagram_token_enc IS NOT NULL "
                "AND tiktok_token_enc IS NOT NULL"
            )
            report["total_users"] = len(users)
            logger.info("users_found", count=len(users))

            # 3. Encryption key
            enc_key = read_secret("encryption_key")

            # 3b. Aktif formül versiyonunu DB'den çek
            active_formula = await self.db.fetchval(
                "SELECT version FROM formula_versions "
                "WHERE effective_from <= NOW() "
                "AND (effective_until IS NULL OR effective_until > NOW()) "
                "ORDER BY effective_from DESC LIMIT 1"
            ) or "v1"
            logger.info("active_formula", version=active_formula)

            # 4. Her kullanıcı için pipeline
            for user in users:
                try:
                    ig_platform_tokens = 0.0
                    tt_platform_tokens = 0.0

                    # ── Instagram ──
                    if user["instagram_token_enc"]:
                        try:
                            ig_token = decrypt_token(
                                user["instagram_token_enc"],
                                user["instagram_token_iv"],
                                enc_key,
                            )
                            ig_reels = await self.ig_collector.collect_user_reels(
                                user["instagram_user_id"], ig_token
                            )
                            ig_platform_tokens, ig_analyzed = await self._process_platform_data(
                                user, "instagram", ig_reels, enc_key, report
                            )
                        except Exception as e:
                            logger.warning("ig_failed", user=user["full_name"], error=str(e))
                            report["errors"].append(f"IG-{user['full_name']}: {str(e)}")

                    # ── TikTok ──
                    if user["tiktok_token_enc"]:
                        try:
                            tt_token = decrypt_token(
                                user["tiktok_token_enc"],
                                user["tiktok_token_iv"],
                                enc_key,
                            )

                            # ★ FIX BULGU-3: Token geçerliliğini kontrol et, gerekirse refresh
                            health = await self.tt_collector.check_token_health(tt_token)
                            if not health["valid"]:
                                logger.info("tt_token_expired_refreshing", user=user["full_name"])
                                tt_token = await self._refresh_tiktok_token(user, enc_key)
                                if not tt_token:
                                    logger.warning("tt_refresh_failed", user=user["full_name"])
                                    report["errors"].append(f"TT-REFRESH-{user['full_name']}: Token yenilenemedi")
                                    raise Exception("TikTok token yenilenemedi — kullanıcının tekrar bağlaması gerekli")

                            tt_videos = await self.tt_collector.collect_user_videos(tt_token)
                            tt_platform_tokens, tt_analyzed = await self._process_platform_data(
                                user, "tiktok", tt_videos, enc_key, report
                            )
                        except Exception as e:
                            logger.warning("tt_failed", user=user["full_name"], error=str(e))
                            report["errors"].append(f"TT-{user['full_name']}: {str(e)}")

                    # ═══ ZORUNLU PLATFORM KONTROLÜ ═══
                    # Her iki platform da bağlı olmalı — eksik platform varsa atla
                    if not user["instagram_token_enc"] or not user["tiktok_token_enc"]:
                        logger.info("user_skipped_missing_platform",
                            user=user["full_name"],
                            has_ig=bool(user["instagram_token_enc"]),
                            has_tt=bool(user["tiktok_token_enc"]),
                        )
                        report["skipped_missing_platform"] = report.get("skipped_missing_platform", 0) + 1
                        continue

                    # ═══ ÖDEME HESAPLAMA: IG + TT TOPLAM + DAILY CAP ═══
                    total_tokens = ig_platform_tokens + tt_platform_tokens

                    # Daily cap uygula
                    daily_cap = float(self.calculator.daily_cap)
                    capped = False
                    if total_tokens > daily_cap:
                        total_tokens = daily_cap
                        capped = True

                    logger.info("token_calculated",
                        user=user["full_name"],
                        ig=ig_platform_tokens, tt=tt_platform_tokens,
                        total=total_tokens, capped=capped,
                    )

                    # ── Birleşik token dağıtımı ──
                    if total_tokens > 0 and not DRY_RUN:
                        token_decimal = Decimal(str(round(total_tokens, 2)))

                        # Atomik transaction — balance + transaction + pool
                        async with self.db.transaction():
                            await self.db.execute(
                                "UPDATE balances SET available = available + $1, "
                                "total_earned = total_earned + $1 WHERE user_id = $2",
                                token_decimal, user["id"],
                            )

                            desc = f"Günlük performans (IG:{ig_platform_tokens:.2f} + TT:{tt_platform_tokens:.2f})"

                            await self.db.execute(
                                "INSERT INTO transactions (user_id, type, amount, description, formula_version) "
                                "VALUES ($1, 'earn', $2, $3, $4)",
                                user["id"], token_decimal,
                                desc,
                                active_formula,
                            )
                            # Havuzdan düş
                            await self.db.execute(
                                "INSERT INTO pool (action, amount, running_balance, description, admin_id) "
                                "VALUES ('distribution', $1, 0, $2, NULL)",
                                token_decimal,
                                f"Günlük dağıtım — {user['full_name']}",
                            )

                        report["tokens_distributed"] += total_tokens

                        # Kullanıcıya bildirim
                        await self._notify_user(
                            user["id"],
                            "💰 Token Kazandınız!",
                            f"Bugünkü performansınızdan {total_tokens:.2f} TOKEN kazandınız."
                            + (f" (Günlük limit uygulandı)" if capped else ""),
                            "success",
                            "/dashboard"
                        )

                    report["successful"] += 1
                    logger.info("user_processed",
                        user=user["full_name"],
                        tokens=total_tokens,
                        capped=capped,
                    )

                except Exception as e:
                    report["failed"] += 1
                    report["errors"].append(f"{user['full_name']}: {str(e)}")
                    logger.error("user_failed", user=user["full_name"], error=str(e))

                # Rate limiting
                await asyncio.sleep(1)

            # 5. Havuz bakiyesini kontrol et
            pool_balance = await self.db.fetchval(
                "SELECT running_balance FROM pool ORDER BY created_at DESC LIMIT 1"
            ) or 0
            report["pool_balance"] = float(pool_balance)

            # 6. Bot run kaydını güncelle
            await self.db.execute(
                "UPDATE bot_runs SET completed_at = $1, status = $2, "
                "total_users = $3, successful_users = $4, failed_users = $5, "
                "total_reels_analyzed = $6, total_tokens_distributed = $7, "
                "flagged_count = $8, pool_balance_after = $9 "
                "WHERE id = $10",
                datetime.now(timezone.utc),
                "completed" if report["failed"] == 0 else "partial",
                report["total_users"], report["successful"], report["failed"],
                report["total_reels"], report["tokens_distributed"],
                report["flagged"], report["pool_balance"], bot_run_id,
            )

            # 7. Admin bildirimler (site üzerinden)
            await self._notify_admins(
                "📊 Günlük Bot Raporu",
                f"👥 {report['total_users']} kullanıcı | "
                f"📱 {report['total_reels']} video | "
                f"💰 {report['tokens_distributed']:.2f} TOKEN | "
                f"⚠️ {report['flagged']} flagged",
                "info",
                "/admin"
            )

            # Havuz uyarısı
            if pool_balance > 0 and pool_balance < 5000:
                await self._notify_admins(
                    "🔴 Havuz Bakiyesi Düşük!",
                    f"Mevcut bakiye: {float(pool_balance):.2f} ₺ — Acil para eklenmeli.",
                    "warning",
                    "/admin/pool"
                )

            logger.info("pipeline_completed", report=report)

        except Exception as e:
            logger.error("pipeline_critical_error", error=str(e))
            report["errors"].append(f"CRITICAL: {str(e)}")
            try:
                await self._notify_admins(
                    "🔴 Bot Kritik Hata",
                    f"Pipeline çöktü: {str(e)[:300]}",
                    "error"
                )
            except Exception:
                pass

        finally:
            await self.teardown()

        return report
