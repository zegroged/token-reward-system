import Redis from 'ioredis';
import { randomUUID } from 'crypto';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

// ── Session Yönetimi ──
const MAX_SESSIONS = 3;
const SESSION_TTL = 7 * 24 * 3600; // 7 gün

export interface SessionInfo {
  ip: string;
  userAgent: string;
  city?: string;
  createdAt: number;
}

export async function createSession(
  userId: string,
  deviceInfo: { ip: string; userAgent: string; city?: string }
): Promise<string> {
  const sessionId = randomUUID();
  const sessionKey = `sessions:${userId}`;

  // Mevcut oturumları kontrol et
  const sessions = await redis.hgetall(sessionKey);
  const count = Object.keys(sessions).length;

  // Max session aşıldıysa en eski oturumu kapat
  if (count >= MAX_SESSIONS) {
    const entries = Object.entries(sessions)
      .map(([id, data]) => ({ id, ...(JSON.parse(data) as SessionInfo) }))
      .sort((a, b) => a.createdAt - b.createdAt);
    if (entries.length > 0) {
      await redis.hdel(sessionKey, entries[0].id);
    }
  }

  // Yeni oturum kaydet
  await redis.hset(
    sessionKey,
    sessionId,
    JSON.stringify({
      ip: deviceInfo.ip,
      userAgent: deviceInfo.userAgent,
      city: deviceInfo.city,
      createdAt: Date.now(),
    } satisfies SessionInfo)
  );
  await redis.expire(sessionKey, SESSION_TTL);

  return sessionId;
}

export async function validateSession(userId: string, sessionId: string): Promise<boolean> {
  return (await redis.hexists(`sessions:${userId}`, sessionId)) === 1;
}

export async function getActiveSessions(userId: string): Promise<(SessionInfo & { id: string })[]> {
  const sessions = await redis.hgetall(`sessions:${userId}`);
  return Object.entries(sessions).map(([id, data]) => ({
    id,
    ...(JSON.parse(data) as SessionInfo),
  }));
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  await redis.hdel(`sessions:${userId}`, sessionId);
}

export async function logoutAllDevices(userId: string): Promise<void> {
  await redis.del(`sessions:${userId}`);
}

// ── Account Lockout ──
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION = 30 * 60; // 30 dakika

export async function recordFailedLogin(userId: string): Promise<{ locked: boolean; attempts: number }> {
  const key = `login_attempts:${userId}`;
  const attempts = await redis.incr(key);
  await redis.expire(key, LOCKOUT_DURATION);

  if (attempts >= LOCKOUT_THRESHOLD) {
    await redis.set(`locked:${userId}`, '1', 'EX', LOCKOUT_DURATION);
    return { locked: true, attempts };
  }

  return { locked: false, attempts };
}

export async function isAccountLocked(userId: string): Promise<boolean> {
  return (await redis.exists(`locked:${userId}`)) === 1;
}

export async function clearLoginAttempts(userId: string): Promise<void> {
  await redis.del(`login_attempts:${userId}`);
  await redis.del(`locked:${userId}`);
}

// ── Doğrulama Kodu (E-posta + SMS) ──
const VERIFICATION_TTL = 600; // 10 dakika
const VERIFICATION_RATE_LIMIT = 60; // 60 saniye arasında yeni kod

export async function storeVerificationCode(
  type: 'email' | 'phone',
  target: string,
  code: string
): Promise<{ success: boolean; waitSeconds?: number }> {
  const rateKey = `verify_rate:${type}:${target}`;
  const codeKey = `verify_code:${type}:${target}`;

  // Rate limit kontrolü
  const rateTtl = await redis.ttl(rateKey);
  if (rateTtl > 0) {
    return { success: false, waitSeconds: rateTtl };
  }

  // Kodu kaydet
  await redis.set(codeKey, code, 'EX', VERIFICATION_TTL);
  // Rate limit kaydet
  await redis.set(rateKey, '1', 'EX', VERIFICATION_RATE_LIMIT);

  return { success: true };
}

export async function verifyCode(
  type: 'email' | 'phone',
  target: string,
  code: string
): Promise<boolean> {
  const codeKey = `verify_code:${type}:${target}`;
  const storedCode = await redis.get(codeKey);

  if (storedCode && storedCode === code) {
    await redis.del(codeKey); // Kullanıldıktan sonra sil
    return true;
  }
  return false;
}

export async function isVerified(type: 'email' | 'phone', target: string): Promise<boolean> {
  return (await redis.exists(`verified:${type}:${target}`)) === 1;
}

export async function markAsVerified(type: 'email' | 'phone', target: string): Promise<void> {
  // 1 saat boyunca doğrulanmış olarak işaretle (kayıt süreci için)
  await redis.set(`verified:${type}:${target}`, '1', 'EX', 3600);
}

export default redis;
