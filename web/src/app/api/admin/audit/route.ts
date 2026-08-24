import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin } from '@/lib/auth';

/**
 * GET /api/admin/audit — Denetim kaydı listesi
 * Query: ?page=1&limit=30&action=login_success&userId=xxx
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);
    const action = searchParams.get('action');
    const userId = searchParams.get('userId');
    const skip = (page - 1) * limit;

    const where: any = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { fullName: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Benzersiz action tipleri (filtre için)
    const actionTypes = await prisma.auditLog.groupBy({
      by: ['action'],
      _count: true,
      orderBy: { _count: { action: 'desc' } },
      take: 20,
    });

    return NextResponse.json({
      logs: logs.map(l => ({
        id: l.id,
        user: l.user?.fullName || 'Sistem',
        email: l.user?.email || '',
        action: l.action,
        details: l.details,
        ipAddress: l.ipAddress,
        userAgent: l.userAgent?.substring(0, 80),
        createdAt: l.createdAt,
      })),
      actionTypes: actionTypes.map(a => ({ action: a.action, count: a._count })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });
}
