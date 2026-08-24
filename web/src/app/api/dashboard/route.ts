import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';

/**
 * GET /api/dashboard — Kullanıcı dashboard verileri
 */
export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    try {
      const userId = payload.userId;

      const balance = await prisma.balance.findUnique({ where: { userId } });
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weeklyEarnings = await prisma.transaction.aggregate({
        where: { userId, type: 'earning', createdAt: { gte: weekAgo } },
        _sum: { amount: true },
      });
      const totalViews = await prisma.instagramData.aggregate({
        where: { userId }, _sum: { viewCount: true },
      });
      const engagementAvg = await prisma.instagramData.aggregate({
        where: { userId }, _avg: { engagementRate: true },
      });
      const recentTransactions = await prisma.transaction.findMany({
        where: { userId }, take: 10, orderBy: { createdAt: 'desc' },
      });
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { instagramHandle: true, instagramConnectedAt: true, instagramTokenExpires: true },
      });
      const analyizedReels = await prisma.instagramData.count({ where: { userId } });

      return NextResponse.json({
        balance: {
          available: Number(balance?.available || 0),
          pending: Number(balance?.pending || 0),
          totalEarned: Number(balance?.totalEarned || 0),
          totalWithdrawn: Number(balance?.totalWithdrawn || 0),
        },
        weeklyEarnings: Number(weeklyEarnings._sum?.amount || 0),
        totalViews: Number(totalViews._sum?.viewCount || 0),
        engagementRate: Number(engagementAvg._avg?.engagementRate || 0).toFixed(1),
        recentTransactions: recentTransactions.map(t => ({
          id: t.id, type: t.type, amount: Number(t.amount),
          description: t.description, createdAt: t.createdAt,
        })),
        instagram: {
          handle: user?.instagramHandle || null,
          connected: !!user?.instagramConnectedAt,
          tokenExpires: user?.instagramTokenExpires,
          analyzedReels: analyizedReels,
        },
      });
    } catch {
      // Dev mode mock data
      if (process.env.NODE_ENV !== 'production') {
        return NextResponse.json({
          balance: { available: 2450, pending: 180, totalEarned: 8920, totalWithdrawn: 6470 },
          weeklyEarnings: 340,
          totalViews: 142800,
          engagementRate: '4.7',
          recentTransactions: [
            { id: '1', type: 'earning', amount: 85, description: 'Günlük Reel ödülü', createdAt: new Date(Date.now() - 3600000) },
            { id: '2', type: 'earning', amount: 120, description: 'Günlük Reel ödülü', createdAt: new Date(Date.now() - 86400000) },
            { id: '3', type: 'withdrawal', amount: -500, description: 'USDT çekim', createdAt: new Date(Date.now() - 172800000) },
            { id: '4', type: 'earning', amount: 95, description: 'Günlük Reel ödülü', createdAt: new Date(Date.now() - 259200000) },
            { id: '5', type: 'earning', amount: 110, description: 'Günlük Reel ödülü', createdAt: new Date(Date.now() - 345600000) },
          ],
          instagram: { handle: 'test_kullanici', connected: true, tokenExpires: new Date(Date.now() + 30 * 86400000), analyzedReels: 24 },
        });
      }
      return NextResponse.json({ error: 'DB hatası' }, { status: 500 });
    }
  });
}
