"""
Token Ödül Sistemi — Bot Konfigürasyon
Docker Secrets'tan gizli bilgileri okur, RAM'de tutar, kullanım sonrası siler.
"""
import os
import gc
import structlog

logger = structlog.get_logger()

# ── Environment ──
DRY_RUN = os.getenv("DRY_RUN", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# ── Bot Schedule ──
BOT_RUN_HOUR = 4    # 04:00
BOT_RUN_MINUTE = 0
HEARTBEAT_INTERVAL = 300  # 5 dakika
DEAD_MAN_TIMEOUT = 600    # 10 dakika

# ── Meta API (Instagram) ──
META_API_BASE = "https://graph.instagram.com"
META_API_VERSION = "v19.0"

# ── TikTok API ──
TIKTOK_API_BASE = "https://open.tiktokapis.com/v2"

# ── Thresholds ──
POOL_WARNING_PERCENT = 20     # %20 altında uyarı
ANOMALY_MULTIPLIER = 5        # 5x üstü kazanımda alarm
TOKEN_EXPIRE_WARNING_DAYS = 10
TOKEN_EXPIRE_CRITICAL_DAYS = 3

# ── Circuit Breaker ──
CIRCUIT_FAILURE_THRESHOLD = 5
CIRCUIT_RESET_TIMEOUT = 300   # 5 dakika

# ── OpenAI (AI Analyzer) ──
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# ── Snapshot ──
SNAPSHOT_INTERVAL_HOURS = int(os.getenv("SNAPSHOT_INTERVAL_HOURS", "2"))


def read_secret(name: str) -> str:
    """Docker Secret okur — /run/secrets/{name}"""
    secret_path = f"/run/secrets/{name}"
    
    # Docker Secrets (production)
    if os.path.exists(secret_path):
        with open(secret_path, "r") as f:
            value = f.read().strip()
            logger.info("secret_loaded", name=name, source="docker_secret")
            return value
    
    # Environment variable fallback (development)
    env_value = os.getenv(name.upper(), "")
    if env_value:
        logger.warning("secret_from_env", name=name, source="environment")
        return env_value
    
    logger.error("secret_not_found", name=name)
    raise ValueError(f"Secret '{name}' bulunamadı!")


def cleanup_secret(secret_var_name: str, local_vars: dict):
    """Secret'ı RAM'den temizle"""
    if secret_var_name in local_vars:
        del local_vars[secret_var_name]
    gc.collect()
    logger.debug("secret_cleaned", name=secret_var_name)

# ── Load Secrets ──
try:
    DATABASE_URL = f"postgresql://app:{read_secret('db_password')}@db:5432/token_system"
    REDIS_URL = f"redis://:{read_secret('redis_password')}@redis:6379"
except Exception as e:
    logger.error("secret_load_failed", error=str(e))
    DATABASE_URL = ""
    REDIS_URL = "redis://redis:6379"

# OpenAI key (opsiyonel — yoksa AI analyzer fallback modda çalışır)
try:
    OPENAI_API_KEY = read_secret("openai_api_key")
except Exception:
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

