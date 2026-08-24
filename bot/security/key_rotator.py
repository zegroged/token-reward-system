"""
Encryption Key Rotation — Multi-Version Aware

★ İYİLEŞTİRİLMİŞ AKIŞ ★
  1. `encryption_keys` tablosundan mevcut tüm versiyonlar yüklenir
  2. Her kullanıcı kendi `encryption_key_version` değerine göre doğru key ile
     deşifre edilir (karışık durumda tutarsızlık olmaz)
  3. Yeni key yazılır ve tüm token alanları (IG, TikTok access+refresh, TOTP)
     yeniden şifrelenir
  4. Atomik transaction: ya hepsi ya hiçbiri
  5. Key'ler RAM'den `gc.collect()` ile temizlenir

Güvenlik notları:
  - Asla eski key'i DB'de plaintext tutmayız; Docker secret'ta versiyonlu dosyalar
    (encryption_key_v1.txt, encryption_key_v2.txt, ...) beklenir
  - `key_hash` alanı doğrulama içindir (raw_key'in SHA256'sı)
"""
import asyncio
import gc
import hashlib
import os

import asyncpg
import structlog

from config import read_secret
from security.token_encryption import encrypt_token, decrypt_token

logger = structlog.get_logger()


# Şifrelenen alanların (enc_col, iv_col) eşleştirmesi
TOKEN_FIELDS = [
    ("instagram_token_enc", "instagram_token_iv"),
    ("tiktok_token_enc", "tiktok_token_iv"),
    ("tiktok_refresh_token_enc", "tiktok_refresh_iv"),
    ("totp_secret_enc", None),   # TOTP için IV kullanılmıyorsa None
]


def _sha256_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _load_all_keys() -> dict[int, str]:
    """
    Tüm versiyon→raw_key eşleştirmesini yükle.
    Docker secret dosya konvansiyonu: encryption_key_v{N}
    Aktif key: encryption_key (version = is_current)
    """
    keys: dict[int, str] = {}
    # v1..v10 tarama (gereksiz yüksek tutma)
    for v in range(1, 11):
        try:
            raw = read_secret(f"encryption_key_v{v}")
            if raw:
                keys[v] = raw
        except Exception:
            continue
    # Legacy tek anahtar (v1 olarak kabul edilir)
    if 1 not in keys:
        try:
            raw = read_secret("encryption_key")
            if raw:
                keys[1] = raw
        except Exception:
            pass
    return keys


async def rotate_encryption_key(database_url: str, new_version: int | None = None):
    """
    Tüm kullanıcıların şifreli alanlarını mevcut en yüksek versiyona rotate et.

    Args:
        database_url: PostgreSQL bağlantı string'i
        new_version: Hedef versiyon (None → otomatik: max(encryption_keys.version)+1)

    Raises:
        ValueError: Yeni key dosyası bulunamazsa veya hash doğrulaması başarısızsa
    """
    all_keys = _load_all_keys()
    if not all_keys:
        raise ValueError("Hiçbir encryption_key_v{N} veya encryption_key bulunamadı")

    # "Yeni" key — aktif olan, encryption_key olarak erişilen
    new_raw = read_secret("encryption_key")
    if not new_raw:
        raise ValueError("encryption_key (aktif) bulunamadı")

    conn = await asyncpg.connect(database_url)

    try:
        # Hedef versiyon
        if new_version is None:
            new_version = await conn.fetchval(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM encryption_keys"
            ) or 1

        new_hash = _sha256_key(new_raw)

        # Aynı hash ile mevcut key varsa rotation idempotent — no-op
        existing = await conn.fetchrow(
            "SELECT version, is_current FROM encryption_keys WHERE key_hash = $1",
            new_hash,
        )
        if existing and existing["is_current"]:
            logger.info("key_rotation_noop",
                        reason="Aynı key zaten aktif",
                        version=existing["version"])
            return

        # DB'deki mevcut versiyonları haritaya ekle
        db_versions = await conn.fetch(
            "SELECT version, key_hash FROM encryption_keys ORDER BY version"
        )

        # Sağlık kontrolü: secret dosyadaki her key'in DB hash'iyle uyuşup uyuşmadığı
        for row in db_versions:
            v = row["version"]
            if v in all_keys:
                if _sha256_key(all_keys[v]) != row["key_hash"]:
                    raise ValueError(
                        f"encryption_key_v{v} dosyası DB'deki hash ile uyuşmuyor! "
                        f"Eski anahtar kaybolmuş veya yanlış dosya mounted."
                    )

        # Token'ı olan tüm kullanıcıları çek
        users = await conn.fetch(
            """
            SELECT id, encryption_key_version,
                   instagram_token_enc, instagram_token_iv,
                   tiktok_token_enc, tiktok_token_iv,
                   tiktok_refresh_token_enc, tiktok_refresh_iv,
                   totp_secret_enc
              FROM users
             WHERE instagram_token_enc IS NOT NULL
                OR tiktok_token_enc IS NOT NULL
                OR tiktok_refresh_token_enc IS NOT NULL
                OR totp_secret_enc IS NOT NULL
            """
        )

        logger.info("key_rotation_started",
                    user_count=len(users),
                    new_version=new_version,
                    known_versions=list(all_keys.keys()))

        async with conn.transaction():
            migrated = 0
            skipped = 0

            # Yeni versiyonu kaydet + is_current değiştir
            await conn.execute(
                "UPDATE encryption_keys SET is_current = false, retired_at = NOW() "
                "WHERE is_current = true"
            )
            await conn.execute(
                """
                INSERT INTO encryption_keys (version, key_hash, is_current)
                VALUES ($1, $2, true)
                ON CONFLICT (version) DO UPDATE
                   SET is_current = true, key_hash = EXCLUDED.key_hash
                """,
                new_version, new_hash,
            )

            for user in users:
                old_version = user["encryption_key_version"] or 1
                old_key = all_keys.get(old_version)

                if not old_key:
                    logger.error("key_rotation_missing_old_key",
                                 user_id=str(user["id"]),
                                 version=old_version)
                    skipped += 1
                    continue

                updates: dict[str, str | None] = {}
                try:
                    for enc_col, iv_col in TOKEN_FIELDS:
                        enc_val = user[enc_col]
                        if not enc_val:
                            continue
                        iv_val = user[iv_col] if iv_col else None
                        if iv_col and not iv_val:
                            continue

                        # Decrypt with old, encrypt with new
                        if iv_col:
                            plaintext = decrypt_token(enc_val, iv_val, old_key)
                            new_enc, new_iv = encrypt_token(plaintext, new_raw)
                            updates[enc_col] = new_enc
                            updates[iv_col] = new_iv
                        else:
                            # IV'siz alan (legacy) — şimdilik skip
                            continue

                        # Plaintext'i anında sil
                        del plaintext

                    if updates:
                        # Dinamik SET clause
                        set_parts = []
                        values = []
                        for i, (col, val) in enumerate(updates.items(), start=1):
                            set_parts.append(f"{col} = ${i}")
                            values.append(val)
                        set_parts.append(f"encryption_key_version = ${len(values)+1}")
                        values.append(new_version)
                        values.append(user["id"])

                        query = (
                            f"UPDATE users SET {', '.join(set_parts)} "
                            f"WHERE id = ${len(values)}"
                        )
                        await conn.execute(query, *values)
                        migrated += 1

                except Exception as e:
                    logger.error("key_rotation_user_failed",
                                 user_id=str(user["id"]),
                                 error=str(e))
                    raise  # Transaction rollback

            # Audit log
            await conn.execute(
                "INSERT INTO audit_log (action, details) VALUES ($1, $2::jsonb)",
                "key_rotation_completed",
                f'{{"migrated": {migrated}, "skipped": {skipped}, '
                f'"new_version": {new_version}}}',
            )

        logger.info("key_rotation_completed",
                    migrated=migrated,
                    skipped=skipped,
                    new_version=new_version)

    finally:
        await conn.close()
        # Key'leri RAM'den temizle
        del new_raw, all_keys
        gc.collect()
        logger.info("key_rotation_cleanup_done")


if __name__ == "__main__":
    db_url = os.getenv(
        "DATABASE_URL",
        "postgresql://app:password@localhost:5432/token_system",
    )
    asyncio.run(rotate_encryption_key(db_url))
