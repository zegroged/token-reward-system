import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin } from '@/lib/auth';

/**
 * GET /api/admin/withdrawals — Çekim listesi
 * Query: ?status=pending&page=1&limit=20
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const status = searchParams.get('status');
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && ['pending', 'approved', 'processing', 'unconfirmed', 'completed', 'rejected', 'failed'].includes(status)) {
      where.status = status;
    }

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { requestedAt: 'desc' },
        include: {
          user: { select: { fullName: true, email: true } },
        },
      }),
      prisma.withdrawal.count({ where }),
    ]);

    // Toplam istatistikler
    const stats = await prisma.withdrawal.groupBy({
      by: ['status'],
      _count: true,
      _sum: { amountToken: true },
    });

    return NextResponse.json({
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        userName: w.user?.fullName || 'Bilinmiyor',
        email: w.user?.email || '',
        amountToken: Number(w.amountToken),
        amountUsdt: Number(w.amountUsdt || 0),
        walletAddress: w.walletAddress,
        status: w.status,
        txHash: w.txHash,
        adminNotes: w.adminNotes,
        createdAt: w.requestedAt,
        approvedAt: w.approvedAt,
      })),
      stats: {
        pending: stats.find(s => s.status === 'pending')?._count || 0,
        pendingAmount: Number(stats.find(s => s.status === 'pending')?._sum?.amountToken || 0),
        approved: stats.find(s => s.status === 'approved')?._count || 0,
        processing: stats.find(s => s.status === 'processing')?._count || 0,
        unconfirmed: stats.find(s => s.status === 'unconfirmed')?._count || 0,
        completed: stats.find(s => s.status === 'completed')?._count || 0,
        rejected: stats.find(s => s.status === 'rejected')?._count || 0,
        failed: stats.find(s => s.status === 'failed')?._count || 0,
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });
}
