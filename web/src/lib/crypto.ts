/**
 * Paylaşılan Şifreleme Modülü — AES-256-GCM + HKDF
 * Python (bot/security/token_encryption.py) ile birebir uyumlu.
 *
 * Anahtar türetme: HKDF-SHA256(rawKey, salt=null, info="token-encryption-v1", len=32)
 * Şifreleme: AES-256-GCM, 12-byte random IV
 * Format: base64(ciphertext + authTag), hex(iv)
 */
import crypto from 'crypto';

/**
 * Raw string key'i HKDF ile 32 byte'a türet.
 * Python tarafıyla birebir aynı parametreler:
 *   algorithm=SHA256, length=32, salt=empty, info="token-encryption-v1"
 */
function deriveKey(rawKey: string): Buffer {
  const keyBytes = Buffer.from(rawKey, 'utf-8');
  return crypto.hkdfSync(
    'sha256',
    keyBytes,
    Buffer.alloc(0),                        // salt = None (Python'da da None)
    Buffer.from('token-encryption-v1'),      // info
    32                                       // 32 byte = AES-256
  ) as Buffer;
}

/**
 * Token'ı AES-256-GCM ile şifrele.
 * Python'un decrypt_token() fonksiyonunun okuyabileceği format üretir.
 *
 * @returns { encryptedB64: base64(ciphertext+authTag), ivHex: hex(iv) }
 */
export function encryptToken(
  plaintext: string,
  rawKey: string
): { encryptedB64: string; ivHex: string } {
  const key = deriveKey(rawKey);

  // 12-byte random IV
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  // Python'un beklediği format: base64(ciphertext + authTag)
  // Python'da AESGCM.encrypt() → ciphertext+tag birleşik döner
  // Python'da AESGCM.decrypt() → ciphertext+tag birleşik bekler
  const combined = Buffer.concat([encrypted, authTag]);
  const encryptedB64 = combined.toString('base64');
  const ivHex = iv.toString('hex');

  return { encryptedB64, ivHex };
}

/**
 * AES-256-GCM ile şifrelenmiş token'ı çöz.
 * Python'un encrypt_token() fonksiyonunun ürettiği formatı okur.
 *
 * @param encryptedB64 — base64(ciphertext + authTag)
 * @param ivHex — hex encoded 12-byte IV
 * @param rawKey — raw string key (HKDF ile türetilecek)
 */
export function decryptToken(
  encryptedB64: string,
  ivHex: string,
  rawKey: string
): string {
  const key = deriveKey(rawKey);
  const iv = Buffer.from(ivHex, 'hex');
  const combined = Buffer.from(encryptedB64, 'base64');

  // Son 16 byte = auth tag, geri kalanı = ciphertext
  const ciphertext = combined.subarray(0, combined.length - 16);
  const authTag = combined.subarray(combined.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
