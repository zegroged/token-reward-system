import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '@/lib/db';
import { withRegistrar, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';
import { isVerified } from '@/lib/redis';
import { runAntiSybilChecks, isVirtualNumber } from '@/lib/anti-sybil';

/**
 * Otomatik güçlü şifre üretici
 * 12 karakter: büyük + küçük + rakam + özel karakter
 */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%';

  let pass = '';
  pass += upper[crypto.randomInt(upper.length)];
  pass += upper[crypto.randomInt(upper.length)];
  pass += lower[crypto.randomInt(lower.length)];
  pass += lower[crypto.randomInt(lower.length)];
  pass += lower[crypto.randomInt(lower.length)];
  pass += digits[crypto.randomInt(digits.length)];
  pass += digits[crypto.randomInt(digits.length)];
  pass += digits[crypto.randomInt(digits.length)];
  pass += special[crypto.randomInt(special.length)];

  // Kalan 3 karakter rastgele
  const all = upper + lower + digits;
  for (let i = 0; i < 3; i++) {
    pass += all[crypto.randomInt(all.length)];
  }

  // ★ FIX N8: Fisher-Yates shuffle (crypto.randomInt — unbiased, kriptografik)
  const arr = pass.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

/**
 * POST /api/registrar/create-employee
 * Kayıt Merkezi çalışanı yeni çalışan oluşturur
 */
export async function POST(request: Request) {
  return withRegistrar(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const {
      fullName,
      email,
      phone,
      kvkkConsent,
      kvkkDataProcessing,
      kvkkRetentionAccepted,
    } = body;

    // 1. Input doğrulama
    if (!fullName || !email || !phone) {
      return NextResponse.json(
        { error: 'İsim, e-posta ve telefon zorunludur' },
        { status: 400 }
      );
    }

    // E-posta format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Geçersiz e-posta formatı' }, { status: 400 });
    }

    // Telefon format
    const phoneClean = phone.replace(/\D/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 12) {
      return NextResponse.json({ error: 'Geçersiz telefon numarası' }, { status: 400 });
    }

    // Sanal numara kontrolü
    if (isVirtualNumber(phone)) {
      return NextResponse.json(
        { error: 'Sanal veya geçici numaralar kabul edilmiyor.' },
        { status: 400 }
      );
    }

    // 2. KVKK zorunlu
    if (!kvkkConsent || !kvkkDataProcessing || !kvkkRetentionAccepted) {
      return NextResponse.json(
        { error: 'Tüm KVKK onayları zorunludur' },
        { status: 400 }
      );
    }

    // 3. E-posta ve telefon doğrulanmış mı?
    const emailVerified = await isVerified('email', email.toLowerCase().trim());
    if (!emailVerified) {
      return NextResponse.json(
        { error: 'Önce e-posta doğrulaması yapılmalıdır' },
        { status: 403 }
      );
    }

    const phoneVerified = await isVerified('phone', phoneClean);
    if (!phoneVerified) {
      return NextResponse.json(
        { error: 'Önce telefon doğrulaması yapılmalıdır' },
        { status: 403 }
      );
    }

    // 4. Anti-Sybil kontrolleri
    // ★ FIX N13: Registrar akışında IP limiti atlanır (ofiste seri kayıt)
    const clientIp = getClientIp(request);
    const sybilCheck = await runAntiSybilChecks({
      email: email.toLowerCase().trim(),
      phone: phoneClean,
      ip: clientIp,
      isRegistrarFlow: true,  // IP bazlı kayıt limiti devre dışı
    });

    if (!sybilCheck.passed) {
      return NextResponse.json(
        { error: sybilCheck.reasons[0], allReasons: sybilCheck.reasons },
        { status: 409 }
      );
    }

    // 5. Otomatik şifre üret
    const autoPassword = generatePassword();
    const passwordHash = await bcrypt.hash(autoPassword, 12);

    // 6. Kullanıcı oluştur
    try {
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
            forcePasswordChange: true, // İlk girişte şifre değiştirmeli
            registeredById: payload.userId, // Kaydeden kişi
          },
        });

        await tx.balance.create({
          data: { userId: newUser.id },
        });

        return newUser;
      });

      // 7. Audit log
      await createAuditLog({
        userId: payload.userId,
        action: 'employee_created_by_registrar',
        details: {
          newUserId: user.id,
          newUserEmail: user.email,
          newUserName: user.fullName,
          phone: phoneClean.substring(0, 4) + '****',
        },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({
        message: 'Çalışan başarıyla oluşturuldu',
        employee: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
        },
        credentials: {
          email: user.email,
          password: autoPassword, // Sadece bir kez gösterilir!
        },
      }, { status: 201 });

    } catch (err: any) {
      if (err.code === 'P2002') {
        return NextResponse.json(
          { error: 'Bu e-posta veya telefon zaten kayıtlı' },
          { status: 409 }
        );
      }
      console.error('[REGISTRAR_CREATE_ERROR]', err);
      return NextResponse.json({ error: 'Sunucu hatası' }, { status: 500 });
    }
  });
}
