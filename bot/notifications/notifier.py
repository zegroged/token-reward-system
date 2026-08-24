"""
Telegram + Discord Bildirim Modülü
Admin bildirimleri, bot raporu, alarm ve uyarılar.
"""
import httpx
import structlog

logger = structlog.get_logger()


class TelegramNotifier:
    """Telegram Bot API üzerinden bildirim"""

    def __init__(self, bot_token: str, chat_id: str):
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.base_url = f"https://api.telegram.org/bot{bot_token}"
        self.client = httpx.AsyncClient(timeout=10)

    async def close(self):
        await self.client.aclose()

    async def send(self, message: str, parse_mode: str = "HTML") -> bool:
        """Mesaj gönder"""
        try:
            response = await self.client.post(
                f"{self.base_url}/sendMessage",
                json={
                    "chat_id": self.chat_id,
                    "text": message,
                    "parse_mode": parse_mode,
                    "disable_web_page_preview": True,
                },
            )
            response.raise_for_status()
            logger.info("telegram_sent", chat_id=self.chat_id)
            return True
        except Exception as e:
            logger.error("telegram_failed", error=str(e))
            return False

    async def send_daily_report(self, report: dict) -> bool:
        """Günlük bot raporu"""
        msg = (
            "📊 <b>Günlük Bot Raporu</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🕐 Tarih: <code>{report.get('date', 'N/A')}</code>\n"
            f"👥 İşlenen: <b>{report.get('total_users', 0)}</b> kullanıcı\n"
            f"✅ Başarılı: <b>{report.get('successful', 0)}</b>\n"
            f"❌ Başarısız: <b>{report.get('failed', 0)}</b>\n"
            f"📱 Analiz: <b>{report.get('total_reels', 0)}</b> Reel\n"
            f"💰 Dağıtılan: <b>{report.get('tokens_distributed', 0):.2f}</b> TOKEN\n"
            f"⚠️ Flagged: <b>{report.get('flagged', 0)}</b>\n"
            f"🏦 Havuz: <b>{report.get('pool_balance', 0):.2f}</b> ₺\n"
            f"━━━━━━━━━━━━━━━━━━"
        )
        return await self.send(msg)

    async def send_pool_warning(self, balance: float, threshold_percent: float) -> bool:
        """Havuz bakiyesi düşük uyarısı"""
        msg = (
            f"🔴 <b>HAVUZ BAKİYESİ DÜŞÜK!</b>\n\n"
            f"Mevcut: <b>{balance:.2f} ₺</b>\n"
            f"Eşik: %{threshold_percent}\n\n"
            f"⚠️ Acil para eklenmeli!"
        )
        return await self.send(msg)

    async def send_anomaly_alert(self, user_name: str, details: str) -> bool:
        """Anomali tespit uyarısı"""
        msg = (
            f"⚠️ <b>ANOMALİ TESPİT EDİLDİ</b>\n\n"
            f"👤 Kullanıcı: <b>{user_name}</b>\n"
            f"📋 Detay: {details}\n\n"
            f"Admin panelden inceleyin."
        )
        return await self.send(msg)

    async def send_token_expiry_warning(self, user_name: str, days_left: int) -> bool:
        """Instagram token süresi dolmak üzere"""
        msg = (
            f"🔑 <b>TOKEN SÜRE UYARISI</b>\n\n"
            f"👤 Kullanıcı: <b>{user_name}</b>\n"
            f"⏰ Kalan: <b>{days_left} gün</b>\n\n"
            f"Kullanıcıdan token yenilemesini isteyin."
        )
        return await self.send(msg)

    async def send_heartbeat(self) -> bool:
        """Heartbeat — bot hayatta"""
        return await self.send("💚 Bot heartbeat — çalışıyor")

    async def send_error(self, error_msg: str) -> bool:
        """Kritik hata bildirimi"""
        msg = f"🔴 <b>KRİTİK HATA</b>\n\n<code>{error_msg[:500]}</code>"
        return await self.send(msg)


class DiscordNotifier:
    """Discord Webhook üzerinden bildirim"""

    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url
        self.client = httpx.AsyncClient(timeout=10)

    async def close(self):
        await self.client.aclose()

    async def send(self, content: str, embeds: list | None = None) -> bool:
        """Discord webhook mesajı"""
        try:
            payload: dict = {"content": content}
            if embeds:
                payload["embeds"] = embeds

            response = await self.client.post(self.webhook_url, json=payload)
            response.raise_for_status()
            logger.info("discord_sent")
            return True
        except Exception as e:
            logger.error("discord_failed", error=str(e))
            return False

    async def send_daily_report(self, report: dict) -> bool:
        """Discord embed ile günlük rapor"""
        embed = {
            "title": "📊 Günlük Bot Raporu",
            "color": 0x6c5ce7,
            "fields": [
                {"name": "👥 Kullanıcı", "value": str(report.get("total_users", 0)), "inline": True},
                {"name": "📱 Reel", "value": str(report.get("total_reels", 0)), "inline": True},
                {"name": "💰 TOKEN", "value": f"{report.get('tokens_distributed', 0):.2f}", "inline": True},
                {"name": "⚠️ Flag", "value": str(report.get("flagged", 0)), "inline": True},
                {"name": "🏦 Havuz", "value": f"{report.get('pool_balance', 0):.2f} ₺", "inline": True},
            ],
        }
        return await self.send("", embeds=[embed])
