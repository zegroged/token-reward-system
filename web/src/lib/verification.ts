import { Resend } from 'resend';

// ── Resend.com — E-posta servisi ──
// Docker Secret'tan oku, yoksa env fallback
import { readFileSync, existsSync } from 'fs';
function getResendKey(): string {
  try {
    if (existsSync('/run/secrets/resend_api_key')) {
      return readFileSync('/run/secrets/resend_api_key', 'utf-8').trim();
    }
  } catch { /* Docker Secret yoksa env kullan */ }
  return process.env.RESEND_API_KEY || 're_dummy_123456';
}
const resend = new Resend(getResendKey());
const FROM_EMAIL = process.env.FROM_EMAIL || '1923 <onboarding@resend.dev>';

import { randomInt } from 'crypto';

/**
 * 6 haneli doğrulama kodu oluştur (kriptografik)
 */
export function generateVerificationCode(): string {
  return randomInt(100000, 999999).toString();
}

/**
 * E-posta doğrulama kodu gönder (Resend.com)
 */
export async function sendVerificationEmail(to: string, code: string): Promise<boolean> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `Doğrulama Kodunuz: ${code}`,
      html: buildVerificationEmailHtml(code),
    });

    if (error) {
      console.error('[RESEND_ERROR]', error);
      return false;
    }

    console.log('[EMAIL_SENT]', { to, messageId: data?.id });
    return true;
  } catch (error) {
    console.error('[EMAIL_ERROR]', error);
    return false;
  }
}

/**
 * Çekim onay bildirimi gönder
 */
export async function sendWithdrawalNotification(
  to: string, amount: number, txHash: string
): Promise<boolean> {
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `✅ Çekim Onaylandı — ${amount} TOKEN`,
      html: buildWithdrawalEmailHtml(amount, txHash),
    });
    if (error) { console.error('[RESEND_ERROR]', error); return false; }
    return true;
  } catch (error) {
    console.error('[EMAIL_ERROR]', error);
    return false;
  }
}

/**
 * Token süre uyarısı
 */
export async function sendTokenExpiryWarning(
  to: string, daysRemaining: number, igHandle: string
): Promise<boolean> {
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `⚠️ Instagram Token Süresi: ${daysRemaining} gün kaldı`,
      html: `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:480px;margin:0 auto;background:#0F1117;color:#E2E8F0;padding:32px;border-radius:16px;">
          <h1 style="color:#FBBF24;font-size:20px;">⚠️ Instagram Token Uyarısı</h1>
          <div style="background:#1A1D26;border:1px solid #252832;border-radius:12px;padding:20px;margin:16px 0;">
            <p><strong>Hesap:</strong> @${igHandle}</p>
            <p><strong>Kalan süre:</strong> <span style="color:#FBBF24;font-weight:700;">${daysRemaining} gün</span></p>
            <p style="color:#94A3B8;font-size:13px;margin-top:12px;">
              Profil sayfanızdan "Token Yenile" butonuna tıklayarak süreyi uzatabilirsiniz.
            </p>
          </div>
          <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://yourdomain.com'}/dashboard/profile" 
             style="display:block;text-align:center;background:linear-gradient(135deg,#38BDF8,#818CF8);color:#0F1117;padding:12px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:16px;">
            Token'ı Yenile →
          </a>
        </div>
      `,
    });
    if (error) { console.error('[RESEND_ERROR]', error); return false; }
    return true;
  } catch (error) {
    console.error('[EMAIL_ERROR]', error);
    return false;
  }
}

// ── SMS Doğrulama — Netgsm (Türkiye) ──

export async function sendSmsVerification(phone: string, code: string): Promise<boolean> {
  const NETGSM_USER = process.env.NETGSM_USER || '';
  // Docker Secret'tan oku, yoksa env fallback
  let NETGSM_PASS = process.env.NETGSM_PASS || '';
  try {
    const fs = await import('fs');
    if (fs.existsSync('/run/secrets/netgsm_password')) {
      NETGSM_PASS = fs.readFileSync('/run/secrets/netgsm_password', 'utf-8').trim();
    }
  } catch { /* Docker Secret yoksa env kullan */ }
  const NETGSM_HEADER = process.env.NETGSM_HEADER || '1923';

  if (!NETGSM_USER || !NETGSM_PASS) {
    console.error('[SMS] Netgsm credentials eksik. NETGSM_USER ve NETGSM_PASS env gerekli.');
    return false;
  }

  // Telefon temizle: +90, boşluk, tire kaldır
  const cleanPhone = phone.replace(/[\s\-\+]/g, '').replace(/^90/, '').replace(/^0/, '');

  if (cleanPhone.length !== 10) {
    console.error('[SMS] Geçersiz telefon uzunluğu:', cleanPhone);
    return false;
  }

  const message = `Token Odul Sistemi dogrulama kodunuz: ${code} (10 dk gecerli)`;

  try {
    // Netgsm REST API v2
    const response = await fetch('https://api.netgsm.com.tr/sms/send/otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${NETGSM_USER}:${NETGSM_PASS}`).toString('base64')}`,
      },
      body: JSON.stringify({
        msgheader: NETGSM_HEADER,
        message,
        no: cleanPhone,
      }),
    });

    const result = await response.json();

    // Netgsm başarı kodu: "00", "01", "02"
    if (result.code === '00' || result.code === '01' || result.code === '02') {
      console.log('[SMS_SENT]', { phone: cleanPhone.substring(0, 4) + '******', jobId: result.jobid });
      return true;
    }

    console.error('[SMS_NETGSM_ERROR]', result);
    return false;
  } catch (error) {
    console.error('[SMS_ERROR]', error);

    // Fallback: Netgsm GET API (eski versiyon)
    try {
      const fallbackUrl = `https://api.netgsm.com.tr/sms/send/get?` +
        `usercode=${encodeURIComponent(NETGSM_USER)}&password=${encodeURIComponent(NETGSM_PASS)}&` +
        `gsmno=${cleanPhone}&msgheader=${encodeURIComponent(NETGSM_HEADER)}&` +
        `message=${encodeURIComponent(message)}&dil=TR`;

      const fallbackRes = await fetch(fallbackUrl);
      const text = await fallbackRes.text();
      const isSuccess = text.startsWith('00') || text.startsWith('01') || text.startsWith('02');
      if (isSuccess) console.log('[SMS_SENT_FALLBACK]', { phone: cleanPhone.substring(0, 4) + '****' });
      return isSuccess;
    } catch {
      return false;
    }
  }
}

// ── HTML Templates ──

function buildVerificationEmailHtml(code: string): string {
  return `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:480px;margin:0 auto;background:#0F1117;color:#E2E8F0;padding:32px;border-radius:16px;border:1px solid #252832;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#38BDF8,#818CF8);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:24px;">💎</span>
        </div>
        <h1 style="font-size:20px;font-weight:700;margin:0;">
          <span style="background:linear-gradient(135deg,#38BDF8,#818CF8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">1923</span>
        </h1>
      </div>
      
      <div style="background:#1A1D26;border:1px solid #252832;border-radius:12px;padding:24px;text-align:center;">
        <p style="color:#94A3B8;margin:0 0 16px;">Doğrulama kodunuz:</p>
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#38BDF8;margin:16px 0;font-family:monospace;">
          ${code}
        </div>
        <div style="width:100%;height:4px;background:#252832;border-radius:2px;margin-top:16px;overflow:hidden;">
          <div style="width:100%;height:100%;background:linear-gradient(90deg,#38BDF8,#818CF8);border-radius:2px;"></div>
        </div>
        <p style="color:#64748B;font-size:12px;margin-top:12px;">Bu kod 10 dakika geçerlidir.</p>
      </div>
      
      <p style="color:#64748B;font-size:11px;text-align:center;margin-top:16px;">
        Bu e-postayı siz talep etmediyseniz, lütfen görmezden gelin.
      </p>
    </div>
  `;
}

function buildWithdrawalEmailHtml(amount: number, txHash: string): string {
  return `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:480px;margin:0 auto;background:#0F1117;color:#E2E8F0;padding:32px;border-radius:16px;border:1px solid #252832;">
      <div style="text-align:center;margin-bottom:20px;">
        <h1 style="color:#22C55E;font-size:20px;">✅ Çekim Onaylandı</h1>
      </div>
      <div style="background:#1A1D26;border:1px solid #252832;border-radius:12px;padding:20px;margin:16px 0;">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
          <span style="color:#94A3B8;">Miktar</span>
          <span style="font-weight:700;color:#38BDF8;">${amount} TOKEN</span>
        </div>
        <div style="height:1px;background:#252832;margin:10px 0;"></div>
        <div>
          <span style="color:#94A3B8;font-size:12px;">TX Hash:</span>
          <code style="display:block;color:#38BDF8;font-size:12px;word-break:break-all;margin-top:4px;">
            ${txHash}
          </code>
        </div>
        <a href="https://tronscan.org/#/transaction/${txHash}" 
           style="display:block;text-align:center;color:#38BDF8;font-size:13px;margin-top:12px;text-decoration:none;">
          TronScan'da Görüntüle →
        </a>
      </div>
      <p style="color:#64748B;font-size:12px;text-align:center;">
        USDT cüzdanınıza transfer edilmiştir.
      </p>
    </div>
  `;
}
