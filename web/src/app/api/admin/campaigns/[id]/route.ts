import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

/**
 * GET — Kampanya detayı + istatistikler
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const campaignId = params.id;

    const campaign = await prisma.$queryRaw`
      SELECT 
        c.*,
        COUNT(DISTINCT cp.user_id) as paid_users,
        COALESCE(SUM(cp.tokens_paid), 0) as total_tokens,
        COUNT(DISTINCT id2.id) as total_videos,
        COALESCE(SUM(id2.view_count), 0) as total_views
      FROM campaigns c
      LEFT JOIN campaign_payments cp ON cp.campaign_id = c.id
      LEFT JOIN instagram_data id2 ON id2.campaign_id = c.id AND id2.campaign_verified = true
      WHERE c.id = ${campaignId}::uuid
      GROUP BY c.id
    `;

    if (!campaign || (campaign as any[]).length === 0) {
      return NextResponse.json({ error: 'Kampanya bulunamadı' }, { status: 404 });
    }

    // Bu kampanya için yapılan ödemeleri listele
    const payments = await prisma.$queryRaw`
      SELECT cp.*, u.full_name, u.email
      FROM campaign_payments cp
      JOIN users u ON u.id = cp.user_id
      WHERE cp.campaign_id = ${campaignId}::uuid
      ORDER BY cp.paid_at DESC
    `;

    return NextResponse.json({
      campaign: (campaign as any[])[0],
      payments,
    });
  });
}

/**
 * PATCH — Kampanya güncelle (status, süre vb.)
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const campaignId = params.id;

    const { status, title, endDate, keywords, description } = body;

    // Status güncelleme
    if (status) {
      const validStatuses = ['draft', 'active', 'paused', 'completed'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Geçersiz durum' }, { status: 400 });
      }

      await prisma.$executeRaw`
        UPDATE campaigns 
        SET status = ${status},
            end_date = CASE WHEN ${status} = 'completed' THEN NOW() ELSE end_date END
        WHERE id = ${campaignId}::uuid
      `;
    }

    if (title) {
      await prisma.$executeRaw`UPDATE campaigns SET title = ${title} WHERE id = ${campaignId}::uuid`;
    }
    if (endDate) {
      await prisma.$executeRaw`UPDATE campaigns SET end_date = ${new Date(endDate)} WHERE id = ${campaignId}::uuid`;
    }
    if (description) {
      await prisma.$executeRaw`UPDATE campaigns SET description = ${description} WHERE id = ${campaignId}::uuid`;
    }
    if (keywords) {
      await prisma.$executeRaw`UPDATE campaigns SET keywords = ${keywords}::text[] WHERE id = ${campaignId}::uuid`;
    }

    await createAuditLog({
      userId: payload.userId,
      action: 'campaign_updated',
      details: { campaignId, changes: body },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ message: 'Kampanya güncellendi' });
  });
}
