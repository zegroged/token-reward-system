import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';
import { isVerified } from '@/lib/redis';
import { runAntiSybilChecks, isVirtualNumber } from '@/lib/anti-sybil';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      email,
      password,
      fullName,
      phone,
      kvkkConsent,
      kvkkDataProcessing,
      kvkkRetentionAccepted,
      fingerprint,  // Client tarafından gönderilen cihaz parmak izi
    } = body;

    // 1. Input doğrulama
    if (!email || !password || !fullName || !phone) {
      return NextResponse.json(
        { error: 'Tüm alanlar zorunludur (isim, e-posta, telefon, şifre)' },
        { status: 400 }
      );
    }

    // E-posta format kontrolü
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Geçersiz e-posta formatı' },
        { status: 400 }
      );
    }

    // Telefon format kontrolü
    const phoneClean = phone.replace(/\D/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 12) {
      return NextResponse.json(
        { error: 'Geçersiz telefon numarası' },
        { status: 400 }
      );
    }

    // ★ FIX L16: isVirtualNumber kontrolü anti-sybil'de yapılıyor — çift kontrol kaldırıldı

    // Şifre gücü kontrolü (min 8 karakter, 1 büyük, 1 küçük, 1 rakam)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return NextResponse.json(
        { error: 'Şifre en az 8 karakter, 1 büyük harf, 1 küçük harf ve 1 rakam içermelidir' },
        { status: 400 }
      );
    }

    // 2. KVKK onayları zorunlu
    if (!kvkkConsent || !kvkkDataProcessing || !kvkkRetentionAccepted) {
      return NextResponse.json(
        { error: 'Tüm KVKK onayları zorunludur' },
        { status: 400 }
      );
    }

    // 3. E-POSTA DOĞRULAMA KONTROLÜ — Redis'te doğrulanmış mı?
    const emailVerified = await isVerified('email', email.toLowerCase().trim());
    if (!emailVerified) {
      return NextResponse.json(
        { error: 'E-posta adresinizi doğrulamanız gerekiyor. Lütfen önce doğrulama kodu alın.' },
        { status: 403 }
      );
    }

    // 4. TELEFON DOĞRULAMA KONTROLÜ
    const phoneVerified = await isVerified('phone', phoneClean);
    if (!phoneVerified) {
      return NextResponse.json(
        { error: 'Telefon numaranızı doğrulamanız gerekiyor. Lütfen önce SMS doğrulama kodu alın.' },
        { status: 403 }
      );
    }

    // 5. Anti-Sybil kontrolleri (5 katmanlı)
    const clientIp = getClientIp(request);
    const sybilCheck = await runAntiSybilChecks({
      email: email.toLowerCase().trim(),
      phone: phoneClean,
      ip: clientIp,
      fingerprint: fingerprint || undefined,
    });

    if (!sybilCheck.passed) {
      return NextResponse.json(
        {
          error: sybilCheck.reasons[0],
          allReasons: sybilCheck.reasons,
          riskScore: sybilCheck.riskScore,
        },
        { status: 409 }
      );
    }

    // 6. Şifre hash'le
    const passwordHash = await bcrypt.hash(password, 12);

    // 7. Kullanıcı oluştur + bakiye kaydı (transaction)
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          phone: phoneClean,
          passwordHash,
          fullName: fullName.trim(),
          role: 'employee',
          emailVerified: true,
          phoneVerified: true,
          kvkkConsent: true,
          kvkkConsentAt: new Date(),
          kvkkDataProcessing: true,
          kvkkRetentionAccepted: true,
        },
      });

      // Bakiye kaydı oluştur
      await tx.balance.create({
        data: { userId: newUser.id },
      });

      return newUser;
    });

    // 8. Audit log (fingerprint dahil — gelecekte çift hesap tespiti için)
    await createAuditLog({
      userId: user.id,
      action: 'user_registered',
      details: {
        email: user.email,
        phone: phoneClean.substring(0, 4) + '****',
        emailVerified: true,
        phoneVerified: true,
        fingerprint: fingerprint || null,
        riskScore: sybilCheck.riskScore,
      },
      ipAddress: clientIp,
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      {
        message: 'Kayıt başarılı',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[REGISTER_ERROR]', error);
    return NextResponse.json(
      { error: 'Sunucu hatası' },
      { status: 500 }
    );
  }
}
