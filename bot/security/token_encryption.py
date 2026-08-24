"""
AES-256-GCM Token Şifreleme — Key Versiyonlu
Instagram OAuth token'larını şifreler/deşifreler.
"""
import os
import gc
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import structlog

logger = structlog.get_logger()


def _derive_key(raw_key: str) -> bytes:
    """Raw string key'i 32 byte'a normalize et"""
    key_bytes = raw_key.encode('utf-8')
    # SHA-256 ile 32 byte'a indir
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"token-encryption-v1",
    ).derive(key_bytes)


def encrypt_token(plaintext: str, raw_key: str) -> tuple[str, str]:
    """
    Token'ı AES-256-GCM ile şifrele.
    Returns: (encrypted_b64, iv_hex)
    """
    key = _derive_key(raw_key)
    aesgcm = AESGCM(key)
    
    # Random 12-byte IV
    iv = os.urandom(12)
    
    # Encrypt
    ciphertext = aesgcm.encrypt(iv, plaintext.encode('utf-8'), None)
    
    # Base64 encode for storage
    encrypted_b64 = base64.b64encode(ciphertext).decode('utf-8')
    iv_hex = iv.hex()
    
    # Cleanup
    del key, aesgcm
    gc.collect()
    
    logger.debug("token_encrypted", iv_length=len(iv_hex))
    return encrypted_b64, iv_hex


def decrypt_token(encrypted_b64: str, iv_hex: str, raw_key: str) -> str:
    """
    AES-256-GCM ile şifrelenmiş token'ı deşifrele.
    Returns: plaintext token
    """
    key = _derive_key(raw_key)
    aesgcm = AESGCM(key)
    
    iv = bytes.fromhex(iv_hex)
    ciphertext = base64.b64decode(encrypted_b64)
    
    plaintext = aesgcm.decrypt(iv, ciphertext, None).decode('utf-8')
    
    # Cleanup
    del key, aesgcm
    gc.collect()
    
    logger.debug("token_decrypted")
    return plaintext
