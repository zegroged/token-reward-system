import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware — Node.js Runtime
 * ★ FIX #5: Edge runtime'dan Node.js'e geçirildi — Redis'e doğrudan erişim
 * ★ FIX #16: CF header spoofing koruması — trust listesi
 */

// ★ Node.js runtime — Redis ve diğer Node modüllerine erişebilir
export const runtime = 'nodejs';

// ★ FIX BULGU-2: X-Real-IP tercih, XFF son eleman (Nginx gerçek IP'yi sona ekler)
function getClientIp(request: NextRequest): string {
  // 1. X-Real-IP — Nginx $remote_addr yazar, sahtelenmez
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  // 2. X-Forwarded-For — SON eleman (Nginx'in eklediği gerçek IP)
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1];
  }

  return '0.0.0.0';
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const ip = getClientIp(request);

  // ── Güvenlik Headerları ──
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // ── Bot Detection ──
  const ua = request.headers.get('user-agent') || '';
  const suspiciousBots = ['sqlmap', 'nikto', 'nmap', 'masscan', 'ZmEu'];
  if (suspiciousBots.some(bot => ua.toLowerCase().includes(bot.toLowerCase()))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── API Rate Limiting — Doğrudan Redis ──
  if (request.nextUrl.pathname.startsWith('/api/') &&
      !request.nextUrl.pathname.startsWith('/api/_internal/')) {
    const isAuthEndpoint = request.nextUrl.pathname.startsWith('/api/auth/');
    const endpoint = isAuthEndpoint ? 'auth' : 'api';

    try {
      // ★ FIX: Redis'e doğrudan erişim — iç fetch kaldırıldı (20ms/istek tasarruf)
      const { apiRateLimit } = await import('@/lib/rate-limit');
      const result = await apiRateLimit(ip, endpoint);

      if (!result.allowed) {
        return NextResponse.json(
          { error: 'Çok fazla istek. Lütfen bekleyin.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(result.resetInSeconds || 60),
              'X-RateLimit-Remaining': String(result.remaining || 0),
            },
          }
        );
      }
    } catch (err) {
      // Redis bağlantı hatası — fail-open ama logla
      console.error('[MIDDLEWARE] Rate limit error:', err);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // API routes + pages (exclude static files)
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
