import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import redis from '@/lib/redis';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';
import { encryptToken } from '@/lib/crypto';

const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI || 'https://yourdomain.com/api/instagram/callback';

/**
 * GET — Instagram OAuth callback
 * ★ CSRF koruması: state parametresi Redis'ten doğrulanır (one-time token)
 * ★ encryptionKeyVersion DB'den dinamik okunur
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/dashboard/profile?ig_error=denied', request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/dashboard/profile?ig_error=missing_params', request.url));
  }

  // ★ CSRF KORUMASI: Redis'ten state → userId çöz + sil (one-time)
  const redisKey = `oauth_state:${state}`;
  const userId = await redis.get(redisKey);
  if (!userId) {
    console.warn('[IG_CALLBACK] Geçersiz veya süresi dolmuş OAuth state:', state);
    return NextResponse.redirect(new URL('/dashboard/profile?ig_error=invalid_state', request.url));
  }
  // Tek kullanım — hemen sil
  await redis.del(redisKey);

  try {
    // 1. Code → Short-lived token
    const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('[IG_CALLBACK] Token exchange failed:', await tokenResponse.text());
      return NextResponse.redirect(new URL('/dashboard/profile?ig_error=token_failed', request.url));
    }

    const tokenData = await tokenResponse.json();
    const shortToken = tokenData.access_token;
    const igUserId = tokenData.user_id?.toString();

    // ── ANTI-SYBIL: Aynı Instagram hesabı başka kullanıcıda mı? ──
    if (igUserId) {
      const existingIg = await prisma.user.findFirst({
        where: {
          instagramUserId: igUserId,
          id: { not: userId },
        },
        select: { email: true },
      });

      if (existingIg) {
        console.warn('[IG_CALLBACK] Duplicate IG account attempt', { igUserId, userId });
        await createAuditLog({
          userId,
          action: 'instagram_duplicate_blocked',
          details: {
            ig_user_id: igUserId,
            existing_user: existingIg.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
          },
          ipAddress: getClientIp(request),
          userAgent: getUserAgent(request),
        });
        return NextResponse.redirect(
          new URL('/dashboard/profile?ig_error=already_linked', request.url)
        );
      }
    }

    // 2. Short-lived → Long-lived token (60 gün)
    const longTokenResponse = await fetch(
      `https://graph.instagram.com/access_token?` +
      `grant_type=ig_exchange_token&client_secret=${META_APP_SECRET}&access_token=${shortToken}`
    );

    if (!longTokenResponse.ok) {
      console.error('[IG_CALLBACK] Long token exchange failed');
      return NextResponse.redirect(new URL('/dashboard/profile?ig_error=long_token_failed', request.url));
    }

    const longTokenData = await longTokenResponse.json();
    const longToken = longTokenData.access_token;
    const expiresIn = longTokenData.expires_in || 5184000;

    // 3. Kullanıcı bilgisini çek
    const userInfoResponse = await fetch(
      `https://graph.instagram.com/v19.0/me?fields=id,username&access_token=${longToken}`
    );
    const userInfo = await userInfoResponse.json();
    const igHandle = userInfo.username || '';

    // 4. Token'ı AES-256-GCM ile şifrele
    const encKey = process.env.ENCRYPTION_KEY || '';
    const { encryptedB64, ivHex } = encryptToken(longToken, encKey);

    // ★ FIX #8: Aktif encryption key versiyonunu DB'den oku
    let currentKeyVersion = 1;
    try {
      const activeKey = await prisma.encryptionKey.findFirst({
        where: { isCurrent: true },
        select: { version: true },
      });
      if (activeKey) currentKeyVersion = activeKey.version;
    } catch {
      // encryption_keys tablosu yoksa veya boşsa default 1
    }

    // 5. DB güncelle
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // ★ FIX L10: Eski bağlantı varsa audit logla (hesap kurtarma + iz)
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { instagramHandle: true, instagramUserId: true, instagramConnectedAt: true },
    });

    if (existingUser?.instagramHandle && existingUser.instagramHandle !== igHandle) {
      await createAuditLog({
        userId,
        action: 'instagram_connection_changed',
        details: {
          old_handle: existingUser.instagramHandle,
          old_user_id: existingUser.instagramUserId,
          old_connected_at: existingUser.instagramConnectedAt?.toISOString(),
          new_handle: igHandle,
          new_user_id: igUserId,
        },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        instagramHandle: igHandle,
        instagramUserId: igUserId,
        instagramTokenEnc: encryptedB64,
        instagramTokenIv: ivHex,
        instagramTokenExpires: expiresAt,
        instagramConnectedAt: new Date(),
        encryptionKeyVersion: currentKeyVersion,
      },
    });

    await createAuditLog({
      userId,
      action: 'instagram_connected',
      details: { ig_handle: igHandle, ig_user_id: igUserId, expires_at: expiresAt.toISOString(), key_version: currentKeyVersion },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.redirect(new URL('/dashboard/profile?ig_success=true', request.url));

  } catch (err) {
    console.error('[IG_CALLBACK] Error:', err);
    return NextResponse.redirect(new URL('/dashboard/profile?ig_error=server_error', request.url));
  }
}
