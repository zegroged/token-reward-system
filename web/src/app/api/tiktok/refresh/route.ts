import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { encryptToken, decryptToken } from '@/lib/crypto';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';

/**
 * POST — TikTok access token yenileme (refresh_token ile)
 * TikTok access token ~24 saat geçerli, refresh token ile yenilenir.
 */
export async function POST(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        tiktokRefreshTokenEnc: true,
        tiktokRefreshIv: true,
        tiktokUserId: true,
      },
    });

    if (!user?.tiktokRefreshTokenEnc || !user?.tiktokRefreshIv) {
      return NextResponse.json({ error: 'TikTok hesabı bağlı değil' }, { status: 400 });
    }

    try {
      // Refresh token'ı decrypt
      const encKey = process.env.ENCRYPTION_KEY || '';
      const refreshToken = decryptToken(
        user.tiktokRefreshTokenEnc,
        user.tiktokRefreshIv,
        encKey
      );

      // TikTok API ile yeni access token al
      const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: TIKTOK_CLIENT_KEY,
          client_secret: TIKTOK_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[TT_REFRESH] Failed:', errorText);
        return NextResponse.json(
          { error: 'TikTok token yenileme başarısız. Lütfen tekrar bağlayın.' },
          { status: 400 }
        );
      }

      const tokenData = await tokenResponse.json();
      const newAccessToken = tokenData.access_token;
      const newRefreshToken = tokenData.refresh_token;
      const expiresIn = tokenData.expires_in || 86400;

      // Yeni token'ları şifrele
      const { encryptedB64: accessEnc, ivHex: accessIv } = encryptToken(newAccessToken, encKey);
      const { encryptedB64: refreshEnc, ivHex: refreshIv } = encryptToken(newRefreshToken, encKey);

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      // DB güncelle
      await prisma.user.update({
        where: { id: payload.userId },
        data: {
          tiktokTokenEnc: accessEnc,
          tiktokTokenIv: accessIv,
          tiktokTokenExpires: expiresAt,
          tiktokRefreshTokenEnc: refreshEnc,
          tiktokRefreshIv: refreshIv,
        },
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'tiktok_token_refreshed',
        details: { expires_at: expiresAt.toISOString() },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({
        message: 'TikTok token yenilendi',
        expiresAt: expiresAt.toISOString(),
      });

    } catch (err) {
      console.error('[TT_REFRESH] Error:', err);
      return NextResponse.json(
        { error: 'Token yenileme hatası. Lütfen TikTok hesabınızı tekrar bağlayın.' },
        { status: 500 }
      );
    }
  });
}
