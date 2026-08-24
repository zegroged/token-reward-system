import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdmin, type AuthPayload } from '@/lib/auth';
import { createAuditLog, getClientIp, getUserAgent } from '@/lib/audit';

// PATCH — Çekim onayla veya reddet
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withAdmin(request, async (payload: AuthPayload) => {
    const body = await request.json();
    const { action, txHash, adminNotes } = body;

    if (!['approve', 'reject', 'confirm_tx'].includes(action)) {
      return NextResponse.json({ error: 'Geçersiz action: approve, reject veya confirm_tx' }, { status: 400 });
    }

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: params.id },
    });

    if (!withdrawal) {
      return NextResponse.json({ error: 'Çekim talebi bulunamadı' }, { status: 404 });
    }

    // ★ confirm_tx: unconfirmed durumundaki TX'i manüel onaylama
    if (action === 'confirm_tx') {
      if (withdrawal.status !== 'unconfirmed') {
        return NextResponse.json({ error: 'Sadece "onay bekleyen" çekimler doğrulanabilir' }, { status: 409 });
      }

      if (!withdrawal.txHash) {
        return NextResponse.json({ error: 'TX hash bulunamadı' }, { status: 400 });
      }

      // Bakiye güncelle: pending → totalWithdrawn
      await prisma.$transaction(async (tx) => {
        await tx.withdrawal.update({
          where: { id: params.id },
          data: {
            status: 'completed',
            txConfirmed: true,
            completedAt: new Date(),
            adminId: payload.userId,
            adminNotes: adminNotes || 'Manüel blockchain doğrulaması — admin onayı',
          },
        });

        await tx.balance.update({
          where: { userId: withdrawal.userId! },
          data: {
            pending: { decrement: withdrawal.amountToken },
            totalWithdrawn: { increment: withdrawal.amountToken },
          },
        });
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'withdrawal_tx_confirmed',
        details: { withdrawalId: params.id, txHash: withdrawal.txHash },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ message: 'TX doğrulandı — çekim tamamlandı' });
    }

    if (withdrawal.status !== 'pending') {
      return NextResponse.json({ error: 'Bu talep zaten işlenmiş' }, { status: 409 });
    }

    if (action === 'approve') {
      // Onayla — status 'approved' → bot otomatik USDT transferi yapacak
      // ★ Serializable + koşullu UPDATE ile yarışı engelle:
      //   - İki admin aynı anda onaylasa bile sadece biri başarılı olur.
      //   - Pool trigger'ı advisory lock ile tutarlı running_balance üretir.
      await prisma.$transaction(
        async (tx) => {
          // Koşullu UPDATE: yalnızca hâlâ 'pending' olan kaydı onayla
          const updated = await tx.withdrawal.updateMany({
            where: { id: params.id, status: 'pending' },
            data: {
              status: 'approved',
              adminId: payload.userId,
              adminNotes,
              approvedAt: new Date(),
            },
          });

          if (updated.count === 0) {
            // Başka bir admin bizden önce işledi
            throw new Error('ALREADY_PROCESSED');
          }

          // Pool'dan çıkış (trigger running_balance'ı advisory lock ile hesaplar)
          await tx.pool.create({
            data: {
              action: 'withdrawal_out',
              amount: withdrawal.amountToken,
              runningBalance: 0, // Trigger override eder
              description: `Çekim onay — ${withdrawal.userId}`,
              adminId: payload.userId,
            },
          });

          // ★ FIX L6: Onay anında sadece pending tut — totalWithdrawn bot transfer
          // başarılı olduğunda artırılacak (_finalize_success'ta)
          // pending: zaten withdrawals/route.ts'te available→pending yapıldı, değişiklik yok

          // Kullanıcıya site bildirimi
          if (withdrawal.userId) {
            await tx.notification.create({
              data: {
                userId: withdrawal.userId,
                type: 'info',
                title: '✅ Çekim Onaylandı',
                message: `${Number(withdrawal.amountToken)} TOKEN çekim talebiniz onaylandı. USDT transferi kısa süre içinde yapılacak.`,
                link: '/dashboard/transactions',
              },
            });
          }
        },
        { isolationLevel: 'Serializable', timeout: 10000 }
      ).catch((e) => {
        if (e instanceof Error && e.message === 'ALREADY_PROCESSED') {
          return { alreadyProcessed: true };
        }
        throw e;
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'withdrawal_approved',
        details: { withdrawalId: params.id, amount: withdrawal.amountToken },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ message: 'Çekim onaylandı — USDT transferi kuyrukta' });
    }

    if (action === 'reject') {
      // Reddet — bakiyeyi geri yükle
      await prisma.$transaction(async (tx) => {
        // Bakiyeyi geri yükle
        await tx.balance.update({
          where: { userId: withdrawal.userId! },
          data: {
            available: { increment: withdrawal.amountToken },
            pending: { decrement: withdrawal.amountToken },
          },
        });

        // Withdrawal güncelle
        await tx.withdrawal.update({
          where: { id: params.id },
          data: {
            status: 'rejected',
            adminId: payload.userId,
            adminNotes: adminNotes || 'Admin tarafından reddedildi',
          },
        });

        // Geri iade transaction kaydı
        await tx.transaction.create({
          data: {
            userId: withdrawal.userId,
            type: 'adjustment',
            amount: withdrawal.amountToken,
            description: `Çekim iadesi — talep reddedildi`,
            referenceType: 'withdrawal',
            referenceId: params.id,
          },
        });
      });

      await createAuditLog({
        userId: payload.userId,
        action: 'withdrawal_rejected',
        details: { withdrawalId: params.id, amount: withdrawal.amountToken, reason: adminNotes },
        ipAddress: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ message: 'Çekim reddedildi, bakiye iade edildi' });
    }

    return NextResponse.json({ error: 'Bilinmeyen hata' }, { status: 500 });
  });
}
