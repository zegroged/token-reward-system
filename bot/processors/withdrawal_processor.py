"""
Çekim İşleyici — Admin onayından sonra otomatik USDT transferi
Her 5 dakikada çalışır, approved çekimleri bulur ve TRON'a gönderir.

★ KRİTİK GÜVENLİK ÖZELLİKLERİ ★
  1. Atomic claim: UPDATE ... WHERE status='approved' RETURNING ile aynı
     satırı iki process aynı anda işleyemez (row-level race-free).
  2. Idempotency key: her withdrawal için kalıcı anahtar; retry sırasında
     aynı TX iki kez gönderilmez.
  3. tx_hash UNIQUE: DB constraint çift kayıt oluşmasını engeller.
  4. ★ DOUBLE-SPEND KORUMASI: Broadcast sonrası TX hash varsa ASLA retry
     yapılmaz — "unconfirmed" durumuna alınır (admin doğrulaması gerekir).
  5. Başarısızlıkta → broadcast olmamışsa retry, olmuşsa freeze.
"""
import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import asyncpg
import structlog

from config import read_secret, DATABASE_URL, DRY_RUN
from processors.tron_transfer import TronTransfer

logger = structlog.get_logger()

# Başarısızlık durumunda maksimum retry (SADECE broadcast olmamış hatalar için)
MAX_AUTO_RETRY = 3


class WithdrawalProcessor:
    """Onaylanmış çekim taleplerini USDT olarak transfer et"""

    def __init__(self):
        self.db: asyncpg.Connection | None = None
        self.tron: TronTransfer | None = None

    async def setup(self):
        """Bağlantıları kur"""
        self.db = await asyncpg.connect(DATABASE_URL)

        try:
            tron_key = read_secret("tron_private_key")
            tron_api_key = read_secret("tron_api_key") if not DRY_RUN else ""
            self.tron = TronTransfer(tron_key, tron_api_key)

            if self.tron.is_ready():
                health = await self.tron.check_health()
                logger.info("tron_wallet_health", **health)
            else:
                logger.warning("tron_not_ready", hint="tronpy yüklü mü?")
        except Exception as e:
            logger.error("tron_setup_failed", error=str(e))
            self.tron = None

    async def teardown(self):
        if self.db:
            await self.db.close()

    async def _notify_admins(self, title: str, message: str,
                              notif_type: str = "info"):
        admin_ids = await self.db.fetch(
            "SELECT id FROM users WHERE role IN ('admin', 'super_admin') AND is_active = true"
        )
        for admin in admin_ids:
            await self.db.execute(
                "INSERT INTO notifications (user_id, type, title, message) "
                "VALUES ($1, $2, $3, $4)",
                admin["id"], notif_type, title, message
            )

    async def _notify_user(self, user_id, title: str, message: str,
                            notif_type: str = "info"):
        await self.db.execute(
            "INSERT INTO notifications (user_id, type, title, message) "
            "VALUES ($1, $2, $3, $4)",
            user_id, notif_type, title, message
        )

    async def _claim_withdrawal(self) -> dict | None:
        """
        Tek bir 'approved' withdrawal'ı ATOMIK olarak kendi üzerimize al.
        Başka bir bot instance'ı (veya retry) aynı satırı göremez.

        ★ DOUBLE-SPEND KORUMASI: tx_hash zaten varsa bu satır claim edilmez.
           (broadcast_sent ama unconfirmed durumlar "approved"a dönmez)
        """
        async with self.db.transaction():
            row = await self.db.fetchrow(
                """
                WITH claimed AS (
                    SELECT id, approved_at
                    FROM withdrawals
                    WHERE status = 'approved'
                      AND retry_count < $1
                      AND tx_hash IS NULL
                    ORDER BY approved_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE withdrawals w
                   SET status = 'processing',
                       processed_at = NOW(),
                       -- Idempotency anahtarinin TEK kaynagi burasi.
                       -- Python tarafinda ikinci bir uretici YAZMAYIN:
                       -- datetime.isoformat() ile timestamptz::text farkli
                       -- dizgi uretir, hash tutmaz ve benzersizlik atlanir.
                       idempotency_key = COALESCE(
                           w.idempotency_key,
                           encode(sha256(
                               (w.id::text || '|' || COALESCE(w.approved_at::text, ''))::bytea
                           ), 'hex')
                       )
                  FROM claimed
                 WHERE w.id = claimed.id
                RETURNING
                    w.id, w.user_id, w.amount_usdt, w.wallet_address,
                    w.idempotency_key, w.tx_hash, w.retry_count
                """,
                MAX_AUTO_RETRY,
            )

            if not row:
                return None

            # Kullanıcı bilgisi
            user = await self.db.fetchrow(
                "SELECT full_name, email FROM users WHERE id = $1",
                row["user_id"],
            )
            return {**dict(row), **(dict(user) if user else {})}

    async def _finalize_success(self, withdrawal_id, tx_hash: str):
        """Başarılı transfer → status=completed, tx_hash kaydet, bakiye güncelle"""
        async with self.db.transaction():
            row = await self.db.fetchrow(
                "SELECT user_id, amount_token FROM withdrawals WHERE id = $1",
                withdrawal_id,
            )

            await self.db.execute(
                """
                UPDATE withdrawals
                   SET status = 'completed',
                       tx_hash = $1,
                       tx_confirmed = true,
                       completed_at = $2,
                       last_error = NULL
                 WHERE id = $3
                   AND status = 'processing'
                """,
                tx_hash, datetime.now(timezone.utc), withdrawal_id,
            )

            # Bakiye: pending → totalWithdrawn
            if row:
                await self.db.execute(
                    "UPDATE balances SET pending = pending - $1, "
                    "total_withdrawn = total_withdrawn + $1 WHERE user_id = $2",
                    row["amount_token"], row["user_id"],
                )

    async def _finalize_unconfirmed(self, withdrawal_id, tx_hash: str, error: str):
        """
        ★ DOUBLE-SPEND KORUMASI — YENİ DURUM
        TX broadcast edildi ama onay alınamadı.
        ASLA retry yapılmaz. Admin manüel doğrulaması gerekir.
        Status = 'unconfirmed' (pending bakiye dokunulmaz)
        """
        await self.db.execute(
            """
            UPDATE withdrawals
               SET status = 'unconfirmed',
                   tx_hash = $1,
                   tx_confirmed = false,
                   last_error = $2,
                   processed_at = NOW()
             WHERE id = $3
            """,
            tx_hash, error[:2000], withdrawal_id,
        )

        await self._notify_admins(
            "⚠️ Çekim: TX Onay Bekliyor (Manüel Doğrulama)",
            f"Withdrawal {withdrawal_id}\n"
            f"TX Hash: {tx_hash}\n"
            f"TX broadcast edildi ama onay alınamadı.\n"
            f"⚠️ PARA GÖNDERİLMİŞ OLABİLİR — Blockchain'den doğrulayın!\n"
            f"Hata: {error[:200]}",
            "warning",
        )

        logger.critical("withdrawal_unconfirmed_broadcast",
            withdrawal_id=str(withdrawal_id),
            tx_hash=tx_hash,
            message="DOUBLE SPEND RİSKİ — manüel doğrulama gerekli"
        )

    async def _finalize_failure(self, withdrawal_id, error: str, retry_count: int):
        """
        Başarısız transfer işleme stratejisi — SADECE broadcast olmamış hatalar için.
          - retry_count < MAX_AUTO_RETRY → 'approved'e döndür (tekrar denenecek)
          - retry_count >= MAX_AUTO_RETRY → 'failed' terminal state

        ★ DOUBLE-SPEND KORUMASI: Bu fonksiyon SADECE broadcast_sent=False
          durumlarında çağrılır. Broadcast olan TX'ler _finalize_unconfirmed'a gider.
        """
        new_count = retry_count + 1
        if new_count >= MAX_AUTO_RETRY:
            # Kalıcı fail — pending bakiyeyi available'a geri yükle
            async with self.db.transaction():
                await self.db.execute(
                    """
                    UPDATE withdrawals
                       SET status = 'failed',
                           last_error = $1,
                           retry_count = $2
                     WHERE id = $3
                    """,
                    error[:2000], new_count, withdrawal_id,
                )
                # Bakiye geri yükle: pending → available
                row = await self.db.fetchrow(
                    "SELECT user_id, amount_token FROM withdrawals WHERE id = $1",
                    withdrawal_id,
                )
                if row:
                    await self.db.execute(
                        "UPDATE balances SET pending = pending - $1, "
                        "available = available + $1 WHERE user_id = $2",
                        row["amount_token"], row["user_id"],
                    )
            await self._notify_admins(
                "❌ Çekim Başarısız (Max Retry)",
                f"Withdrawal {withdrawal_id} {MAX_AUTO_RETRY} kez başarısız. "
                f"Manuel inceleme gerekli.\nHata: {error[:200]}",
                "error",
            )
        else:
            await self.db.execute(
                """
                UPDATE withdrawals
                   SET status = 'approved',
                       last_error = $1,
                       retry_count = $2
                 WHERE id = $3
                """,
                error[:2000], new_count, withdrawal_id,
            )

    async def process_pending(self) -> dict:
        """Approved durumundaki çekim taleplerini tek tek atomik claim edip işle"""
        report = {"processed": 0, "successful": 0, "failed": 0,
                  "unconfirmed": 0, "errors": []}

        try:
            await self.setup()

            if not self.tron or not self.tron.is_ready():
                logger.warning("withdrawal_skip", reason="TRON client hazır değil")
                await self._notify_admins(
                    "🔴 TRON Client Hazır Değil",
                    "USDT transferleri yapılamıyor. tron_private_key ve tron_api_key "
                    "secret dosyalarını kontrol edin.",
                    "error",
                )
                return report

            if DRY_RUN:
                logger.warning("dry_run_mode",
                               message="Çekim işlemi DRY_RUN — gerçek transfer yok")
                return report

            # ─── Önce: Eski 'unconfirmed' TX'leri blockchain'den doğrula ───
            await self._check_unconfirmed_transactions()

            # ─── Sonra: Yeni çekimleri işle ───
            # En fazla 10 çekim işle (her birini atomik claim ile)
            for _ in range(10):
                w = await self._claim_withdrawal()
                if not w:
                    break

                report["processed"] += 1
                withdrawal_id = w["id"]
                user_name = w.get("full_name", "?")
                amount_usdt = float(w["amount_usdt"]) if w["amount_usdt"] else 0

                try:
                    # ★ Idempotency guard: tx_hash zaten varsa önceki deneme
                    # blockchain'e düşmüş olabilir → manuel doğrulamaya al
                    if w["tx_hash"]:
                        logger.warning("withdrawal_has_existing_tx_hash",
                                       id=str(withdrawal_id),
                                       tx=w["tx_hash"])
                        # ★ Blockchain'de doğrula
                        chain_status = await self.tron.verify_tx_on_chain(w["tx_hash"])
                        if chain_status["success"]:
                            await self._finalize_success(withdrawal_id, w["tx_hash"])
                            report["successful"] += 1
                        else:
                            await self._finalize_unconfirmed(
                                withdrawal_id, w["tx_hash"],
                                "Mevcut TX hash — blockchain doğrulama bekliyor"
                            )
                            report["unconfirmed"] += 1
                        continue

                    # USDT transfer
                    result = await self.tron.process_withdrawal({
                        "id": str(withdrawal_id),
                        "wallet_address": w["wallet_address"],
                        "amount_usdt": amount_usdt,
                        "user_name": user_name,
                    })

                    if result["success"] and result.get("tx_hash"):
                        # ✅ Başarılı ve onaylı
                        await self._finalize_success(withdrawal_id, result["tx_hash"])
                        await self._notify_user(
                            w["user_id"],
                            "✅ Çekim Tamamlandı",
                            f"{amount_usdt:.4f} USDT cüzdanınıza gönderildi. "
                            f"TX: {result['tx_hash'][:16]}...",
                            "success"
                        )
                        report["successful"] += 1
                        logger.info("withdrawal_completed",
                                    user=user_name, amount=amount_usdt,
                                    tx=result["tx_hash"])

                    elif result.get("broadcast_sent") and result.get("tx_hash"):
                        # ★ DOUBLE-SPEND KORUMASI: Para gönderildi ama onay alınamadı
                        # ASLA retry yapma — unconfirmed durumuna al
                        await self._finalize_unconfirmed(
                            withdrawal_id,
                            result["tx_hash"],
                            result.get("error", "TX broadcast ama onay timeout")
                        )
                        report["unconfirmed"] += 1
                        logger.warning("withdrawal_unconfirmed",
                                       user=user_name, tx=result["tx_hash"])

                    else:
                        # ❌ Broadcast olmadı (validasyon/bakiye/ağ hatası) → güvenle retry
                        err = result.get("error", "Bilinmeyen hata")
                        await self._finalize_failure(withdrawal_id, err,
                                                     w["retry_count"])
                        report["failed"] += 1
                        report["errors"].append(f"{user_name}: {err}")
                        logger.error("withdrawal_transfer_failed",
                                     user=user_name, error=err)

                except asyncpg.UniqueViolationError as e:
                    # tx_hash UNIQUE ihlali → aynı TX başka yerde yazılmış
                    # ★ ASLA iade yapma — blockchain'de doğrula
                    logger.critical("withdrawal_tx_hash_collision",
                                    id=str(withdrawal_id), error=str(e))
                    await self._finalize_unconfirmed(
                        withdrawal_id,
                        "COLLISION",
                        f"TX hash collision — manüel doğrulama: {e}",
                    )
                    report["unconfirmed"] += 1

                except Exception as e:
                    # ★ Genel exception — broadcast olmuş olabilir
                    # Eğer bu noktaya gelindiyse result yoktur, broadcast olmamıştır
                    await self._finalize_failure(withdrawal_id, str(e),
                                                 w["retry_count"])
                    report["failed"] += 1
                    report["errors"].append(f"{user_name}: {str(e)}")
                    logger.error("withdrawal_exception",
                                 user=user_name, error=str(e))

                # Rate limiting — transfer arası bekle
                await asyncio.sleep(2)

            # Admin raporu
            if report["processed"] > 0:
                await self._notify_admins(
                    "💸 Çekim İşlem Raporu",
                    f"İşlenen: {report['processed']} | "
                    f"Başarılı: {report['successful']} | "
                    f"Onay Bekleyen: {report['unconfirmed']} | "
                    f"Başarısız: {report['failed']}",
                    "info" if report["failed"] == 0 and report["unconfirmed"] == 0 else "warning"
                )

        except Exception as e:
            logger.error("withdrawal_processor_error", error=str(e))
            report["errors"].append(f"CRITICAL: {str(e)}")

        finally:
            await self.teardown()

        return report

    async def _check_unconfirmed_transactions(self):
        """
        ★ DOUBLE-SPEND KORUMASI — Arka plan doğrulama
        'unconfirmed' durumundaki TX'leri blockchain'den kontrol et.
        Onaylanmışsa → completed, hâlâ beklemekteyse → bırak.
        """
        rows = await self.db.fetch(
            "SELECT id, tx_hash, user_id, amount_token "
            "FROM withdrawals WHERE status = 'unconfirmed' AND tx_hash IS NOT NULL "
            "LIMIT 20"
        )

        for row in rows:
            try:
                chain_status = await self.tron.verify_tx_on_chain(row["tx_hash"])

                if chain_status["confirmed"] and chain_status["success"]:
                    # ✅ Blockchain'de onaylandı → completed
                    await self._finalize_success(str(row["id"]), row["tx_hash"])
                    logger.info("unconfirmed_tx_resolved",
                                withdrawal_id=str(row["id"]),
                                tx_hash=row["tx_hash"],
                                result="completed")

                elif chain_status["confirmed"] and not chain_status["success"]:
                    # ❌ Blockchain'de REVERT → gerçekten başarısız
                    # Bu durumda güvenle iade yapılabilir
                    async with self.db.transaction():
                        await self.db.execute(
                            "UPDATE withdrawals SET status = 'failed', "
                            "last_error = 'Blockchain REVERT — TX başarısız' "
                            "WHERE id = $1",
                            row["id"],
                        )
                        await self.db.execute(
                            "UPDATE balances SET pending = pending - $1, "
                            "available = available + $1 WHERE user_id = $2",
                            row["amount_token"], row["user_id"],
                        )
                    logger.info("unconfirmed_tx_resolved",
                                withdrawal_id=str(row["id"]),
                                tx_hash=row["tx_hash"],
                                result="reverted_refunded")

                # else: Hâlâ beklemekte → dokunma

            except Exception as e:
                logger.warning("unconfirmed_check_failed",
                               withdrawal_id=str(row["id"]),
                               error=str(e))
                continue


async def run_withdrawal_processor():
    """APScheduler tarafından çağrılacak fonksiyon"""
    processor = WithdrawalProcessor()
    report = await processor.process_pending()
    if report["processed"] > 0:
        logger.info("withdrawal_processor_complete", report=report)
