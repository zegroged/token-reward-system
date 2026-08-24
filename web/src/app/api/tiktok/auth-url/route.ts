import { NextResponse } from 'next/server';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { randomUUID } from 'crypto';
import redis from '@/lib/redis';

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || 'https://yourdomain.com/api/tiktok/callback';

const OAUTH_STATE_TTL = 600;

export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    // ★ CSRF Koruması: Rastgele, tek kullanımlık state token
    const stateToken = randomUUID();
    await redis.set(
      `oauth_state:${stateToken}`,
      payload.userId,
      'EX',
      OAUTH_STATE_TTL
    );

    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${TIKTOK_CLIENT_KEY}&response_type=code&scope=user.info.basic,video.list&redirect_uri=${encodeURIComponent(TIKTOK_REDIRECT_URI)}&state=${stateToken}`;

    return NextResponse.json({ url: authUrl });
  });
}
