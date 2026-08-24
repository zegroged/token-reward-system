import prisma from './db';

interface AuditLogParams {
  userId?: string;
  action: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Audit log kaydı oluştur — tüm kritik işlemlerde çağrılır
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        details: params.details ? params.details : undefined,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    // Audit log yazımı ana işlemi engellememelidir
    console.error('[AUDIT_LOG_ERROR]', error);
  }
}

/**
 * Request'ten IP adresi çıkar (Nginx proxy chain)
 * ★ FIX BULGU-2: X-Forwarded-For'un SON elemanını oku.
 *   Nginx $proxy_add_x_forwarded_for → gerçek IP sona eklenir.
 *   İlk eleman saldırganın sahte değeri olabilir.
 *   X-Real-IP tercih edilir (Nginx $remote_addr → sahtelenemezhttps).
 */
export function getClientIp(request: Request): string {
  const headers = new Headers(request.headers);

  // 1. X-Real-IP — Nginx $remote_addr yazar, sahtelenmez
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  // 2. Cloudflare — güvenilir proxy
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  // 3. X-Forwarded-For — SON eleman (Nginx'in eklediği)
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1];  // Son eleman = Nginx'in yazdığı gerçek IP
  }

  return '0.0.0.0';
}

/**
 * Request'ten User Agent çıkar
 */
export function getUserAgent(request: Request): string {
  return new Headers(request.headers).get('user-agent') || 'unknown';
}
