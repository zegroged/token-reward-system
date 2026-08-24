import { NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/db';
import { withAuth, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

/**
 * POST — Manuel reel formu (Instagram API fallback)
 * Kullanıcı reel linkini ve metriklerini manuel girer.
 * Admin onayına düşer, sonra token hesaplanır.
 */
export async function POST(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { reelUrl, viewCount, likeCount, commentCount, saveCount, shareCount } = body;

    // Doğrulama
    if (!reelUrl) {
      return NextResponse.json({ error: 'Reel URL zorunlu' }, { status: 400 });
    }

    // Instagram URL format kontrolü
    const igUrlRegex = /^https?:\/\/(www\.)?instagram\.com\/(reel|p)\/[A-Za-z0-9_-]+/;
    if (!igUrlRegex.test(reelUrl)) {
      return NextResponse.json({ error: 'Geçersiz Instagram Reel URL formatı' }, { status: 400 });
    }

    // Sayısal doğrulama
    const views = parseInt(viewCount) || 0;
    const likes = parseInt(likeCount) || 0;
    const comments = parseInt(commentCount) || 0;
    const saves = parseInt(saveCount) || 0;
    const shares = parseInt(shareCount) || 0;

    if (views <= 0) {
      return NextResponse.json({ error: 'View sayısı 0\'dan büyük olmalı' }, { status: 400 });
    }

    // ★ FIX N7: URL normalize — query params, trailing slash, ref param strip
    let normalizedUrl: string;
    try {
      const parsed = new URL(reelUrl);
      normalizedUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
    } catch {
      return NextResponse.json({ error: 'Geçersiz URL formatı' }, { status: 400 });
    }

    // Duplicate kontrolü (normalize edilmiş URL ile)
    const existing = await prisma.instagramData.findFirst({
      where: { userId: payload.userId, reelUrl: normalizedUrl },
    });

    if (existing) {
      return NextResponse.json({ error: 'Bu reel zaten gönderilmiş' }, { status: 409 });
    }

    // Engagement rate hesapla
    const totalEngagement = likes + comments + saves + shares;
    const engagementRate = views > 0 ? (totalEngagement / views) : 0;

    // DB'ye kaydet (source: 'manual', admin onayı bekleyen)
    const reelData = await prisma.instagramData.create({
      data: {
        userId: payload.userId,
        reelId: `manual_${crypto.randomUUID()}`,
        reelUrl: normalizedUrl,
        source: 'manual',
        viewCount: views,
        likeCount: likes,
        commentCount: comments,
        saveCount: saves,
        shareCount: shares,
        engagementRate,
        analysisLevel: 'pending',
        authenticityScore: 0,
        isAuthentic: false,
        flagged: true,
        flagReasons: 'manual_submission_pending_review',
      },
    });

    await createAuditLog({
      userId: payload.userId,
      action: 'manual_reel_submitted',
      details: { reelUrl, viewCount: views, reelDataId: reelData.id },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      message: 'Reel verisi gönderildi. Admin onayından sonra token hesaplanacak.',
      id: reelData.id,
    }, { status: 201 });
  });
}

/**
 * GET — Kullanıcının manuel gönderimlerini listele
 */
export async function GET(request: Request) {
  return withAuth(request, async (payload: AuthPayload) => {
    const submissions = await prisma.instagramData.findMany({
      where: { userId: payload.userId, source: 'manual' },
      orderBy: { collectedAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({ submissions });
  });
}
