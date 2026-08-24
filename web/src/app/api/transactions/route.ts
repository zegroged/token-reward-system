import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';

/**
 * GET /api/transactions — Kullanıcı işlem geçmişi
 * Query: ?page=1&limit=20&type=earning|withdrawal|adjustment
 */
export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const type = searchParams.get('type');
    const skip = (page - 1) * limit;

    const where: any = { userId: payload.userId };
    if (type && ['earning', 'withdrawal', 'adjustment', 'bonus'].includes(type)) {
      where.type = type;
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({ where }),
    ]);

    return NextResponse.json({
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        referenceType: t.referenceType,
        createdAt: t.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });
}
