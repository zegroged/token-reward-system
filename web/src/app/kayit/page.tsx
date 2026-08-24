'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    passwordConfirm: '',
    kvkkConsent: false,
    kvkkDataProcessing: false,
    kvkkRetentionAccepted: false,
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'verify_email' | 'verify_phone'>('form');

  // E-posta doğrulama
  const [emailCode, setEmailCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  // Telefon doğrulama
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);

  function update(field: string, value: any) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  // Adım 1: Form doğrulama
  function validateForm(): boolean {
    if (!form.fullName.trim()) { setError('İsim zorunludur'); return false; }
    if (!form.email.trim()) { setError('E-posta zorunludur'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setError('Geçersiz e-posta'); return false; }
    if (!form.phone.trim()) { setError('Telefon zorunludur'); return false; }
    if (form.password.length < 8) { setError('Şifre en az 8 karakter olmalı'); return false; }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password)) {
      setError('Şifre en az 1 büyük harf, 1 küçük harf ve 1 rakam içermelidir');
      return false;
    }
    if (form.password !== form.passwordConfirm) { setError('Şifreler eşleşmiyor'); return false; }
    if (!form.kvkkConsent || !form.kvkkDataProcessing || !form.kvkkRetentionAccepted) {
      setError('Tüm KVKK onayları zorunludur');
      return false;
    }
    return true;
  }

  // Adım 2: E-posta doğrulama kodu gönder
  async function sendEmailCode() {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email', target: form.email }),
      });
      if (res.ok) {
        setEmailSent(true);
        setError('');
      } else {
        const data = await res.json();
        setError(data.error || 'E-posta gönderilemedi');
      }
    } catch { setError('Bağlantı hatası'); }
  }

  async function verifyEmailCode() {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email', target: form.email, code: emailCode }),
      });
      if (res.ok) {
        setStep('verify_phone');
        setError('');
      } else {
        const data = await res.json();
        setError(data.error || 'Kod hatalı');
      }
    } catch { setError('Doğrulama hatası'); }
  }

  // Adım 3: Telefon doğrulama kodu gönder
  async function sendPhoneCode() {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'phone', target: form.phone }),
      });
      if (res.ok) {
        setPhoneSent(true);
        setError('');
      } else {
        const data = await res.json();
        setError(data.error || 'SMS gönderilemedi');
      }
    } catch { setError('Bağlantı hatası'); }
  }

  async function verifyPhoneCode() {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'phone', target: form.phone, code: phoneCode }),
      });
      if (res.ok) {
        setError('');
        await submitRegistration();
      } else {
        const data = await res.json();
        setError(data.error || 'Kod hatalı');
      }
    } catch { setError('Doğrulama hatası'); }
  }

  // Adım 4: Kayıt gönder
  async function submitRegistration() {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.toLowerCase().trim(),
          password: form.password,
          fullName: form.fullName.trim(),
          phone: form.phone.replace(/\D/g, ''),
          kvkkConsent: form.kvkkConsent,
          kvkkDataProcessing: form.kvkkDataProcessing,
          kvkkRetentionAccepted: form.kvkkRetentionAccepted,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Kayıt başarısız');
        return;
      }

      setSuccess('🎉 Kayıt başarılı! Giriş sayfasına yönlendiriliyorsunuz...');
      setTimeout(() => router.push('/login'), 2000);
    } catch {
      setError('Sunucu hatası');
    } finally {
      setLoading(false);
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!validateForm()) return;
    setStep('verify_email');
    sendEmailCode();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-primary)' }}>
      {/* Background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-80 h-80 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, var(--accent-green), transparent)' }} />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent-primary), transparent)' }} />
      </div>

      <div className="w-full max-w-md relative animate-fadeIn">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 overflow-hidden">
            <img src="/logo.jpg" alt="1923" className="w-16 h-16 object-cover" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">Hesap Oluştur</h1>
          <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>
            {step === 'form' && 'Bilgilerinizi girin'}
            {step === 'verify_email' && '📧 E-posta doğrulaması'}
            {step === 'verify_phone' && '📱 Telefon doğrulaması'}
          </p>
        </div>

        {/* Adım göstergesi */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {['form', 'verify_email', 'verify_phone'].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: step === s ? 'var(--accent-primary)' : (
                    ['form', 'verify_email', 'verify_phone'].indexOf(step) > i ? 'var(--accent-green)' : 'rgba(255,255,255,0.1)'
                  ),
                  color: step === s || ['form', 'verify_email', 'verify_phone'].indexOf(step) > i ? '#fff' : 'var(--text-muted)',
                }}>
                {['form', 'verify_email', 'verify_phone'].indexOf(step) > i ? '✓' : i + 1}
              </div>
              {i < 2 && <div className="w-8 h-0.5" style={{ background: 'rgba(255,255,255,0.1)' }} />}
            </div>
          ))}
        </div>

        <div className="glass-card p-8">
          {/* ═══ ADIM 1: KAYIT FORMU ═══ */}
          {step === 'form' && (
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="input-label">Ad Soyad</label>
                <input type="text" className="input-field" placeholder="Adınız Soyadınız"
                  value={form.fullName} onChange={e => update('fullName', e.target.value)} required />
              </div>

              <div>
                <label className="input-label">E-posta</label>
                <input type="email" className="input-field" placeholder="ornek@gmail.com"
                  value={form.email} onChange={e => update('email', e.target.value)} required />
              </div>

              <div>
                <label className="input-label">Telefon</label>
                <input type="tel" className="input-field" placeholder="05XX XXX XX XX"
                  value={form.phone} onChange={e => update('phone', e.target.value)} required />
              </div>

              <div>
                <label className="input-label">Şifre</label>
                <input type="password" className="input-field" placeholder="Min 8 karakter, 1 büyük, 1 küçük, 1 rakam"
                  value={form.password} onChange={e => update('password', e.target.value)} required />
              </div>

              <div>
                <label className="input-label">Şifre Tekrar</label>
                <input type="password" className="input-field" placeholder="Şifrenizi tekrar girin"
                  value={form.passwordConfirm} onChange={e => update('passwordConfirm', e.target.value)} required />
              </div>

              {/* KVKK Onayları */}
              <div className="space-y-3 pt-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>KVKK Onayları</p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-1 accent-[var(--accent-primary)]"
                    checked={form.kvkkConsent} onChange={e => update('kvkkConsent', e.target.checked)} />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Kişisel verilerimin işlenmesine ilişkin aydınlatma metnini okudum, kabul ediyorum.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-1 accent-[var(--accent-primary)]"
                    checked={form.kvkkDataProcessing} onChange={e => update('kvkkDataProcessing', e.target.checked)} />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Verilerimin 1923 sistemi kapsamında işlenmesine onay veriyorum.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-1 accent-[var(--accent-primary)]"
                    checked={form.kvkkRetentionAccepted} onChange={e => update('kvkkRetentionAccepted', e.target.checked)} />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Verilerimin yasal süre boyunca saklanmasını kabul ediyorum.
                  </span>
                </label>
              </div>

              {error && (
                <div className="p-3 rounded-lg text-sm" style={{
                  background: 'rgba(255, 107, 107, 0.1)',
                  border: '1px solid rgba(255, 107, 107, 0.3)',
                  color: 'var(--accent-red)'
                }}>⚠️ {error}</div>
              )}

              <button type="submit" className="btn-primary w-full">Devam Et →</button>
            </form>
          )}

          {/* ═══ ADIM 2: E-POSTA DOĞRULAMA ═══ */}
          {step === 'verify_email' && (
            <div className="space-y-4">
              <div className="text-center p-4 rounded-lg" style={{ background: 'rgba(108, 92, 231, 0.1)' }}>
                <p className="text-sm">
                  📧 <strong>{form.email}</strong> adresine doğrulama kodu gönderildi.
                </p>
              </div>

              <div>
                <label className="input-label">Doğrulama Kodu</label>
                <input type="text" className="input-field text-center text-xl tracking-[0.5em]"
                  placeholder="• • • • • •" maxLength={6}
                  value={emailCode} onChange={e => setEmailCode(e.target.value.replace(/\D/g, ''))} />
              </div>

              {error && (
                <div className="p-3 rounded-lg text-sm" style={{
                  background: 'rgba(255, 107, 107, 0.1)',
                  border: '1px solid rgba(255, 107, 107, 0.3)',
                  color: 'var(--accent-red)'
                }}>⚠️ {error}</div>
              )}

              <button onClick={verifyEmailCode} disabled={emailCode.length < 4}
                className="btn-primary w-full disabled:opacity-50">Doğrula ve Devam Et →</button>

              <div className="flex justify-between">
                <button onClick={() => setStep('form')} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  ← Geri
                </button>
                <button onClick={sendEmailCode} className="text-xs" style={{ color: 'var(--accent-primary)' }}>
                  Tekrar Gönder
                </button>
              </div>
            </div>
          )}

          {/* ═══ ADIM 3: TELEFON DOĞRULAMA ═══ */}
          {step === 'verify_phone' && (
            <div className="space-y-4">
              {!phoneSent ? (
                <>
                  <div className="text-center p-4 rounded-lg" style={{ background: 'rgba(0, 210, 160, 0.1)' }}>
                    <p className="text-sm">
                      📱 <strong>{form.phone}</strong> numarasına SMS gönderilecek.
                    </p>
                  </div>
                  <button onClick={sendPhoneCode} className="btn-primary w-full">SMS Kodu Gönder</button>
                </>
              ) : (
                <>
                  <div className="text-center p-4 rounded-lg" style={{ background: 'rgba(0, 210, 160, 0.1)' }}>
                    <p className="text-sm">📱 <strong>{form.phone}</strong> numarasına SMS gönderildi.</p>
                  </div>

                  <div>
                    <label className="input-label">SMS Doğrulama Kodu</label>
                    <input type="text" className="input-field text-center text-xl tracking-[0.5em]"
                      placeholder="• • • • • •" maxLength={6}
                      value={phoneCode} onChange={e => setPhoneCode(e.target.value.replace(/\D/g, ''))} />
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg text-sm" style={{
                      background: 'rgba(255, 107, 107, 0.1)',
                      border: '1px solid rgba(255, 107, 107, 0.3)',
                      color: 'var(--accent-red)'
                    }}>⚠️ {error}</div>
                  )}

                  <button onClick={verifyPhoneCode} disabled={phoneCode.length < 4 || loading}
                    className="btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2">
                    {loading ? <div className="spinner" /> : null}
                    {loading ? 'Kayıt yapılıyor...' : 'Doğrula ve Kaydol ✓'}
                  </button>

                  <button onClick={sendPhoneCode} className="text-xs w-full text-center"
                    style={{ color: 'var(--accent-primary)' }}>Tekrar Gönder</button>
                </>
              )}

              <button onClick={() => setStep('verify_email')} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                ← Geri
              </button>
            </div>
          )}

          {/* Başarı mesajı */}
          {success && (
            <div className="p-4 rounded-lg text-center" style={{
              background: 'rgba(0, 210, 160, 0.1)',
              border: '1px solid rgba(0, 210, 160, 0.3)',
              color: 'var(--accent-green)'
            }}>{success}</div>
          )}

          {/* Login linki */}
          <div className="mt-6 text-center">
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Zaten hesabınız var mı?{' '}
              <Link href="/login" className="font-medium hover:underline" style={{ color: 'var(--accent-primary)' }}>
                Giriş Yap
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center mt-6" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
          🔒 256-bit SSL ile korunmaktadır
        </p>
      </div>
    </div>
  );
}
