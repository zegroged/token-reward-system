import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';
import crypto from 'crypto';

/**
 * GET — Tüm kampanyaları listele (istatistiklerle)
 */
export async function GET(request: Request) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const campaigns = await prisma.$queryRaw`
      SELECT 
        c.*,
        COUNT(DISTINCT cp.user_id) as total_payments,
        COALESCE(SUM(cp.tokens_paid), 0) as total_tokens_paid,
        COUNT(DISTINCT id2.user_id) as total_videos
      FROM campaigns c
      LEFT JOIN campaign_payments cp ON cp.campaign_id = c.id
      LEFT JOIN instagram_data id2 ON id2.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `;

    return NextResponse.json({ campaigns });
  });
}

/**
 * POST — Yeni kampanya oluştur
 */
export async function POST(request: Request) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const body = await request.json();

    const {
      title,
      brandName,
      brandAccount,
      platform = 'both',
      description,
      keywords = [],
      referenceUrl,
      referenceThumbnail,
      referenceDurationSec,
      startDate,
      endDate,
    } = body;

    // Validasyon
    if (!title || !brandAccount) {
      return NextResponse.json(
        { error: 'Kampanya adı ve etiketlenecek hesap zorunludur' },
        { status: 400 }
      );
    }

    // Brand account @ ile başlamalı
    const cleanAccount = brandAccount.startsWith('@') 
      ? brandAccount 
      : `@${brandAccount}`;

    try {
      const campaign = await prisma.$executeRaw`
        INSERT INTO campaigns 
          (title, brand_name, brand_account, platform, description, 
           keywords, reference_url, reference_thumbnail, reference_duration_sec,
           start_date, end_date, created_by, status)
        VALUES 
          (${title}, ${brandName || null}, ${cleanAccount}, ${platform}, 
           ${description || null}, ${keywords}::text[], ${referenceUrl || null}, 
           ${referenceThumbnail || null}, ${referenceDurationSec || null},
           ${startDate ? new Date(startDate) : new Date()}, 
           ${endDate ? new Date(endDate) : null},
           ${payload.userId}::uuid, 'active')
      `;

      await createAuditLog({
        userId: payload.userId,
        action: 'campaign_created',
        details: { title, brandAccount: cleanAccount, platform },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ 
        message: 'Kampanya oluşturuldu',
        brandAccount: cleanAccount,
      }, { status: 201 });

    } catch (err: any) {
      console.error('[CAMPAIGN_CREATE]', err);
      return NextResponse.json(
        { error: 'Kampanya oluşturulamadı: ' + err.message },
        { status: 500 }
      );
    }
  });
}
