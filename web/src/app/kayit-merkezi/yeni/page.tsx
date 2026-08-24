'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

export default function YeniCalisanPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [step, setStep] = useState(1); // 1: bilgiler+eposta, 2: sms+kvkk, 3: tamamla
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [emailCode, setEmailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [kvkk, setKvkk] = useState({ consent: false, data: false, retention: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState({ email: false, phone: false });
  const [countdown, setCountdown] = useState({ email: 0, phone: 0 });
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (!['registrar', 'admin', 'super_admin'].includes(u.role)) {
      router.push('/dashboard');
      return;
    }
    setUser(u);
  }, [router]);

  function startCountdown(type: 'email' | 'phone') {
    let seconds = 60;
    setCountdown(prev => ({ ...prev, [type]: seconds }));
    const interval = setInterval(() => {
      seconds--;
      setCountdown(prev => ({ ...prev, [type]: seconds }));
      if (seconds <= 0) clearInterval(interval);
    }, 1000);
  }

  async function sendCode(type: 'email' | 'phone') {
    setError('');
    const target = type === 'email' ? form.email : form.phone;
    if (!target) { setError(`${type === 'email' ? 'E-posta' : 'Telefon'} alanı boş`); return; }

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, target }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setCodeSent(prev => ({ ...prev, [type]: true }));
      startCountdown(type);
    } catch { setError('Kod gönderilemedi'); }
  }

  async function verifyCode(type: 'email' | 'phone') {
    setError('');
    const target = type === 'email' ? form.email : form.phone;
    const code = type === 'email' ? emailCode : phoneCode;
    if (code.length !== 6) { setError('6 haneli kodu girin'); return; }

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, target, code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }

      if (type === 'email') {
        setEmailVerified(true);
        setStep(2);
      } else {
        setPhoneVerified(true);
      }
    } catch { setError('Doğrulama hatası'); }
  }

  function goToStep2() {
    setError('');
    if (!form.fullName || !form.email || !form.phone) {
      setError('Tüm alanları doldurun');
      return;
    }
    if (!emailVerified) { setError('Önce e-postayı doğrulayın'); return; }
    setStep(2);
  }

  async function handleCreate() {
    setError('');
    if (!phoneVerified) { setError('Telefon doğrulanmalı'); return; }
    if (!kvkk.consent || !kvkk.data || !kvkk.retention) { setError('Tüm KVKK onayları zorunlu'); return; }

    setLoading(true);
    try {
      const data = await apiFetch('/api/registrar/create-employee', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          kvkkConsent: kvkk.consent,
          kvkkDataProcessing: kvkk.data,
          kvkkRetentionAccepted: kvkk.retention,
        }),
      });
      setResult(data.credentials);
      setStep(3);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  function resetForm() {
    setForm({ fullName: '', email: '', phone: '' });
    setEmailCode(''); setPhoneCode('');
    setEmailVerified(false); setPhoneVerified(false);
    setKvkk({ consent: false, data: false, retention: false });
    setCodeSent({ email: false, phone: false });
    setResult(null); setError('');
    setStep(1);
  }

  if (!user) return null;

  const stepLabels = ['Bilgiler & E-posta', 'Telefon & KVKK', 'Tamamlandı'];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <aside className="sidebar">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #00d2a0, #00b894)' }}>
              <span className="text-lg">📋</span>
            </div>
            <div>
              <h2 className="font-bold text-sm">Kayıt Merkezi</h2>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Çalışan Kaydı</p>
            </div>
          </div>
        </div>
        <nav className="space-y-1">
          <Link href="/kayit-merkezi" className="sidebar-link"><span>📊</span> Genel Bakış</Link>
          <Link href="/kayit-merkezi/yeni" className="sidebar-link active"><span>➕</span> Yeni Çalışan Kaydı</Link>
        </nav>
      </aside>

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn">
          <h1 className="text-2xl font-bold">Yeni <span className="gradient-text">Çalışan Kaydı</span></h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Görüntülü görüşme sonrası onaylanan adayın kaydını oluşturun</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {stepLabels.map((label, i) => (
            <div key={i} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{
                    background: step > i + 1 ? 'var(--accent-green)' : step === i + 1 ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                    color: step >= i + 1 ? 'white' : 'var(--text-muted)',
                    border: `2px solid ${step >= i + 1 ? 'transparent' : 'var(--border)'}`,
                  }}>
                  {step > i + 1 ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: '11px', color: step >= i + 1 ? 'var(--text-primary)' : 'var(--text-muted)', marginTop: '4px', whiteSpace: 'nowrap' }}>{label}</span>
              </div>
              {i < 2 && <div style={{ width: '80px', height: '2px', background: step > i + 1 ? 'var(--accent-green)' : 'var(--border)', marginBottom: '20px', marginInline: '8px' }} />}
            </div>
          ))}
        </div>

        <div className="max-w-lg mx-auto">
          <div className="glass-card p-6">
            {error && (
              <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)' }}>
                <p className="text-sm" style={{ color: 'var(--accent-red)' }}>⚠️ {error}</p>
              </div>
            )}

            {/* STEP 1: Bilgiler + E-posta doğrulama */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="input-label">Çalışanın Adı Soyadı</label>
                  <input type="text" className="input-field" placeholder="Adı Soyadı"
                    value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} />
                </div>
                <div>
                  <label className="input-label">E-posta Adresi</label>
                  <input type="email" className="input-field" placeholder="ornek@gmail.com"
                    value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} disabled={emailVerified} />
                </div>
                <div>
                  <label className="input-label">Telefon Numarası</label>
                  <input type="tel" className="input-field" placeholder="05XX XXX XX XX"
                    value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>

                {/* E-posta doğrulama */}
                <div className="p-4 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                  <h4 className="font-semibold text-sm mb-3">📧 E-posta Doğrulama</h4>
                  {emailVerified ? (
                    <p className="text-sm" style={{ color: 'var(--accent-green)' }}>✅ E-posta doğrulandı</p>
                  ) : !codeSent.email ? (
                    <button onClick={() => sendCode('email')} className="btn-secondary w-full text-sm" disabled={!form.email}>
                      📨 Doğrulama Kodu Gönder
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Çalışana gelen 6 haneli kodu girin</p>
                      <input type="text" className="input-field text-center text-xl font-bold" placeholder="000000"
                        maxLength={6} value={emailCode}
                        onChange={e => setEmailCode(e.target.value.replace(/\D/g, ''))}
                        style={{ letterSpacing: '6px' }} />
                      <div className="flex gap-2">
                        <button onClick={() => verifyCode('email')} className="btn-primary flex-1 text-sm" disabled={emailCode.length !== 6}>Doğrula</button>
                        <button onClick={() => sendCode('email')} disabled={countdown.email > 0} className="btn-secondary text-sm">
                          {countdown.email > 0 ? `${countdown.email}s` : 'Tekrar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button onClick={goToStep2} className="btn-primary w-full" disabled={!emailVerified}>
                  Telefon Doğrulamaya Geç →
                </button>
              </div>
            )}

            {/* STEP 2: Telefon + KVKK */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg" style={{ background: 'rgba(0,210,160,0.1)', border: '1px solid rgba(0,210,160,0.3)' }}>
                  <p className="text-sm" style={{ color: 'var(--accent-green)' }}>✅ E-posta doğrulandı: {form.email}</p>
                </div>

                {/* Telefon doğrulama */}
                <div className="p-4 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                  <h4 className="font-semibold text-sm mb-3">📱 SMS Doğrulama</h4>
                  {phoneVerified ? (
                    <p className="text-sm" style={{ color: 'var(--accent-green)' }}>✅ Telefon doğrulandı</p>
                  ) : !codeSent.phone ? (
                    <button onClick={() => sendCode('phone')} className="btn-secondary w-full text-sm">
                      📱 SMS Kodu Gönder ({form.phone})
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Çalışana gelen 6 haneli SMS kodunu girin</p>
                      <input type="text" className="input-field text-center text-xl font-bold" placeholder="000000"
                        maxLength={6} value={phoneCode}
                        onChange={e => setPhoneCode(e.target.value.replace(/\D/g, ''))}
                        style={{ letterSpacing: '6px' }} />
                      <div className="flex gap-2">
                        <button onClick={() => verifyCode('phone')} className="btn-primary flex-1 text-sm" disabled={phoneCode.length !== 6}>Doğrula</button>
                        <button onClick={() => sendCode('phone')} disabled={countdown.phone > 0} className="btn-secondary text-sm">
                          {countdown.phone > 0 ? `${countdown.phone}s` : 'Tekrar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* KVKK */}
                <div className="space-y-3 pt-2">
                  <h4 className="font-semibold text-sm">📜 KVKK Onayları</h4>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="checkbox-custom mt-0.5"
                      checked={kvkk.consent} onChange={e => setKvkk({ ...kvkk, consent: e.target.checked })} />
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      KVKK Aydınlatma Metnini okudum, onaylıyorum <span style={{ color: 'var(--accent-red)' }}>*</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="checkbox-custom mt-0.5"
                      checked={kvkk.data} onChange={e => setKvkk({ ...kvkk, data: e.target.checked })} />
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Instagram Verilerinin işlenmesine izin veriyorum <span style={{ color: 'var(--accent-red)' }}>*</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="checkbox-custom mt-0.5"
                      checked={kvkk.retention} onChange={e => setKvkk({ ...kvkk, retention: e.target.checked })} />
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Veri saklama politikasını kabul ediyorum <span style={{ color: 'var(--accent-red)' }}>*</span>
                    </span>
                  </label>
                </div>

                <button onClick={handleCreate} className="btn-primary w-full"
                  disabled={loading || !phoneVerified || !kvkk.consent || !kvkk.data || !kvkk.retention}>
                  {loading ? 'Oluşturuluyor...' : '🎉 Çalışan Kaydını Tamamla'}
                </button>
                <button onClick={() => setStep(1)} className="btn-secondary w-full text-sm">← Geri</button>
              </div>
            )}

            {/* STEP 3: Sonuç — Kimlik bilgileri */}
            {step === 3 && result && (
              <div className="space-y-4 text-center">
                <div className="text-5xl mb-2">🎉</div>
                <h2 className="text-xl font-bold" style={{ color: 'var(--accent-green)' }}>Kayıt Başarılı!</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Aşağıdaki bilgileri çalışana iletin. <strong>Şifre sadece bir kez gösterilir!</strong>
                </p>

                <div className="p-6 rounded-xl text-left space-y-4" style={{
                  background: 'linear-gradient(135deg, rgba(0,210,160,0.1), rgba(108,92,231,0.1))',
                  border: '2px solid var(--accent-green)',
                }}>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>E-POSTA (Kullanıcı Adı)</p>
                    <p className="font-bold text-lg" style={{ fontFamily: 'monospace' }}>{result.email}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>OTOMATİK ŞİFRE</p>
                    <p className="font-bold text-2xl tracking-wider" style={{ fontFamily: 'monospace', color: 'var(--accent-green)' }}>
                      {result.password}
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg" style={{ background: 'rgba(255,183,77,0.15)', border: '1px solid rgba(255,183,77,0.4)' }}>
                  <p className="text-sm" style={{ color: 'var(--accent-yellow)' }}>
                    ⚠️ Çalışan ilk girişinde şifresini değiştirmek zorundadır
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={resetForm} className="btn-primary flex-1">➕ Yeni Kayıt</button>
                  <Link href="/kayit-merkezi" className="btn-secondary flex-1 text-center">📊 Listeye Dön</Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
