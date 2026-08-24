import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

export async function POST(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    try {
      const existing = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { tiktokHandle: true, tiktokUserId: true },
      });

      await prisma.user.update({
        where: { id: payload.userId },
        data: {
          tiktokHandle: null,
          tiktokUserId: null,
          tiktokTokenEnc: null,
          tiktokTokenIv: null,
          tiktokTokenExpires: null,
          tiktokRefreshTokenEnc: null,
          tiktokRefreshIv: null,
          tiktokConnectedAt: null,
        },
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'tiktok_disconnected',
        details: {
          old_handle: existing?.tiktokHandle,
          old_user_id: existing?.tiktokUserId,
        },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ 
        success: true,
        warning: 'TikTok bağlantısı kesildi. TOKEN kazanmak için her iki platform da bağlı olmalıdır.',
      });
    } catch (error) {
      console.error('[TT_DISCONNECT]', error);
      return NextResponse.json({ error: 'Failed to disconnect TikTok' }, { status: 500 });
    }
  });
}
