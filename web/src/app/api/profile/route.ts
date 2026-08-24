import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import bcrypt from 'bcryptjs';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

// GET — Profil bilgileri
export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        instagramHandle: true,
        instagramUserId: true,
        walletAddress: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        instagramConnectedAt: true,
        tiktokHandle: true,
        tiktokConnectedAt: true,
        createdAt: true,
        balance: {
          select: { available: true, pending: true, totalEarned: true, totalWithdrawn: true },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
    }

    return NextResponse.json(user);
  });
}

// PATCH — Profil güncelle (şifre, cüzdan)
export async function PATCH(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { action } = body;

    // ── Şifre Değiştir ──
    if (action === 'change_password') {
      const { currentPassword, newPassword } = body;

      if (!currentPassword || !newPassword) {
        return NextResponse.json({ error: 'Mevcut ve yeni şifre zorunlu' }, { status: 400 });
      }

      if (newPassword.length < 8) {
        return NextResponse.json({ error: 'Yeni şifre en az 8 karakter' }, { status: 400 });
      }

      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
      if (!passwordRegex.test(newPassword)) {
        return NextResponse.json({
          error: 'Şifre en az 1 büyük harf, 1 küçük harf ve 1 rakam içermeli',
        }, { status: 400 });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { passwordHash: true },
      });

      if (!user) {
        return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
      }

      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) {
        return NextResponse.json({ error: 'Mevcut şifre yanlış' }, { status: 401 });
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: payload.userId },
        data: { passwordHash: newHash, forcePasswordChange: false },
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'password_changed',
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ message: 'Şifre başarıyla değiştirildi' });
    }

    // ── Cüzdan Güncelle ──
    if (action === 'update_wallet') {
      const { walletAddress } = body;

      if (!walletAddress) {
        return NextResponse.json({ error: 'Cüzdan adresi zorunlu' }, { status: 400 });
      }

      // TRC20 format doğrulama
      const trc20Regex = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
      if (!trc20Regex.test(walletAddress)) {
        return NextResponse.json({ error: 'Geçersiz TRC20 adresi' }, { status: 400 });
      }

      await prisma.user.update({
        where: { id: payload.userId },
        data: { walletAddress },
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'wallet_updated',
        details: { address_prefix: walletAddress.substring(0, 6) },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ message: 'Cüzdan adresi güncellendi' });
    }

    return NextResponse.json({ error: 'Geçersiz action' }, { status: 400 });
  });
}
