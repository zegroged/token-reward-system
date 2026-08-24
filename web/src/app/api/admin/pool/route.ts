import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

/**
 * GET — Havuz bilgisi + istatistikler + geçmiş
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    // Son pool kaydından running_balance al
    const lastPool = await prisma.pool.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    // Toplam istatistikler
    const stats = await prisma.pool.groupBy({
      by: ['action'],
      _sum: { amount: true },
      _count: true,
    });

    const totalDeposit = stats.find(s => s.action === 'deposit')?._sum?.amount || 0;
    const totalDistribution = stats.find(s => s.action === 'distribution')?._sum?.amount || 0;
    const totalWithdrawal = stats.find(s => s.action === 'withdrawal_out')?._sum?.amount || 0;

    // Aktif çalışan sayısı
    const activeUsers = await prisma.user.count({
      where: { isActive: true, role: 'employee' },
    });

    // Bekleyen çekim toplamı
    const pendingWithdrawals = await prisma.withdrawal.aggregate({
      where: { status: 'pending' },
      _sum: { amountToken: true },
      _count: true,
    });

    // Son 30 pool hareketi
    const history = await prisma.pool.findMany({
      take: 30,
      orderBy: { createdAt: 'desc' },
      include: { admin: { select: { fullName: true } } },
    });

    // Günlük ortalama dağıtım (son 30 gün)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentDistributions = await prisma.pool.aggregate({
      where: { action: 'distribution', createdAt: { gte: thirtyDaysAgo } },
      _sum: { amount: true },
    });
    const dailyAvg = Number(recentDistributions._sum?.amount || 0) / 30;

    // Kaç gün yeter hesabı
    const currentBalance = Number(lastPool?.runningBalance || 0);
    const daysRemaining = dailyAvg > 0 ? Math.floor(currentBalance / dailyAvg) : 999;

    return NextResponse.json({
      currentBalance,
      totalDeposit,
      totalDistribution,
      totalWithdrawal,
      activeUsers,
      pendingWithdrawals: {
        count: pendingWithdrawals._count,
        totalAmount: pendingWithdrawals._sum?.amountToken || 0,
      },
      dailyAvgDistribution: Math.round(dailyAvg * 100) / 100,
      daysRemaining,
      history,
    });
  });
}

/**
 * POST — Havuza para ekle
 * Admin USDT satın alıp cüzdana yükledikten sonra buradan TOKEN karşılığını havuza ekler.
 * 
 * Flow:
 * 1. Admin borsadan USDT alır → şirket TRON cüzdanına gönderir
 * 2. Admin bu API'den havuza TOKEN yükler
 * 3. Bot günlük dağıtım yaparken bu havuzdan kullanır
 * 4. Çekim onaylandığında havuzdan USDT olarak çıkar
 */
export async function POST(request: Request) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { amount, description, depositType } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Geçerli miktar girin' }, { status: 400 });
    }

    if (amount > 1000000) {
      return NextResponse.json(
        { error: 'Tek seferde en fazla 1.000.000 TOKEN yüklenebilir' },
        { status: 400 }
      );
    }

    // Deposit tipi
    const type = depositType || 'manual';
    const desc = description
      || `Havuz deposit (${type}) — ${new Date().toLocaleDateString('tr-TR')}`;

    // Pool deposit — DB trigger otomatik running_balance hesaplar
    const poolEntry = await prisma.pool.create({
      data: {
        action: 'deposit',
        amount,
        runningBalance: 0, // Trigger hesaplayacak
        description: desc,
        adminId: payload.userId,
      },
    });

    // Güncel bakiyeyi tekrar al
    const updatedPool = await prisma.pool.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    await createAuditLog({
      userId: payload.userId,
      action: 'pool_deposit',
      details: {
        amount,
        depositType: type,
        newBalance: updatedPool?.runningBalance,
        poolEntryId: poolEntry.id,
      },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      message: `${amount.toLocaleString('tr-TR')} TOKEN havuza eklendi`,
      newBalance: updatedPool?.runningBalance || 0,
      poolEntryId: poolEntry.id,
    });
  });
}
