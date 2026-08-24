"""
Token Ödül Sistemi — Bot Ana Giriş Noktası
APScheduler ile:
  - Günlük 04:00 → Instagram + TikTok veri toplama, analiz, token dağıtım
  - Her 5 dakika → Onaylanmış çekim talepleri → USDT transfer
  - Her 5 dakika → Heartbeat
PostgreSQL job store ile kaçırılan görevler otomatik telafi edilir.
"""
import asyncio
import os
import signal
import sys
from datetime import datetime, timezone

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore

from config import (
    BOT_RUN_HOUR, BOT_RUN_MINUTE,
    HEARTBEAT_INTERVAL, DRY_RUN, LOG_LEVEL,
    DATABASE_URL, SNAPSHOT_INTERVAL_HOURS,
)

import logging

# Logging setup
structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(logging, LOG_LEVEL, logging.INFO)
    ),
)
logger = structlog.get_logger()


async def daily_run():
    """Günlük bot döngüsü — 04:00'da çalışır (Instagram + TikTok)"""
    logger.info("daily_run_started", time=datetime.now().isoformat(), dry_run=DRY_RUN)

    if DRY_RUN:
        logger.warning("dry_run_mode", message="DRY_RUN aktif — gerçek işlem yapılmayacak")

    try:
        from processors.daily_pipeline import DailyPipeline
        pipeline = DailyPipeline()
        report = await pipeline.run()
        logger.info("daily_run_completed", report=report)
    except Exception as e:
        logger.error("daily_run_failed", error=str(e))


async def snapshot_run():
    """Multi-snapshot veri toplama — her 2 saatte çalışır.
    
    Sadece izlenme/etkileşim verisi toplar, token hesaplamaz.
    Amaç: Büyüme eğrisi analizi için T+2h ve T+8h snapshot'ları oluşturmak.
    T+24h (snapshot_number=3) verisi daily_run içinde final olarak işlenir.
    """
    logger.info("snapshot_run_started", time=datetime.now(timezone.utc).isoformat())
    # ★ FIX N16: DRY_RUN modda gerçek API çağrısı yapma
    if DRY_RUN:
        logger.warning("snapshot_dry_run", message="DRY_RUN aktif — snapshot atlanıyor")
        return
    try:
        import asyncpg
        from config import DATABASE_URL, read_secret
        from security.token_encryption import decrypt_token
        from collectors.instagram import InstagramCollector
        from collectors.tiktok import TikTokCollector

        conn = await asyncpg.connect(DATABASE_URL)
        ig_collector = InstagramCollector()
        tt_collector = TikTokCollector()

        try:
            enc_key = read_secret("encryption_key")

            # Son 24 saatte snapshot_number=1 olarak kaydedilmiş reelleri bul
            # ve henüz snapshot_number=2 veya 3 yazılmamış olanları topla
            pending = await conn.fetch(
                """
                SELECT DISTINCT d.user_id, d.platform, d.reel_id,
                       d.snapshot_number, d.collected_at,
                       u.instagram_user_id, u.instagram_token_enc, u.instagram_token_iv,
                       u.tiktok_user_id, u.tiktok_token_enc, u.tiktok_token_iv
                FROM instagram_data d
                JOIN users u ON u.id = d.user_id
                WHERE d.snapshot_number = 1
                  AND d.collected_at > NOW() - INTERVAL '26 hours'
                  AND NOT EXISTS (
                      SELECT 1 FROM instagram_data d2
                      WHERE d2.user_id = d.user_id
                        AND d2.reel_id = d.reel_id
                        AND d2.platform = d.platform
                        AND d2.snapshot_number = 2
                  )
                  AND u.is_active = true
                LIMIT 100
                """
            )

            if not pending:
                logger.info("snapshot_no_pending", message="Snapshot bekleyen reel yok")
                return

            # Saatlik farka göre snapshot numarası belirle
            collected = 0
            for row in pending:
                hours_since = (datetime.now(timezone.utc) - row["collected_at"]).total_seconds() / 3600
                if hours_since < 1.5:
                    continue  # Çok erken — henüz T+2 olmadı
                snap_num = 2 if hours_since < 12 else 3

                try:
                    # Platform'a göre veri topla
                    view_count = 0
                    like_count = 0
                    comment_count = 0

                    if row["platform"] == "instagram" and row["instagram_token_enc"]:
                        token = decrypt_token(row["instagram_token_enc"], row["instagram_token_iv"], enc_key)
                        reel_data = await ig_collector.get_reel_insights(
                            row["reel_id"], token
                        )
                        if reel_data:
                            view_count = reel_data.get("view_count", 0)
                            like_count = reel_data.get("like_count", 0)
                            comment_count = reel_data.get("comment_count", 0)

                    elif row["platform"] == "tiktok" and row["tiktok_token_enc"]:
                        token = decrypt_token(row["tiktok_token_enc"], row["tiktok_token_iv"], enc_key)
                        video_data = await tt_collector.get_video_stats(
                            row["reel_id"], token
                        )
                        if video_data:
                            view_count = video_data.get("view_count", 0)
                            like_count = video_data.get("like_count", 0)
                            comment_count = video_data.get("comment_count", 0)

                    if view_count > 0:
                        await conn.execute(
                            """
                            INSERT INTO instagram_data
                                (user_id, platform, reel_id, snapshot_number, snapshot_at,
                                 view_count, like_count, comment_count, source, analysis_level)
                            VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, 'api', 'pending')
                            ON CONFLICT (user_id, platform, reel_id, snapshot_number)
                            WHERE reel_id IS NOT NULL AND user_id IS NOT NULL
                            DO NOTHING
                            """,
                            row["user_id"], row["platform"], row["reel_id"],
                            snap_num, view_count, like_count, comment_count,
                        )
                        collected += 1

                except Exception as e:
                    logger.warning("snapshot_reel_failed",
                                   reel_id=row["reel_id"], error=str(e))
                    continue

                await asyncio.sleep(0.5)  # Rate limit

            logger.info("snapshot_run_completed", collected=collected)

        finally:
            await ig_collector.close()
            await tt_collector.close()
            await conn.close()

    except Exception as e:
        logger.error("snapshot_run_failed", error=str(e))


async def process_withdrawals():
    """Onaylanmış çekim talepleri → USDT transfer (her 5 dakika)"""
    try:
        from processors.withdrawal_processor import run_withdrawal_processor
        await run_withdrawal_processor()
    except Exception as e:
        logger.error("withdrawal_processor_failed", error=str(e))


async def heartbeat():
    """Heartbeat — bot'un yaşadığını bildir + Redis key yaz (Docker healthcheck)"""
    logger.info("heartbeat", time=datetime.now(timezone.utc).isoformat(), status="alive")
    # ★ FIX N1+N14: redis.asyncio kullan; TTL = HEARTBEAT_INTERVAL * 3
    try:
        from redis.asyncio import Redis
        r = Redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379"))
        await r.set("bot:heartbeat", datetime.now(timezone.utc).isoformat(), ex=HEARTBEAT_INTERVAL * 3)
        await r.aclose()
    except Exception:
        # Redis yoksa sadece logla — heartbeat kritik değil
        pass


def _build_db_url_for_sqlalchemy(async_url: str) -> str:
    """asyncpg URL'sini SQLAlchemy uyumlu URL'ye çevir"""
    return async_url


async def main():
    """Ana başlatma"""
    logger.info("bot_starting",
        dry_run=DRY_RUN,
        schedule=f"{BOT_RUN_HOUR:02d}:{BOT_RUN_MINUTE:02d}",
        heartbeat_interval=HEARTBEAT_INTERVAL,
        snapshot_interval=SNAPSHOT_INTERVAL_HOURS,
    )

    # PostgreSQL job store — kaçırılan görevler otomatik telafi edilir
    jobstores = {}
    try:
        sa_url = _build_db_url_for_sqlalchemy(DATABASE_URL)
        jobstores['default'] = SQLAlchemyJobStore(url=sa_url)
        logger.info("jobstore_postgres", message="PostgreSQL job store aktif")
    except Exception as e:
        logger.warning("jobstore_fallback", error=str(e),
                       message="Bellek içi job store kullanılıyor")

    scheduler = AsyncIOScheduler(
        jobstores=jobstores,
        job_defaults={
            'coalesce': True,
            'max_instances': 1,
            'misfire_grace_time': 3600,
        }
    )

    # Günlük çalışma — 04:00 (Instagram + TikTok + Token dağıtım)
    scheduler.add_job(
        daily_run,
        'cron',
        hour=BOT_RUN_HOUR,
        minute=BOT_RUN_MINUTE,
        id='daily_run',
        name='Günlük Bot Döngüsü (IG+TT)',
        replace_existing=True,
    )

    # Multi-Snapshot toplayıcı — her 2 saatte bir
    scheduler.add_job(
        snapshot_run,
        'interval',
        hours=SNAPSHOT_INTERVAL_HOURS,
        id='snapshot_collector',
        name='Multi-Snapshot Toplayıcı',
        replace_existing=True,
    )

    # Çekim işleyici — her 5 dakika
    scheduler.add_job(
        process_withdrawals,
        'interval',
        minutes=5,
        id='withdrawal_processor',
        name='USDT Çekim İşleyici',
        replace_existing=True,
    )

    # Heartbeat — her 5 dakika
    scheduler.add_job(
        heartbeat,
        'interval',
        seconds=HEARTBEAT_INTERVAL,
        id='heartbeat',
        name='Heartbeat',
        replace_existing=True,
    )

    scheduler.start()

    logger.info("bot_ready", message="Scheduler çalışıyor, Ctrl+C ile durdur")

    # Graceful shutdown
    stop_event = asyncio.Event()

    def shutdown(signum, frame):
        logger.info("bot_shutdown", signal=signum)
        scheduler.shutdown(wait=False)
        stop_event.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    await stop_event.wait()
    logger.info("bot_stopped")


if __name__ == "__main__":
    asyncio.run(main())
