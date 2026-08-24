import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin } from '@/lib/auth';

/**
 * GET /api/admin/users — Kullanıcı listesi
 * Query: ?page=1&limit=20&search=ali&role=employee
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const search = searchParams.get('search') || '';
    const role = searchParams.get('role');
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { instagramHandle: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          instagramHandle: true,
          instagramConnectedAt: true,
          emailVerified: true,
          phoneVerified: true,
          createdAt: true,
          lastLoginIp: true,
          balance: {
            select: {
              available: true,
              totalEarned: true,
              totalWithdrawn: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({
      users: users.map(u => ({
        ...u,
        phone: u.phone ? u.phone.substring(0, 4) + '****' : null,
        balance: u.balance ? {
          available: Number(u.balance.available),
          totalEarned: Number(u.balance.totalEarned),
          totalWithdrawn: Number(u.balance.totalWithdrawn),
        } : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });
}
