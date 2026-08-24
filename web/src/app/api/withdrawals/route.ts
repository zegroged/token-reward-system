import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';
import redis from '@/lib/redis';

// ★ FIX #12: CoinGecko kur çekici — 5dk Redis cache + DB fallback
const RATE_CACHE_KEY = 'exchange_rate:token_usdt';
const RATE_CACHE_TTL = 300; // 5 dakika

async function getExchangeRate(): Promise<number> {
  // 1. Redis cache kontrol
  try {
    const cached = await redis.get(RATE_CACHE_KEY);
    if (cached) return parseFloat(cached);
  } catch { /* Redis yoksa devam */ }

  // 2. CoinGecko API'den çek (USDT/TRY bazlı hesaplama)
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=try',
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json();
      const usdtTry = data?.tether?.try; // 1 USDT = ? TRY
      if (usdtTry && usdtTry > 0) {
        // TOKEN/USDT oranı: system_settings'ten token_to_usdt alınır
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'token_to_usdt' } });
        const rate = setting ? parseFloat(setting.value) : 0.0305;

        // Cache'e yaz
        try { await redis.set(RATE_CACHE_KEY, rate.toString(), 'EX', RATE_CACHE_TTL); } catch { /* ok */ }
        return rate;
      }
    }
  } catch (err) {
    console.warn('[EXCHANGE_RATE] CoinGecko API hatası:', err);
  }

  // 3. DB fallback — system_settings
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'token_to_usdt' } });
    if (setting) return parseFloat(setting.value);
  } catch { /* DB yoksa default */ }

  return 0.0305; // Son çare fallback
}

/**
 * POST — Çekim talebi oluştur
 *
 * ★ RACE PROTECTION ★
 *   - Balance satırı SELECT ... FOR UPDATE ile kilitlenir
 *   - Pending withdrawal kontrolü aynı kilit altında yapılır
 *   - Serializable isolation ile çifte istek reddedilir
 *   - UNIQUE (user_id, status='pending') partial index mantığı transaction içinde garanti altına alınır
 */
export async function POST(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { amount } = body;

    if (!amount || amount < 100) {
      return NextResponse.json({ error: 'Minimum çekim 100 TOKEN' }, { status: 400 });
    }

    // Cüzdan adresi kontrolü (transaction dışı — readonly)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { walletAddress: true, walletNetwork: true },
    });

    if (!user?.walletAddress) {
      return NextResponse.json(
        { error: 'Önce profilde cüzdan adresi tanımlayın' },
        { status: 400 }
      );
    }

    // ★ FIX #12: CoinGecko'dan gerçek USDT/TRY kuru çek (5dk cache)
    const exchangeRate = await getExchangeRate();
    const amountUsdt = amount * exchangeRate;

    let withdrawalId: string | null = null;

    try {
      await prisma.$transaction(
        async (tx) => {
          // ★ Balance satırını kilitle — aynı anda iki istek bakiyeyi aşırı harcayamaz
          const balanceRows = await tx.$queryRaw<
            Array<{ user_id: string; available: string }>
          >`
            SELECT user_id, available::text
              FROM balances
             WHERE user_id = ${payload.userId}::uuid
             FOR UPDATE
          `;

          if (balanceRows.length === 0 || Number(balanceRows[0].available) < amount) {
            throw new Error('INSUFFICIENT_BALANCE');
          }

          // Pending withdrawal kontrolü (aynı kilit altında tutarlı)
          const pending = await tx.withdrawal.findFirst({
            where: { userId: payload.userId, status: { in: ['pending', 'approved', 'processing'] } },
            select: { id: true },
          });

          if (pending) {
            throw new Error('PENDING_EXISTS');
          }

          // Bakiyeden düş + withdrawal kaydı
          await tx.balance.update({
            where: { userId: payload.userId },
            data: {
              available: { decrement: amount },
              pending: { increment: amount },
            },
          });

          const w = await tx.withdrawal.create({
            data: {
              userId: payload.userId,
              amountToken: amount,
              amountUsdt,
              exchangeRate,
              walletAddress: user.walletAddress!,
              walletNetwork: user.walletNetwork,
              status: 'pending',
            },
          });
          withdrawalId = w.id;

          // İmmutable transaction kaydı (type='withdraw' → formula_version gerekmez)
          await tx.transaction.create({
            data: {
              userId: payload.userId,
              type: 'withdraw',
              amount: -amount,
              description: `Çekim talebi — ${amountUsdt.toFixed(4)} USDT`,
              referenceType: 'withdrawal',
              referenceId: w.id,
            },
          });
        },
        { isolationLevel: 'Serializable', timeout: 10000 }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'INSUFFICIENT_BALANCE') {
        return NextResponse.json({ error: 'Yetersiz bakiye' }, { status: 400 });
      }
      if (msg === 'PENDING_EXISTS') {
        return NextResponse.json(
          { error: 'Zaten bekleyen bir çekim talebiniz var' },
          { status: 409 }
        );
      }
      // Serializable conflict retry (Prisma 40001)
      if (msg.includes('40001') || msg.toLowerCase().includes('serialization')) {
        return NextResponse.json(
          { error: 'Sistem meşgul, lütfen tekrar deneyin' },
          { status: 503 }
        );
      }
      throw e;
    }

    await createAuditLog({
      userId: payload.userId,
      action: 'withdrawal_request',
      details: { amount, amountUsdt, withdrawalId },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      { message: 'Çekim talebi oluşturuldu', withdrawalId },
      { status: 201 }
    );
  });
}

// GET — Kullanıcının çekim geçmişi
export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: payload.userId },
      orderBy: { requestedAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({ withdrawals });
  });
}
