'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Giriş başarısız');
        return;
      }

      // Token'ları localStorage'a kaydet
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));

      // İlk girişte şifre değişikliği zorunlu mu?
      if (data.user.forcePasswordChange) {
        router.push('/sifre-degistir');
        return;
      }

      // Role göre yönlendir
      if (data.user.role === 'admin' || data.user.role === 'super_admin') {
        router.push('/admin');
      } else if (data.user.role === 'registrar') {
        router.push('/kayit-merkezi');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-primary)' }}>
      {/* Background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, var(--accent-primary), transparent)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent-green), transparent)' }} />
      </div>

      <div className="w-full max-w-md relative animate-fadeIn">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 overflow-hidden">
            <img src="/logo.jpg" alt="1923" className="w-16 h-16 object-cover" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">1923</h1>
          <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>Hesabınıza giriş yapın</p>
        </div>

        {/* Form */}
        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="input-label">E-posta</label>
              <input
                id="email"
                type="email"
                className="input-field"
                placeholder="ornek@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="input-label">Şifre</label>
              <input
                id="password"
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg text-sm" style={{
                background: 'rgba(255, 107, 107, 0.1)',
                border: '1px solid rgba(255, 107, 107, 0.3)',
                color: 'var(--accent-red)'
              }}>
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
              id="login-button"
            >
              {loading ? <div className="spinner" /> : null}
              {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Henüz hesabınız yok mu?{' '}
              <Link href="/kayit" className="font-medium hover:underline" style={{ color: 'var(--accent-primary)' }}>
                Hesap Oluştur
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center mt-6" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
          🔒 256-bit SSL ile korunmaktadır
        </p>
      </div>
    </div>
  );
}
