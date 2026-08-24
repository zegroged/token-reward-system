import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { validateSession } from '@/lib/redis';
import prisma from '@/lib/db';

// ★ Production'da JWT_SECRET zorunlu
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('KRİTİK: JWT_SECRET eksik!');
  return s || 'dev-secret-change-me';
})();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { refreshToken } = body;

    if (!refreshToken) {
      return NextResponse.json({ error: 'Refresh token gerekli' }, { status: 400 });
    }

    // Verify refresh token
    const payload = jwt.verify(refreshToken, JWT_SECRET) as {
      userId: string;
      sessionId: string;
      type: string;
    };

    if (payload.type !== 'refresh') {
      return NextResponse.json({ error: 'Geçersiz token tipi' }, { status: 401 });
    }

    // Session hâlâ geçerli mi?
    const sessionValid = await validateSession(payload.userId, payload.sessionId);
    if (!sessionValid) {
      return NextResponse.json({ error: 'Oturum sona ermiş' }, { status: 401 });
    }

    // ★ FIX: User'ı DB'den çek — email ve role dahil et (rol değişikliklerini de yakalar)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Kullanıcı bulunamadı veya deaktif' }, { status: 401 });
    }

    // Yeni access token oluştur — email + role dahil
    const newAccessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: payload.sessionId,
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    return NextResponse.json({ accessToken: newAccessToken });
  } catch {
    return NextResponse.json({ error: 'Token geçersiz veya süresi dolmuş' }, { status: 401 });
  }
}
