import { NextResponse } from 'next/server';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { randomUUID } from 'crypto';
import redis from '@/lib/redis';

const META_APP_ID = process.env.META_APP_ID || '';
const INSTAGRAM_REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI || 'https://yourdomain.com/api/instagram/callback';

// OAuth state TTL: 10 dakika
const OAUTH_STATE_TTL = 600;

export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    // ★ CSRF Koruması: Rastgele, tek kullanımlık state token oluştur
    // userId'yi doğrudan state'e koymak yerine Redis'te saklıyoruz
    const stateToken = randomUUID();
    await redis.set(
      `oauth_state:${stateToken}`,
      payload.userId,
      'EX',
      OAUTH_STATE_TTL
    );

    const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(INSTAGRAM_REDIRECT_URI)}&scope=user_profile,user_media&response_type=code&state=${stateToken}`;

    return NextResponse.json({ url: authUrl });
  });
}
