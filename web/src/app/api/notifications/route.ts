import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';

/**
 * GET /api/notifications — Kullanıcının bildirimlerini çek
 * Query: ?unread_only=true&limit=20
 */
export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unread_only') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

    const where: any = { userId: payload.userId };
    if (unreadOnly) {
      where.isRead = false;
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({
        where: { userId: payload.userId, isRead: false },
      }),
    ]);

    return NextResponse.json({
      notifications: notifications.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        isRead: n.isRead,
        link: n.link,
        createdAt: n.createdAt,
      })),
      unreadCount,
    });
  });
}

/**
 * PATCH /api/notifications — Bildirimleri okundu olarak işaretle
 * Body: { ids: ["uuid1", "uuid2"] } veya { markAllRead: true }
 */
export async function PATCH(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const body = await request.json();

    if (body.markAllRead) {
      await prisma.notification.updateMany({
        where: { userId: payload.userId, isRead: false },
        data: { isRead: true },
      });
      return NextResponse.json({ message: 'Tüm bildirimler okundu olarak işaretlendi' });
    }

    if (body.ids && Array.isArray(body.ids)) {
      await prisma.notification.updateMany({
        where: {
          id: { in: body.ids },
          userId: payload.userId,
        },
        data: { isRead: true },
      });
      return NextResponse.json({ message: `${body.ids.length} bildirim okundu` });
    }

    return NextResponse.json({ error: 'ids veya markAllRead gerekli' }, { status: 400 });
  });
}
