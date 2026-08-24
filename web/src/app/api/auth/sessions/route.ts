import { NextResponse } from 'next/server';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { getActiveSessions, deleteSession, logoutAllDevices } from '@/lib/redis';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

// GET — Aktif oturumları listele
export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const sessions = await getActiveSessions(payload.userId);
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        ...s,
        isCurrent: s.id === payload.sessionId,
      })),
    });
  });
}

// DELETE — Tek oturum veya tümünü kapat
export async function DELETE(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const all = searchParams.get('all');

    if (all === 'true') {
      // Tüm cihazlardan çıkış
      await logoutAllDevices(payload.userId);
      await createAuditLog({
        userId: payload.userId,
        action: 'logout_all_devices',
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });
      return NextResponse.json({ message: 'Tüm oturumlar kapatıldı' });
    }

    if (sessionId) {
      // Tek oturum kapat
      await deleteSession(payload.userId, sessionId);
      await createAuditLog({
        userId: payload.userId,
        action: 'logout_device',
        details: { sessionId },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });
      return NextResponse.json({ message: 'Oturum kapatıldı' });
    }

    return NextResponse.json({ error: 'sessionId veya all parametresi gerekli' }, { status: 400 });
  });
}
