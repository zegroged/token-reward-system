/**
 * Anti-Sybil Koruma Modülü
 * Birden fazla hesap açılmasını önleyen 5 katmanlı güvenlik
 * 
 * Katman 1: Instagram user_id UNIQUE (en güçlü — sahte IG hesabı zor)
 * Katman 2: Telefon numara doğrulama + sanal numara engelleme
 * Katman 3: Cihaz parmak izi (browser fingerprint)
 * Katman 4: IP bazlı kayıt limiti
 * Katman 5: Admin onay sistemi (opsiyonel)
 */

import prisma from '@/lib/db';

// ── Katman 2: Sanal/Geçici Numara Tespiti ──

// Bilinen sanal numara prefixleri (Türkiye)
const BLOCKED_PREFIXES = [
  '0850', '850',   // Sanal hat
  '0312900',       // VoIP
  '0212900',       // VoIP
];

// Bilinen geçici numara servisleri (uluslararası)
const VIRTUAL_NUMBER_PATTERNS = [
  /^900/,          // Premium hat
  /^800/,          // Ücretsiz hat
  /^444/,          // Çağrı merkezi
];

export function isVirtualNumber(phone: string): boolean {
  const clean = phone.replace(/[\s\-\+]/g, '').replace(/^90/, '').replace(/^0/, '');
  
  // Türk GSM numarası kontrolü: 5XX ile başlamalı
  if (!clean.startsWith('5')) {
    return true; // Mobil değil = sanal
  }
  
  // Uzunluk kontrolü
  if (clean.length !== 10) {
    return true;
  }

  // Bilinen sanal prefix kontrolü
  for (const prefix of BLOCKED_PREFIXES) {
    if (phone.includes(prefix)) return true;
  }

  // Pattern kontrolü
  for (const pattern of VIRTUAL_NUMBER_PATTERNS) {
    if (pattern.test(clean)) return true;
  }

  return false;
}

// ── Katman 3: Cihaz Parmak İzi ──

export interface DeviceFingerprint {
  userAgent: string;
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  cookieEnabled: boolean;
  canvasHash?: string;  // Canvas fingerprint
}

/**
 * Cihaz parmak izi hash oluştur — SHA-256
 * ★ FIX #13: DJBx33 → SHA-256 (kriptografik, çarpışma dirençli)
 */
export function generateFingerprintHash(fp: DeviceFingerprint): string {
  const { createHash } = require('crypto');
  const raw = [
    fp.userAgent,
    fp.screenResolution,
    fp.timezone,
    fp.language,
    fp.platform,
    fp.canvasHash || '',
  ].join('|');

  return createHash('sha256').update(raw).digest('hex');
}

// ── Katman 4: IP Bazlı Kayıt Limiti (Redis tabanlı) ──

import redis from '@/lib/redis';

const MAX_REGISTRATIONS_PER_IP = 2;       // Aynı IP'den max 2 kayıt
const REGISTRATION_WINDOW_SECONDS = 24 * 60 * 60;  // 24 saat

export async function checkIpRegistrationLimit(ip: string): Promise<{ allowed: boolean; reason?: string }> {
  const redisKey = `reg_limit:${ip}`;

  try {
    const count = await redis.incr(redisKey);

    // İlk kayıt → TTL ayarla
    if (count === 1) {
      await redis.expire(redisKey, REGISTRATION_WINDOW_SECONDS);
    }

    if (count > MAX_REGISTRATIONS_PER_IP) {
      return {
        allowed: false,
        reason: `Bu IP adresinden son 24 saatte ${MAX_REGISTRATIONS_PER_IP} kayıt yapılmış. Lütfen daha sonra deneyin.`,
      };
    }

    return { allowed: true };
  } catch (error) {
    // Redis hatası — fail-open (izin ver ama logla)
    console.error('[ANTI_SYBIL] Redis IP limit error:', error);
    return { allowed: true };
  }
}

// ── Katman 1 + Bütünleşik Kontrol ──

export interface AntiSybilCheck {
  passed: boolean;
  reasons: string[];
  riskScore: number;  // 0-100, yüksek = riskli
}

/**
 * Kayıt öncesi tüm anti-sybil kontrollerini çalıştır
 */
export async function runAntiSybilChecks(data: {
  email: string;
  phone: string;
  ip: string;
  fingerprint?: string;
  isRegistrarFlow?: boolean;  // ★ FIX N13: Registrar IP limiti atla
}): Promise<AntiSybilCheck> {
  const reasons: string[] = [];
  let riskScore = 0;

  // 1. E-posta benzersizlik
  const existingEmail = await prisma.user.findUnique({
    where: { email: data.email },
  });
  if (existingEmail) {
    reasons.push('Bu e-posta adresi zaten kayıtlı');
    riskScore += 100;
  }

  // 2. Telefon benzersizlik
  const existingPhone = await prisma.user.findFirst({
    where: { phone: data.phone },
  });
  if (existingPhone) {
    reasons.push('Bu telefon numarası zaten kayıtlı');
    riskScore += 100;
  }

  // 3. Sanal numara kontrolü
  if (isVirtualNumber(data.phone)) {
    reasons.push('Sanal veya geçici telefon numaraları kabul edilmiyor. Lütfen gerçek GSM numaranızı kullanın.');
    riskScore += 80;
  }

  // 4-5. IP limitleri — ★ FIX N13: Registrar akışında atla (ofiste seri kayıt)
  if (!data.isRegistrarFlow) {
    // 4. IP limiti
    const ipCheck = await checkIpRegistrationLimit(data.ip);
    if (!ipCheck.allowed) {
      reasons.push(ipCheck.reason!);
      riskScore += 60;
    }

    // 5. Aynı IP'den kayıt sayısı
    const sameIpRegistrations = await prisma.auditLog.count({
      where: {
        action: 'user_registered',
        ipAddress: data.ip,
      },
    });
    if (sameIpRegistrations >= 3) {
      reasons.push('Bu ağdan çok sayıda hesap oluşturulmuş');
      riskScore += 40;
    }
  }

  // 6. Cihaz parmak izi kontrolü (fingerprint veritabanında varsa)
  if (data.fingerprint) {
    const existingDevice = await prisma.auditLog.findFirst({
      where: {
        action: 'user_registered',
        details: {
          path: ['fingerprint'],
          equals: data.fingerprint,
        },
      },
    });
    if (existingDevice) {
      reasons.push('Bu cihazdan daha önce kayıt yapılmış');
      riskScore += 70;
    }
  }

  // 7. Disposable email kontrolü
  const emailDomain = data.email.split('@')[1]?.toLowerCase();
  if (DISPOSABLE_EMAIL_DOMAINS.includes(emailDomain)) {
    reasons.push('Geçici e-posta servisleri kabul edilmiyor');
    riskScore += 90;
  }

  return {
    passed: riskScore < 50,
    reasons,
    riskScore: Math.min(riskScore, 100),
  };
}

// ── Bilinen Geçici E-posta Domainleri ──
const DISPOSABLE_EMAIL_DOMAINS = [
  'tempmail.com', 'throwaway.email', 'guerrillamail.com', 'mailinator.com',
  'temp-mail.org', 'fakeinbox.com', 'sharklasers.com', 'guerrillamailblock.com',
  'grr.la', 'dispostable.com', 'yopmail.com', 'trashmail.com', 'trashmail.net',
  'tempail.com', 'bugmenot.com', 'maildrop.cc', '10minutemail.com',
  'minutemail.com', 'emailondeck.com', 'getairmail.com', 'mohmal.com',
  'tempmailo.com', 'burnermail.io', 'inboxkitten.com', 'mailnesia.com',
  'nada.email', 'anonbox.net', 'discard.email', 'tmpmail.net',
  'harakirimail.com', 'emailfake.com', 'crazymailing.com', 'tmail.link',
];

// ── Instagram Çift Hesap Koruması ──

/**
 * Instagram hesabının başka bir kullanıcıda kayıtlı olup olmadığını kontrol et
 */
export async function checkInstagramUniqueness(
  instagramUserId: string,
  currentUserId: string
): Promise<{ unique: boolean; existingUserEmail?: string }> {
  const existing = await prisma.user.findFirst({
    where: {
      instagramUserId,
      id: { not: currentUserId },
    },
    select: { email: true },
  });

  if (existing) {
    return {
      unique: false,
      existingUserEmail: existing.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
    };
  }

  return { unique: true };
}
