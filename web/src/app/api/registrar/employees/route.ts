import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withRegistrar, type AuthPayload } from '@/lib/auth';

/**
 * GET /api/registrar/employees — Kayıt merkezi çalışanının oluşturduğu çalışanlar
 * Query: ?page=1&limit=20&search=ali
 */
export async function GET(request: Request) {
  return withRegistrar(request, async (payload: AuthPayload) => {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const search = searchParams.get('search') || '';
    const skip = (page - 1) * limit;

    const where: any = {
      registeredById: payload.userId,
    };

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { instagramHandle: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [employees, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          isActive: true,
          instagramHandle: true,
          instagramConnectedAt: true,
          forcePasswordChange: true,
          createdAt: true,
          balance: {
            select: { available: true, totalEarned: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Bugün ve bu hafta oluşturulan
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [todayCount, weekCount] = await Promise.all([
      prisma.user.count({ where: { registeredById: payload.userId, createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { registeredById: payload.userId, createdAt: { gte: weekStart } } }),
    ]);

    return NextResponse.json({
      employees: employees.map(e => ({
        ...e,
        balance: e.balance ? {
          available: Number(e.balance.available),
          totalEarned: Number(e.balance.totalEarned),
        } : null,
      })),
      stats: { today: todayCount, thisWeek: weekCount, total },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });
}
