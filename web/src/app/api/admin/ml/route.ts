import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

/**
 * GET /api/admin/ml — ML etiketleme için flagged reeller
 * Query: ?view=unlabeled|all&page=1&limit=20
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'unlabeled';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const skip = (page - 1) * limit;

    const where: any = { flagged: true };
    if (view === 'unlabeled') {
      where.adminReviewed = false;
    }

    const [reels, total] = await Promise.all([
      prisma.instagramData.findMany({
        where,
        skip,
        take: limit,
        orderBy: { collectedAt: 'desc' },
        include: {
          user: { select: { fullName: true, instagramHandle: true } },
        },
      }),
      prisma.instagramData.count({ where }),
    ]);

    // İstatistikler
    const [totalAll, labeled, authentic, fake] = await Promise.all([
      prisma.instagramData.count({ where: { flagged: true } }),
      prisma.instagramData.count({ where: { flagged: true, adminReviewed: true } }),
      prisma.instagramData.count({ where: { flagged: true, adminReviewed: true, adminOverride: true } }),
      prisma.instagramData.count({ where: { flagged: true, adminReviewed: true, adminOverride: false } }),
    ]);

    return NextResponse.json({
      reels: reels.map(r => ({
        id: r.id,
        userName: r.user?.fullName || 'Bilinmeyen',
        instagramHandle: r.user?.instagramHandle || null,
        reelUrl: r.reelUrl,
        viewCount: r.viewCount,
        likeCount: r.likeCount,
        commentCount: r.commentCount,
        saveCount: r.saveCount,
        engagementRate: r.engagementRate ? Number(r.engagementRate) : 0,
        authenticityScore: r.authenticityScore ? Number(r.authenticityScore) : 0,
        flagReasons: r.flagReasons || [],
        isLabeled: r.adminReviewed,
        labeledAuthentic: r.adminOverride,
        adminNotes: r.adminNotes,
      })),
      stats: { total: totalAll, labeled, authentic, fake },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });
}

/**
 * PATCH /api/admin/ml — Reel etiketle (gerçek/sahte)
 */
export async function PATCH(request: Request) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { reelId, isAuthentic, notes } = body;

    if (!reelId || typeof isAuthentic !== 'boolean') {
      return NextResponse.json({ error: 'reelId ve isAuthentic zorunlu' }, { status: 400 });
    }

    await prisma.instagramData.update({
      where: { id: reelId },
      data: {
        adminReviewed: true,
        adminOverride: isAuthentic,
        adminId: payload.userId,
        adminNotes: notes || null,
        reviewedAt: new Date(),
      },
    });

    // ML eğitim verisi oluştur
    const reel = await prisma.instagramData.findUnique({
      where: { id: reelId },
      select: { viewCount: true, likeCount: true, commentCount: true, saveCount: true, engagementRate: true },
    });

    if (reel) {
      await prisma.mlTrainingData.create({
        data: {
          instagramDataId: reelId,
          label: isAuthentic ? 'authentic' : 'fake',
          labelSource: 'admin_review',
          labeledBy: payload.userId,
          features: {
            viewCount: reel.viewCount,
            likeCount: reel.likeCount,
            commentCount: reel.commentCount,
            saveCount: reel.saveCount,
            engagementRate: reel.engagementRate ? Number(reel.engagementRate) : 0,
          },
        },
      });
    }

    await createAuditLog({
      userId: payload.userId,
      action: 'ml_label_created',
      details: { reelId, isAuthentic, notes },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ message: 'Etiket kaydedildi' });
  });
}
