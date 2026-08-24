import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '@/lib/db';
import {
  createSession,
  isAccountLocked,
  recordFailedLogin,
  clearLoginAttempts,
} from '@/lib/redis';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

// ★ Production'da JWT_SECRET zorunlu
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('KRİTİK: JWT_SECRET eksik!');
  return s || 'dev-secret-change-me';
})();
const JWT_EXPIRES = '15m';
const REFRESH_EXPIRES = '7d';

// ── DEV MODE kullanıcıları ──
// ★ FIX #6: İki koşul zorunlu — NODE_ENV=development VE DEV_MODE=true
const IS_DEV_MODE = process.env.NODE_ENV === 'development' && process.env.DEV_MODE === 'true';

const DEV_USERS: Record<string, any> = IS_DEV_MODE ? {
  'admin@test.com': { id: 'dev-admin-001', email: 'admin@test.com', fullName: 'Mert Admin', role: 'super_admin', forcePasswordChange: false },
  'kayit@test.com': { id: 'dev-reg-001', email: 'kayit@test.com', fullName: 'Kayıt Merkezi', role: 'registrar', forcePasswordChange: false },
  'calisan@test.com': { id: 'dev-emp-001', email: 'calisan@test.com', fullName: 'Test Çalışan', role: 'employee', forcePasswordChange: false },
} : {};

function createDevResponse(devUser: any) {
  const devToken = jwt.sign(
    { userId: devUser.id, email: devUser.email, role: devUser.role, sessionId: 'dev-session' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  return NextResponse.json({
    user: devUser,
    accessToken: devToken,
    refreshToken: devToken,
    sessionId: 'dev-session',
  });
}

export async function POST(request: Request) {
  // Body'yi parse et
  let email = '';
  let password = '';
  try {
    const body = await request.json();
    email = body.email || '';
    password = body.password || '';
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek' }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: 'E-posta ve şifre zorunlu' }, { status: 400 });
  }

  try {
    // Kullanıcıyı bul
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      return NextResponse.json({ error: 'E-posta veya şifre hatalı' }, { status: 401 });
    }

    // Hesap kilidi kontrolü
    const locked = await isAccountLocked(user.id);
    if (locked) {
      await createAuditLog({
        userId: user.id, action: 'login_blocked_locked',
        ipAddress: getClientIp(request), userAgent: getUserAgent(request),
      });
      return NextResponse.json({ error: 'Hesap kilitli. 30 dakika sonra tekrar deneyin.' }, { status: 423 });
    }

    if (!user.isActive) {
      return NextResponse.json({ error: 'Hesap deaktif edilmiş' }, { status: 403 });
    }

    // Şifre kontrolü
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      const lockResult = await recordFailedLogin(user.id);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lockResult.attempts,
          ...(lockResult.locked ? { lockedUntil: new Date(Date.now() + 30 * 60 * 1000) } : {}),
        },
      });
      await createAuditLog({
        userId: user.id, action: 'login_failed',
        details: { attempts: lockResult.attempts, locked: lockResult.locked },
        ipAddress: getClientIp(request), userAgent: getUserAgent(request),
      });
      return NextResponse.json({
        error: lockResult.locked
          ? 'Çok fazla başarısız deneme. Hesap 30 dakika kilitlendi.'
          : 'E-posta veya şifre hatalı',
      }, { status: 401 });
    }

    // Başarılı giriş
    await clearLoginAttempts(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginIp: getClientIp(request) },
    });

    const clientIp = getClientIp(request);
    const sessionId = await createSession(user.id, { ip: clientIp, userAgent: getUserAgent(request) });

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, sessionId },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    );
    const refreshToken = jwt.sign(
      { userId: user.id, sessionId, type: 'refresh' },
      JWT_SECRET, { expiresIn: REFRESH_EXPIRES }
    );

    await createAuditLog({
      userId: user.id, action: 'login_success', details: { sessionId },
      ipAddress: clientIp, userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      user: {
        id: user.id, email: user.email, fullName: user.fullName,
        role: user.role, forcePasswordChange: user.forcePasswordChange,
      },
      accessToken, refreshToken, sessionId,
    });
  } catch (error) {
    console.error('[LOGIN_ERROR]', error);

    // ── DEV MODE: DB/Redis olmadan test ──
    // ★ FIX #6: İki koşul zorunlu
    if (IS_DEV_MODE) {
      const devUser = DEV_USERS[email.toLowerCase()];
      if (devUser && password === 'demo123') {
        console.warn('[DEV_LOGIN] Dev kullanıcı ile giriş:', email);
        return createDevResponse(devUser);
      }
    }

    return NextResponse.json({ error: 'Sunucu hatası' }, { status: 500 });
  }
}
