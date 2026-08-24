'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

/**
 * /sifre-degistir — İlk giriş sonrası zorunlu şifre değiştirme
 */
export default function SifreDegistirPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    // Eğer şifre değişikliği gerekmiyorsa dashboard'a yönlendir
    if (!u.forcePasswordChange) {
      if (u.role === 'admin' || u.role === 'super_admin') router.push('/admin');
      else if (u.role === 'registrar') router.push('/kayit-merkezi');
      else router.push('/dashboard');
      return;
    }
    setUser(u);
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (form.newPassword.length < 8) {
      setError('Şifre en az 8 karakter olmalı');
      return;
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(form.newPassword)) {
      setError('Şifre en az 1 büyük harf, 1 küçük harf ve 1 rakam içermelidir');
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setError('Şifreler eşleşmiyor');
      return;
    }

    setLoading(true);
    try {
      // Otomatik şifreyi "currentPassword" olarak göndermeye gerek yok
      // çünkü forcePasswordChange aktifken özel bir endpoint kullanıyoruz
      await apiFetch('/api/auth/force-password-change', {
        method: 'POST',
        body: JSON.stringify({ newPassword: form.newPassword }),
      });

      // localStorage'daki user'ı güncelle
      const updatedUser = { ...user, forcePasswordChange: false };
      localStorage.setItem('user', JSON.stringify(updatedUser));

      // Rolüne göre yönlendir
      if (user.role === 'admin' || user.role === 'super_admin') router.push('/admin');
      else if (user.role === 'registrar') router.push('/kayit-merkezi');
      else router.push('/dashboard');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  if (!user) return null;

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div style={{ position: 'fixed', top: '15%', right: '20%', width: '300px', height: '300px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,210,160,0.15), transparent)', filter: 'blur(80px)', pointerEvents: 'none' }} />

      <div className="w-full max-w-md px-4 animate-fadeIn">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, var(--accent-yellow), #f39c12)' }}>
            <span className="text-2xl">🔑</span>
          </div>
          <h1 className="text-2xl font-bold"><span className="gradient-text">Şifre Değiştirin</span></h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            İlk girişiniz — güvenliğiniz için yeni bir şifre belirlemeniz gerekiyor
          </p>
        </div>

        <div className="glass-card p-6">
          <div className="p-3 rounded-lg mb-4" style={{ background: 'rgba(255,183,77,0.15)', border: '1px solid rgba(255,183,77,0.4)' }}>
            <p className="text-sm" style={{ color: 'var(--accent-yellow)' }}>
              ⚠️ Hoş geldin <strong>{user.fullName}</strong>! Devam etmek için kendi şifrenizi oluşturun.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="input-label">Yeni Şifre</label>
              <input type="password" className="input-field" placeholder="Min 8 karakter, büyük+küçük+rakam"
                value={form.newPassword} onChange={e => setForm({ ...form, newPassword: e.target.value })} required />
            </div>
            <div>
              <label className="input-label">Şifre Tekrar</label>
              <input type="password" className="input-field" placeholder="Şifreyi tekrar girin"
                value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} required />
            </div>

            {/* Şifre gücü göstergesi */}
            {form.newPassword && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-1 flex-1 rounded-full" style={{
                      background: form.newPassword.length >= i * 3 ? (
                        i <= 1 ? 'var(--accent-red)' : i <= 2 ? 'var(--accent-yellow)' : 'var(--accent-green)'
                      ) : 'var(--border)',
                    }} />
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs" style={{ color: form.newPassword.length >= 8 ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {form.newPassword.length >= 8 ? '✓' : '○'} 8+ karakter
                  </span>
                  <span className="text-xs" style={{ color: /[A-Z]/.test(form.newPassword) ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {/[A-Z]/.test(form.newPassword) ? '✓' : '○'} Büyük harf
                  </span>
                  <span className="text-xs" style={{ color: /[a-z]/.test(form.newPassword) ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {/[a-z]/.test(form.newPassword) ? '✓' : '○'} Küçük harf
                  </span>
                  <span className="text-xs" style={{ color: /\d/.test(form.newPassword) ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {/\d/.test(form.newPassword) ? '✓' : '○'} Rakam
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg" style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)' }}>
                <p className="text-sm" style={{ color: 'var(--accent-red)' }}>⚠️ {error}</p>
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Kaydediliyor...' : '🔐 Yeni Şifreyi Kaydet'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
