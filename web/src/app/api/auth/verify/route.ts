import { NextResponse } from 'next/server';
import { storeVerificationCode, verifyCode, markAsVerified } from '@/lib/redis';
import { generateVerificationCode, sendVerificationEmail, sendSmsVerification } from '@/lib/verification';

/**
 * POST — Doğrulama kodu gönder (e-posta veya SMS)
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { type, target } = body; // type: 'email' | 'phone', target: e-posta veya telefon

  if (!type || !target) {
    return NextResponse.json({ error: 'type ve target zorunlu' }, { status: 400 });
  }

  if (!['email', 'phone'].includes(type)) {
    return NextResponse.json({ error: 'type: email veya phone olmalı' }, { status: 400 });
  }

  // E-posta format kontrolü
  if (type === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(target)) {
      return NextResponse.json({ error: 'Geçersiz e-posta formatı' }, { status: 400 });
    }
  }

  // Telefon format kontrolü (Türkiye)
  if (type === 'phone') {
    const phoneClean = target.replace(/\D/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 12) {
      return NextResponse.json({ error: 'Geçersiz telefon numarası' }, { status: 400 });
    }
  }

  // Kod oluştur
  const code = generateVerificationCode();

  // Rate limit kontrolü + Redis'e kaydet
  const storeResult = await storeVerificationCode(type, target, code);
  if (!storeResult.success) {
    return NextResponse.json({
      error: `Çok sık istek. ${storeResult.waitSeconds} saniye bekleyin.`,
      waitSeconds: storeResult.waitSeconds,
    }, { status: 429 });
  }

  // Kodu gönder
  let sent = false;
  if (type === 'email') {
    sent = await sendVerificationEmail(target, code);
  } else {
    sent = await sendSmsVerification(target, code);
  }

  if (!sent) {
    return NextResponse.json({ error: 'Kod gönderilemedi. Lütfen tekrar deneyin.' }, { status: 500 });
  }

  return NextResponse.json({
    message: `Doğrulama kodu ${type === 'email' ? 'e-postanıza' : 'telefonunuza'} gönderildi`,
    expiresIn: 600, // 10 dakika
  });
}

/**
 * PATCH — Doğrulama kodunu onayla
 */
export async function PATCH(request: Request) {
  const body = await request.json();
  const { type, target, code } = body;

  if (!type || !target || !code) {
    return NextResponse.json({ error: 'type, target ve code zorunlu' }, { status: 400 });
  }

  if (code.length !== 6) {
    return NextResponse.json({ error: 'Kod 6 haneli olmalı' }, { status: 400 });
  }

  const isValid = await verifyCode(type, target, code);

  if (!isValid) {
    return NextResponse.json({ error: 'Geçersiz veya süresi dolmuş kod' }, { status: 401 });
  }

  // Doğrulanmış olarak işaretle (kayıt sırasında kontrol edilecek)
  await markAsVerified(type, target);

  return NextResponse.json({
    message: `${type === 'email' ? 'E-posta' : 'Telefon'} doğrulandı`,
    verified: true,
  });
}
