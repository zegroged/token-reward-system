import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

/**
 * GET /api/profile — Kullanıcı profil bilgileri
 * (Mevcut dosya zaten var, bu PATCH eklemesi)
 */

/**
 * PATCH /api/profile — Profil güncelleme + şifre değişikliği
 */
export async function PATCH(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { action } = body;

    if (action === 'change_password') {
      const { currentPassword, newPassword } = body;

      if (!currentPassword || !newPassword) {
        return NextResponse.json({ error: 'Mevcut ve yeni şifre zorunlu' }, { status: 400 });
      }

      if (newPassword.length < 8) {
        return NextResponse.json({ error: 'Yeni şifre en az 8 karakter olmalı' }, { status: 400 });
      }

      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
      if (!passwordRegex.test(newPassword)) {
        return NextResponse.json(
          { error: 'Şifre en az 1 büyük, 1 küçük harf ve 1 rakam içermeli' },
          { status: 400 }
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user) {
        return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
      }

      const validCurrent = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!validCurrent) {
        return NextResponse.json({ error: 'Mevcut şifre yanlış' }, { status: 401 });
      }

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
        action: 'password_changed',
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ message: 'Şifre başarıyla değiştirildi' });
    }

    if (action === 'update_profile') {
      const { fullName } = body;

      if (!fullName || fullName.trim().length < 2) {
        return NextResponse.json({ error: 'Geçerli bir isim girin' }, { status: 400 });
      }

      await prisma.user.update({
        where: { id: payload.userId },
        data: { fullName: fullName.trim() },
      });

      return NextResponse.json({ message: 'Profil güncellendi' });
    }

    if (action === 'update_wallet') {
      const { walletAddress } = body;

      // TRC20 doğrulama
      if (walletAddress && (!walletAddress.startsWith('T') || walletAddress.length !== 34)) {
        return NextResponse.json({ error: 'Geçersiz TRC20 cüzdan adresi' }, { status: 400 });
      }

      await prisma.user.update({
        where: { id: payload.userId },
        data: { walletAddress: walletAddress || null },
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'wallet_updated',
        details: { wallet: walletAddress ? walletAddress.substring(0, 8) + '...' : 'removed' },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ message: 'Cüzdan adresi güncellendi' });
    }

    return NextResponse.json({ error: 'Geçersiz action' }, { status: 400 });
  });
}
