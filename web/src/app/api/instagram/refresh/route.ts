import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { encryptToken, decryptToken } from '@/lib/crypto';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

const META_APP_SECRET = process.env.META_APP_SECRET || '';

/**
 * POST — Instagram long-lived token yenile (60 gün → yeni 60 gün)
 * ★ FIX O3: crypto.ts'deki encryptToken/decryptToken kullanılarak
 *   callback ve bot Python tarafıyla birebir uyumlu format üretilir.
 *   Eski kod hex+':'+authTag formatı kullanıyordu → bot okunamıyordu.
 */
export async function POST(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        instagramTokenEnc: true,
        instagramTokenIv: true,
        instagramTokenExpires: true,
        encryptionKeyVersion: true,
      },
    });

    if (!user?.instagramTokenEnc || !user?.instagramTokenIv) {
      return NextResponse.json({ error: 'Instagram bağlantısı bulunamadı' }, { status: 404 });
    }

    try {
      // ★ FIX O3: crypto.ts'deki decryptToken (HKDF + base64 format)
      const encKey = process.env.ENCRYPTION_KEY || '';
      const currentToken = decryptToken(
        user.instagramTokenEnc,
        user.instagramTokenIv,
        encKey
      );

      // Meta API'den yeni token al
      const refreshResponse = await fetch(
        `https://graph.instagram.com/refresh_access_token?` +
        `grant_type=ig_refresh_token&access_token=${currentToken}`
      );

      if (!refreshResponse.ok) {
        const errText = await refreshResponse.text();
        console.error('[IG_REFRESH] Failed:', errText);
        return NextResponse.json({ error: 'Token yenileme başarısız' }, { status: 502 });
      }

      const refreshData = await refreshResponse.json();
      const newToken = refreshData.access_token;
      const expiresIn = refreshData.expires_in || 5184000;

      // ★ FIX O3: crypto.ts'deki encryptToken (HKDF + base64 format)
      const { encryptedB64, ivHex } = encryptToken(newToken, encKey);
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      // DB güncelle — callback ile aynı format
      await prisma.user.update({
        where: { id: payload.userId },
        data: {
          instagramTokenEnc: encryptedB64,
          instagramTokenIv: ivHex,
          instagramTokenExpires: expiresAt,
        },
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'instagram_token_refreshed',
        details: { expires_at: expiresAt.toISOString() },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({
        message: 'Token başarıyla yenilendi',
        expiresAt: expiresAt.toISOString(),
        daysRemaining: Math.floor(expiresIn / 86400),
      });
    } catch (err) {
      console.error('[IG_REFRESH] Error:', err);
      return NextResponse.json(
        { error: 'Token yenileme hatası. Lütfen Instagram hesabınızı tekrar bağlayın.' },
        { status: 500 }
      );
    }
  });
}
