import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import bcrypt from 'bcryptjs';
import { withAdmin, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

// POST — Toplu kullanıcı ekle VEYA tekil işlemler (activate, deactivate, change_role)
export async function POST(request: Request) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { action, userIds, users: csvUsers, newRole } = body;

    // ── Tekil/çoklu aksiyon: activate, deactivate, change_role ──
    if (action && userIds) {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return NextResponse.json({ error: 'Kullanıcı ID listesi boş' }, { status: 400 });
      }

      if (action === 'activate') {
        await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: true, deactivatedAt: null } });
      } else if (action === 'deactivate') {
        await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false, deactivatedAt: new Date() } });
      } else if (action === 'change_role') {
        if (!newRole || !['employee', 'registrar', 'admin'].includes(newRole)) {
          return NextResponse.json({ error: 'Geçersiz rol' }, { status: 400 });
        }
        await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { role: newRole } });
      } else {
        return NextResponse.json({ error: 'Geçersiz aksiyon' }, { status: 400 });
      }

      await createAuditLog({
        userId: payload.userId,
        action: `user_${action}`,
        details: { userIds, newRole: newRole || undefined },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ message: `${userIds.length} kullanıcı güncellendi` });
    }

    // ── CSV ile toplu ekleme ──
    if (!Array.isArray(csvUsers) || csvUsers.length === 0) {
      return NextResponse.json({ error: 'Kullanıcı listesi boş' }, { status: 400 });
    }

    if (csvUsers.length > 100) {
      return NextResponse.json({ error: 'Tek seferde en fazla 100 kullanıcı' }, { status: 400 });
    }

    const results = { success: 0, failed: 0, errors: [] as string[] };
    const defaultPassword = '[GECICI_PAROLA]'; // İlk giriş sonrası zorunlu değişim
    const passwordHash = await bcrypt.hash(defaultPassword, 12);

    for (const csvUser of csvUsers) {
      try {
        const { fullName, email, instagramHandle, role } = csvUser;

        // Doğrulama
        if (!fullName || !email) {
          results.failed++;
          results.errors.push(`${email || 'boş'}: İsim ve e-posta zorunlu`);
          continue;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          results.failed++;
          results.errors.push(`${email}: Geçersiz e-posta formatı`);
          continue;
        }

        // Duplicate kontrolü
        const existing = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
        });

        if (existing) {
          results.failed++;
          results.errors.push(`${email}: E-posta zaten kayıtlı`);
          continue;
        }

        // Oluştur
        await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              email: email.toLowerCase().trim(),
              passwordHash,
              fullName: fullName.trim(),
              role: role || 'employee',
              instagramHandle: instagramHandle || null,
              forcePasswordChange: true,
              kvkkConsent: false,
            },
          });

          await tx.balance.create({
            data: { userId: newUser.id },
          });
        });

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(`${csvUser.email || 'bilinmeyen'}: Sunucu hatası`);
      }
    }

    await createAuditLog({
      userId: payload.userId,
      action: 'bulk_user_import',
      details: {
        total: csvUsers.length,
        success: results.success,
        failed: results.failed,
      },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      message: `${results.success} kullanıcı eklendi, ${results.failed} başarısız`,
      ...results,
    });
  });
}
