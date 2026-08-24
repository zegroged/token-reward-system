import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import redis from '@/lib/redis';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';
import { encryptToken } from '@/lib/crypto';

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || 'https://yourdomain.com/api/tiktok/callback';

/**
 * GET — TikTok OAuth callback
 * ★ CSRF koruması: state Redis'ten doğrulanır (one-time)
 * ★ refresh_token null check (#7)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    // ★ FIX L17: Spesifik hata mesajları — scope reddedilmesi vs genel ret
    const errorDesc = searchParams.get('error_description') || '';
    const errType = errorDesc.includes('scope') || errorDesc.includes('permission')
      ? 'scope_denied'
      : 'denied';
    console.warn('[TT_CALLBACK] OAuth error:', error, errorDesc);
    return NextResponse.redirect(
      new URL(`/dashboard/profile?tt_error=${errType}&detail=${encodeURIComponent(errorDesc)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/dashboard/profile?tt_error=missing_params', request.url));
  }

  // ★ CSRF KORUMASI: Redis'ten state → userId çöz + sil (one-time)
  const redisKey = `oauth_state:${state}`;
  const userId = await redis.get(redisKey);
  if (!userId) {
    console.warn('[TT_CALLBACK] Geçersiz veya süresi dolmuş OAuth state:', state);
    return NextResponse.redirect(new URL('/dashboard/profile?tt_error=invalid_state', request.url));
  }
  await redis.del(redisKey);

  try {
    // 1. Code → Access Token + Refresh Token
    const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('[TT_CALLBACK] Token exchange failed:', await tokenResponse.text());
      return NextResponse.redirect(new URL('/dashboard/profile?tt_error=token_failed', request.url));
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token; // ★ Bazı hesap tiplerinde null olabilir
    const expiresIn = tokenData.expires_in || 86400;
    const openId = tokenData.open_id;

    if (!accessToken || !openId) {
      return NextResponse.redirect(new URL('/dashboard/profile?tt_error=invalid_response', request.url));
    }

    // ── ANTI-SYBIL: Aynı TikTok hesabı başka kullanıcıda mı? ──
    const existingTt = await prisma.user.findFirst({
      where: {
        tiktokUserId: openId,
        id: { not: userId },
      },
      select: { email: true },
    });

    if (existingTt) {
      console.warn('[TT_CALLBACK] Duplicate TikTok account attempt', { openId, userId });
      await createAuditLog({
        userId,
        action: 'tiktok_duplicate_blocked',
        details: {
          tiktok_open_id: openId,
          existing_user: existingTt.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
        },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });
      return NextResponse.redirect(
        new URL('/dashboard/profile?tt_error=already_linked', request.url)
      );
    }

    // 2. Kullanıcı bilgisini çek
    const userInfoRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const userInfo = await userInfoRes.json();
    const ttHandle = userInfo?.data?.user?.username || userInfo?.data?.user?.display_name || '';

    // 3. Token'ları AES-256-GCM ile şifrele
    const encKey = process.env.ENCRYPTION_KEY || '';
    const { encryptedB64: accessEnc, ivHex: accessIv } = encryptToken(accessToken, encKey);

    // ★ FIX #7: refresh_token null check — bazı TikTok hesap tiplerinde döndürülmez
    let refreshEnc: string | null = null;
    let refreshIv: string | null = null;
    if (refreshToken) {
      const encrypted = encryptToken(refreshToken, encKey);
      refreshEnc = encrypted.encryptedB64;
      refreshIv = encrypted.ivHex;
    }

    // ★ FIX #8: Aktif encryption key versiyonunu DB'den oku
    let currentKeyVersion = 1;
    try {
      const activeKey = await prisma.encryptionKey.findFirst({
        where: { isCurrent: true },
        select: { version: true },
      });
      if (activeKey) currentKeyVersion = activeKey.version;
    } catch { /* default 1 */ }

    // 4. DB güncelle
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        tiktokHandle: ttHandle,
        tiktokUserId: openId,
        tiktokTokenEnc: accessEnc,
        tiktokTokenIv: accessIv,
        tiktokTokenExpires: expiresAt,
        tiktokRefreshTokenEnc: refreshEnc,
        tiktokRefreshIv: refreshIv,
        tiktokConnectedAt: new Date(),
        encryptionKeyVersion: currentKeyVersion,
      },
    });

    await createAuditLog({
      userId,
      action: 'tiktok_connected',
      details: {
        tt_handle: ttHandle, tt_open_id: openId,
        expires_at: expiresAt.toISOString(),
        has_refresh: !!refreshToken,
        key_version: currentKeyVersion,
      },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.redirect(new URL('/dashboard/profile?tt_success=true', request.url));

  } catch (err) {
    console.error('[TT_CALLBACK] Error:', err);
    return NextResponse.redirect(new URL('/dashboard/profile?tt_error=server_error', request.url));
  }
}
