/**
 * Redis Tabanlı Sliding Window Rate Limiter
 * In-memory Map yerine Redis kullanarak container-restart ve multi-instance uyumlu.
 */
import redis from '@/lib/redis';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Sliding window rate limiter — Redis INCR + EXPIRE ile.
 *
 * @param key — Benzersiz tanımlayıcı (örn: IP adresi veya "auth:192.168.1.1")
 * @param limit — Pencere içinde izin verilen max istek sayısı
 * @param windowSeconds — Zaman penceresi (saniye)
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number = 60
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;

  try {
    const multi = redis.multi();
    multi.incr(redisKey);
    multi.ttl(redisKey);
    const results = await multi.exec();

    if (!results) {
      // Redis hatası — izin ver (fail-open)
      return { allowed: true, remaining: limit, resetInSeconds: 0 };
    }

    const count = results[0][1] as number;
    const ttl = results[1][1] as number;

    // İlk istek ise TTL ayarla
    if (ttl === -1 || count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }

    const remaining = Math.max(0, limit - count);
    const resetInSeconds = ttl > 0 ? ttl : windowSeconds;

    return {
      allowed: count <= limit,
      remaining,
      resetInSeconds,
    };
  } catch (error) {
    // Redis bağlantı hatası — fail-open (izin ver)
    console.error('[RATE_LIMIT] Redis error:', error);
    return { allowed: true, remaining: limit, resetInSeconds: 0 };
  }
}

/**
 * API endpoint rate limit kontrolü için yardımcı.
 * Middleware'den veya API route'lardan çağrılabilir.
 */
export async function apiRateLimit(
  ip: string,
  endpoint: 'auth' | 'api' | 'general' = 'general'
): Promise<RateLimitResult> {
  const configs = {
    auth: { limit: 20, window: 60 },      // 20 istek / dakika
    api: { limit: 100, window: 60 },       // 100 istek / dakika
    general: { limit: 60, window: 60 },    // 60 istek / dakika
  };

  const config = configs[endpoint];
  return checkRateLimit(`${endpoint}:${ip}`, config.limit, config.window);
}
