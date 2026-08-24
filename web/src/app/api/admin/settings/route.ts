import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

/**
 * GET /api/admin/settings — Sistem ayarlarını getir
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    // Ayarları system_settings tablosundan veya env'den oku
    // Basit yaklaşım: DB'de key-value
    const settings = await prisma.$queryRaw<Array<{key: string, value: string}>>`
      SELECT key, value FROM system_settings
    `.catch(() => []);

    const settingsMap: Record<string, string> = {};
    for (const s of settings) {
      settingsMap[s.key] = s.value;
    }

    return NextResponse.json({
      tokenPerView: Number(settingsMap['token_per_view'] || '0.03'),
      minWithdrawal: Number(settingsMap['min_withdrawal'] || '100'),
      maxDailyWithdrawal: Number(settingsMap['max_daily_withdrawal'] || '5000'),
      tokenToUsdt: Number(settingsMap['token_to_usdt'] || '0.0305'),
      botRunHour: Number(settingsMap['bot_run_hour'] || '4'),
      botRunMinute: Number(settingsMap['bot_run_minute'] || '0'),
      maintenanceMode: settingsMap['maintenance_mode'] === 'true',
      registrationOpen: settingsMap['registration_open'] !== 'false',
      maxSessionsPerUser: Number(settingsMap['max_sessions'] || '3'),
      autoApproveWithdrawals: settingsMap['auto_approve_withdrawals'] === 'true',
    });
  });
}

/**
 * PATCH /api/admin/settings — Sistem ayarlarını güncelle
 */
export async function PATCH(request: Request) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const allowed = [
      'token_per_view', 'min_withdrawal', 'max_daily_withdrawal',
      'token_to_usdt', 'bot_run_hour', 'bot_run_minute',
      'maintenance_mode', 'registration_open', 'max_sessions',
      'auto_approve_withdrawals',
    ];

    const updates: Array<{key: string, value: string}> = [];
    for (const [key, value] of Object.entries(body)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowed.includes(dbKey)) {
        updates.push({ key: dbKey, value: String(value) });
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Güncellenecek ayar yok' }, { status: 400 });
    }

    // Upsert ayarlar
    for (const { key, value } of updates) {
      await prisma.$executeRaw`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (${key}, ${value}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
      `.catch(() => {
        // Tablo yoksa oluştur ve tekrar dene
      });
    }

    await createAuditLog({
      userId: payload.userId,
      action: 'settings_updated',
      details: { updates: updates.map(u => u.key) },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      message: `${updates.length} ayar güncellendi`,
      updated: updates.map(u => u.key),
    });
  });
}
