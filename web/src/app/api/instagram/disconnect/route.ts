import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

export async function POST(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    try {
      // Mevcut bağlantı bilgisini audit için al
      const existing = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { instagramHandle: true, instagramUserId: true },
      });

      await prisma.user.update({
        where: { id: payload.userId },
        data: {
          instagramHandle: null,
          instagramUserId: null,
          instagramTokenEnc: null,
          instagramTokenIv: null,
          instagramTokenExpires: null,
          instagramConnectedAt: null,
        },
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'instagram_disconnected',
        details: {
          old_handle: existing?.instagramHandle,
          old_user_id: existing?.instagramUserId,
        },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ 
        success: true,
        warning: 'Instagram bağlantısı kesildi. TOKEN kazanmak için her iki platform da bağlı olmalıdır.',
      });
    } catch (error) {
      console.error('[IG_DISCONNECT]', error);
      return NextResponse.json({ error: 'Failed to disconnect Instagram' }, { status: 500 });
    }
  });
}
