import { NextResponse } from 'next/server';
import { apiRateLimit } from '@/lib/rate-limit';

/**
 * Internal API — Redis Rate Limit Kontrolü
 * Edge Middleware'den çağrılır (Edge Runtime Redis import edemez).
 * Dışarıdan erişimi internal key ile engellenir.
 */
export async function GET(request: Request) {
  // Internal key doğrulaması
  const internalKey = request.headers.get('x-internal-key');
  const expectedKey = process.env.INTERNAL_API_KEY || 'internal-dev-key';

  if (internalKey !== expectedKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const ip = searchParams.get('ip') || '0.0.0.0';
  const endpoint = (searchParams.get('endpoint') || 'general') as 'auth' | 'api' | 'general';

  const result = await apiRateLimit(ip, endpoint);

  return NextResponse.json(result);
}
