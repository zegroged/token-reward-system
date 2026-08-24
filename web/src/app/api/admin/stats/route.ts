import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin, type AuthPayload } from '@/lib/auth';

/**
 * GET /api/admin/stats — Admin genel istatistikler
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const [
      activeUsers,
      totalUsers,
      pendingWithdrawals,
      completedWithdrawals,
      lastPool,
      flaggedReels,
      totalReels,
      todayEarnings,
    ] = await Promise.all([
      prisma.user.count({ where: { isActive: true, role: 'employee' } }),
      prisma.user.count(),
      prisma.withdrawal.count({ where: { status: 'pending' } }),
      prisma.withdrawal.count({ where: { status: 'completed' } }),
      prisma.pool.findFirst({ orderBy: { createdAt: 'desc' } }),
      prisma.instagramData.count({
        where: { authenticityScore: { lt: 40 } },
      }),
      prisma.instagramData.count(),
      prisma.transaction.aggregate({
        where: {
          type: 'earning',
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
        _sum: { amount: true },
      }),
    ]);

    // Bekleyen çekim detayları
    const pendingList = await prisma.withdrawal.findMany({
      where: { status: 'pending' },
      take: 10,
      orderBy: { requestedAt: 'desc' },
      include: {
        user: { select: { fullName: true, email: true } },
      },
    });

    // Son aktiviteler
    const recentAudit = await prisma.auditLog.findMany({
      take: 10,
      orderBy: { requestedAt: 'desc' },
      include: {
        user: { select: { fullName: true } },
      },
    });

    return NextResponse.json({
      poolBalance: Number(lastPool?.runningBalance || 0),
      activeUsers,
      totalUsers,
      pendingWithdrawals,
      completedWithdrawals,
      flaggedReels,
      totalReels,
      todayEarnings: Number(todayEarnings._sum?.amount || 0),
      pendingList: pendingList.map(w => ({
        id: w.id,
        userName: w.user?.fullName || 'Bilinmiyor',
        email: w.user?.email || '',
        amountToken: Number(w.amountToken),
        amountUsdt: Number(w.amountUsdt || 0),
        walletAddress: w.walletAddress,
        createdAt: w.createdAt,
      })),
      recentActivity: recentAudit.map(a => ({
        id: a.id,
        user: a.user?.fullName || 'Sistem',
        action: a.action,
        details: a.details,
        createdAt: a.createdAt,
      })),
    });
  });
}
