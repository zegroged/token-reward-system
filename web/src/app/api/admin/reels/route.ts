import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin, type AuthPayload } from '@/lib/auth';

/**
 * GET /api/admin/reels — Instagram verileri listesi
 * Query: ?page=1&limit=20&filter=all|flagged|authentic
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const filter = searchParams.get('filter') || 'all';
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter === 'flagged') where.flagged = true;
    if (filter === 'authentic') where.flagged = false;

    const [reels, total, totalFlagged, totalAuthentic] = await Promise.all([
      prisma.instagramData.findMany({
        where,
        skip,
        take: limit,
        orderBy: { collectedAt: 'desc' },
        include: {
          user: { select: { fullName: true, email: true, instagramHandle: true } },
        },
      }),
      prisma.instagramData.count({ where }),
      prisma.instagramData.count({ where: { flagged: true } }),
      prisma.instagramData.count({ where: { flagged: false } }),
    ]);

    // Ortalama skor
    const avgScore = await prisma.instagramData.aggregate({
      _avg: { authenticityScore: true },
    });

    return NextResponse.json({
      reels: reels.map(r => ({
        id: r.id,
        userName: r.user?.fullName || 'Bilinmeyen',
        instagramHandle: r.user?.instagramHandle || null,
        reelId: r.reelId,
        reelUrl: r.reelUrl,
        viewCount: r.viewCount,
        likeCount: r.likeCount,
        commentCount: r.commentCount,
        saveCount: r.saveCount,
        shareCount: r.shareCount,
        engagementRate: r.engagementRate ? Number(r.engagementRate) : 0,
        authenticityScore: r.authenticityScore ? Number(r.authenticityScore) : 0,
        analysisLevel: r.analysisLevel || 'rule',
        flagged: r.flagged,
        flagReasons: r.flagReasons || [],
        adminReviewed: r.adminReviewed,
        collectedAt: r.collectedAt,
      })),
      stats: {
        total,
        flagged: totalFlagged,
        authentic: totalAuthentic,
        avgScore: avgScore._avg.authenticityScore ? Math.round(Number(avgScore._avg.authenticityScore)) : 0,
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });
}
