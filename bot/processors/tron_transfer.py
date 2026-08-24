"""
USDT (TRC20) Transfer Modülü — Tronpy
Dual-mode: Nile Testnet (geliştirme) + Mainnet (production)
Admin onayından sonra cüzdana USDT gönderir.

★ DOUBLE-SPEND KORUMASI ★
  Broadcast sonrası tx_hash HER ZAMAN döndürülür.
  Timeout = "bilmiyorum" anlamına gelir, "başarısız" DEĞİL.
  Yeni durum: "unconfirmed" → admin/bot manüel doğrulaması gerekir.
"""
import os
import asyncio
from decimal import Decimal

import structlog

logger = structlog.get_logger()

# Tronpy import
try:
    from tronpy import Tron
    from tronpy.keys import PrivateKey
    from tronpy.providers import HTTPProvider
    TRON_AVAILABLE = True
except ImportError:
    TRON_AVAILABLE = False
    logger.warning("tronpy_not_installed", hint="pip install tronpy")


# ── Network Configuration ──
# Production (DRY_RUN=false) → mainnet, Development (DRY_RUN=true) → nile testnet
# TRON_NETWORK env variable ile manuel override edilebilir
_dry_run = os.getenv("DRY_RUN", "false").lower() == "true"
_default_network = "nile" if _dry_run else "mainnet"
NETWORK = os.getenv("TRON_NETWORK", _default_network)

NETWORKS = {
    "nile": {
        "api_url": "https://nile.trongrid.io",
        "usdt_contract": "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj",  # Nile USDT
        "explorer": "https://nile.tronscan.org/#/transaction/",
        "name": "Nile Testnet",
    },
    "shasta": {
        "api_url": "https://api.shasta.trongrid.io",
        "usdt_contract": "TG3XXyExBkFU9nQGX7xKkEFKr8DH7qQd4c",  # Shasta USDT
        "explorer": "https://shasta.tronscan.org/#/transaction/",
        "name": "Shasta Testnet",
    },
    "mainnet": {
        "api_url": "https://api.trongrid.io",
        "usdt_contract": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",  # Real USDT
        "explorer": "https://tronscan.org/#/transaction/",
        "name": "Mainnet",
    },
}


class TronTransfer:
    """USDT TRC20 transfer yöneticisi — Testnet & Mainnet desteği"""

    def __init__(self, private_key_hex: str, tron_api_key: str = ""):
        self.network = NETWORKS.get(NETWORK, NETWORKS["nile"])
        self.private_key_hex = private_key_hex
        self.tron_api_key = tron_api_key
        self.client = None
        self.usdt_contract_addr = self.network["usdt_contract"]

        if TRON_AVAILABLE:
            try:
                if NETWORK == "nile":
                    self.client = Tron(network="nile")
                elif NETWORK == "shasta":
                    self.client = Tron(network="shasta")
                else:
                    provider = HTTPProvider(
                        self.network["api_url"],
                        api_key=tron_api_key
                    ) if tron_api_key else HTTPProvider(self.network["api_url"])
                    self.client = Tron(provider=provider)

                self.priv_key = PrivateKey(bytes.fromhex(private_key_hex))
                self.sender_address = self.priv_key.public_key.to_base58check_address()

                logger.info("tron_client_initialized",
                    sender=self.sender_address,
                    network=self.network["name"],
                    usdt_contract=self.usdt_contract_addr,
                )
            except Exception as e:
                logger.error("tron_client_init_failed", error=str(e))
        else:
            logger.warning("tron_unavailable", reason="tronpy not installed")

    def is_ready(self) -> bool:
        return self.client is not None and TRON_AVAILABLE

    def get_explorer_url(self, tx_hash: str) -> str:
        """TX hash için explorer linki"""
        return f"{self.network['explorer']}{tx_hash}"

    async def get_trx_balance(self) -> Decimal:
        """TRX bakiyesi (fee ödeme için gerekli)"""
        if not self.is_ready():
            return Decimal("0")
        try:
            balance = self.client.get_account_balance(self.sender_address)
            return Decimal(str(balance))
        except Exception as e:
            logger.error("trx_balance_failed", error=str(e))
            return Decimal("0")

    async def get_usdt_balance(self) -> Decimal:
        """Gönderen cüzdanın USDT bakiyesini kontrol et"""
        if not self.is_ready():
            return Decimal("0")

        try:
            contract = self.client.get_contract(self.usdt_contract_addr)
            balance = contract.functions.balanceOf(self.sender_address)
            # USDT 6 decimal
            return Decimal(str(balance)) / Decimal("1000000")
        except Exception as e:
            logger.error("usdt_balance_failed", error=str(e))
            return Decimal("0")

    async def check_health(self) -> dict:
        """Cüzdan sağlık kontrolü"""
        trx = await self.get_trx_balance()
        usdt = await self.get_usdt_balance()
        return {
            "network": self.network["name"],
            "sender": self.sender_address if self.is_ready() else None,
            "trx_balance": float(trx),
            "usdt_balance": float(usdt),
            "trx_sufficient": trx >= Decimal("10"),  # Min 10 TRX for fees
            "ready": self.is_ready(),
        }

    async def verify_tx_on_chain(self, tx_hash: str) -> dict:
        """★ Blockchain'de TX durumunu doğrula — retry/timeout sonrası kullanılır"""
        if not self.is_ready() or not tx_hash:
            return {"found": False, "confirmed": False, "success": False}

        try:
            info = self.client.get_transaction_info(tx_hash)
            if info:
                receipt = info.get("receipt", {})
                result = receipt.get("result", "")
                return {
                    "found": True,
                    "confirmed": True,
                    "success": result == "SUCCESS",
                    "result": result,
                }
        except Exception:
            pass

        return {"found": False, "confirmed": False, "success": False}

    async def transfer_usdt(self, to_address: str, amount: Decimal) -> dict:
        """
        USDT TRC20 transfer et.

        ★ DOUBLE-SPEND KORUMASI ★
          Broadcast sonrası tx_hash HER ZAMAN döndürülür.
          success=True  → onaylandı
          success=False → broadcast OLMADI (hata / validasyon)
          confirmed=False + tx_hash var → "bilmiyorum" durumu (timeout)
            → ASLA retry yapılmaz, manüel doğrulama gerekir

        Returns:
            { success, tx_hash, explorer_url, error, broadcast_sent }
        """
        if not self.is_ready():
            return {"success": False, "tx_hash": None, "explorer_url": None,
                    "error": "Tron client hazır değil", "broadcast_sent": False}

        # Adres doğrulama
        if not to_address.startswith("T") or len(to_address) != 34:
            return {"success": False, "tx_hash": None, "explorer_url": None,
                    "error": "Geçersiz TRC20 adresi", "broadcast_sent": False}

        # Minimum miktar
        if amount < Decimal("0.1"):
            return {"success": False, "tx_hash": None, "explorer_url": None,
                    "error": "Minimum 0.1 USDT", "broadcast_sent": False}

        # TRX fee kontrolü
        trx_balance = await self.get_trx_balance()
        if trx_balance < Decimal("10"):
            return {"success": False, "tx_hash": None, "explorer_url": None,
                    "error": f"Yetersiz TRX (fee): {trx_balance} TRX. Min 10 TRX gerekli.",
                    "broadcast_sent": False}

        # USDT bakiye kontrolü
        balance = await self.get_usdt_balance()
        if balance < amount:
            return {"success": False, "tx_hash": None, "explorer_url": None,
                    "error": f"Yetersiz USDT bakiyesi: {balance} USDT",
                    "broadcast_sent": False}

        # ★ KURAL: broadcast() çağrıldıktan sonra tx_hash KAYBOLMAZ
        tx_hash = None
        try:
            amount_sun = int(amount * Decimal("1000000"))

            contract = self.client.get_contract(self.usdt_contract_addr)
            txn = (
                contract.functions.transfer(to_address, amount_sun)
                .with_owner(self.sender_address)
                .fee_limit(30_000_000)  # 30 TRX max fee
                .build()
                .sign(self.priv_key)
            )

            result = txn.broadcast()
            tx_hash = result.get("txid", "")
            explorer_url = self.get_explorer_url(tx_hash)

            logger.info("usdt_transfer_broadcast",
                to=to_address[:8] + "...",
                amount=str(amount),
                tx_hash=tx_hash,
                network=self.network["name"],
            )

            # ★ BROADCAST BAŞARILI — para ağa çıktı
            # tx_hash artık kayıp olamaz

            # TX onayını bekle
            confirmed = await self._wait_for_confirmation(tx_hash, timeout=60)

            if confirmed:
                return {
                    "success": True,
                    "tx_hash": tx_hash,
                    "explorer_url": explorer_url,
                    "error": None,
                    "broadcast_sent": True,
                }
            else:
                # ★ TIMEOUT ≠ BAŞARISIZ
                # Para GÖNDERİLDİ ama onay alınamadı → ASLA retry yapma
                logger.warning("usdt_transfer_unconfirmed",
                    tx_hash=tx_hash,
                    to=to_address[:8] + "...",
                    amount=str(amount),
                    message="TX broadcast edildi ama onay alınamadı — DOUBLE SPEND RİSKİ, retry YAPILMAZ"
                )
                return {
                    "success": False,
                    "tx_hash": tx_hash,  # ★ tx_hash HER ZAMAN döndürülür
                    "explorer_url": explorer_url,
                    "error": "TX broadcast edildi ama onay zaman aşımı — manüel doğrulama gerekli",
                    "broadcast_sent": True,  # ★ PARA GÖNDERİLDİ
                }

        except Exception as e:
            logger.error("usdt_transfer_failed",
                to=to_address[:8] + "...",
                amount=str(amount),
                tx_hash=tx_hash,  # ★ None olabilir veya broadcast sonrası hash olabilir
                error=str(e),
            )
            # ★ Eğer tx_hash varsa broadcast olmuş olabilir — para çıkmış olabilir
            return {
                "success": False,
                "tx_hash": tx_hash,  # ★ None veya gerçek hash
                "explorer_url": self.get_explorer_url(tx_hash) if tx_hash else None,
                "error": str(e),
                "broadcast_sent": tx_hash is not None,  # ★ Hash varsa broadcast olmuş
            }

    async def _wait_for_confirmation(self, tx_hash: str, timeout: int = 60) -> bool:
        """TX'in blockchain'de onaylanmasını bekle"""
        for _ in range(timeout // 3):
            await asyncio.sleep(3)
            try:
                info = self.client.get_transaction_info(tx_hash)
                if info and info.get("receipt", {}).get("result") == "SUCCESS":
                    logger.info("tx_confirmed", tx_hash=tx_hash)
                    return True
                # REVERT = kesin başarısız (kontrat hatası)
                if info and info.get("receipt", {}).get("result") == "REVERT":
                    logger.error("tx_reverted", tx_hash=tx_hash)
                    return False  # Bu durumda gerçekten başarısız
            except Exception:
                continue
        return False

    async def process_withdrawal(self, withdrawal: dict) -> dict:
        """
        Tek bir çekim talebini işle.

        Args:
            withdrawal: { id, wallet_address, amount_usdt, user_name }

        Returns: Transfer sonucu (broadcast_sent flag'i dahil)
        """
        logger.info("processing_withdrawal",
            id=withdrawal["id"],
            user=withdrawal.get("user_name", ""),
            amount=str(withdrawal["amount_usdt"]),
            wallet=withdrawal["wallet_address"][:8] + "...",
            network=self.network["name"],
        )

        result = await self.transfer_usdt(
            to_address=withdrawal["wallet_address"],
            amount=Decimal(str(withdrawal["amount_usdt"])),
        )

        result["withdrawal_id"] = withdrawal["id"]
        return result
