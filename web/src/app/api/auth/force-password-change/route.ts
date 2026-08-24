import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

/**
 * POST /api/auth/force-password-change
 * İlk giriş sonrası zorunlu şifre değiştirme
 * Mevcut şifre istenmez — sadece forcePasswordChange=true olan kullanıcılar erişebilir
 */
export async function POST(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { newPassword } = body;

    if (!newPassword) {
      return NextResponse.json({ error: 'Yeni şifre zorunlu' }, { status: 400 });
    }

    // Şifre gücü kontrolü
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return NextResponse.json(
        { error: 'Şifre en az 8 karakter, 1 büyük harf, 1 küçük harf ve 1 rakam içermelidir' },
        { status: 400 }
      );
    }

    // forcePasswordChange aktif mi kontrol et
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { forcePasswordChange: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
    }

    if (!user.forcePasswordChange) {
      return NextResponse.json(
        { error: 'Şifre değişikliği zorunlu değil. Normal profil sayfasından değiştirebilirsiniz.' },
        { status: 400 }
      );
    }

    // Şifreyi güncelle
    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: payload.userId },
      data: {
        passwordHash: newHash,
        forcePasswordChange: false,
      },
    });

    await createAuditLog({
      userId: payload.userId,
      action: 'force_password_changed',
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ message: 'Şifre başarıyla değiştirildi' });
  });
}
