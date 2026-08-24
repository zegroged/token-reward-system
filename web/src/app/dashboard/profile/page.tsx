'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import TikTokConnect from '@/components/TikTokConnect';
import NotificationBell from '@/components/NotificationBell';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });
  const [passwordMsg, setPasswordMsg] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletMsg, setWalletMsg] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    setUser(JSON.parse(stored));

    apiFetch('/api/profile').then(data => {
      setProfile(data);
      if (data.walletAddress) setWalletAddress(data.walletAddress);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [router]);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg('');

    if (passwordForm.newPass !== passwordForm.confirm) {
      setPasswordMsg('❌ Şifreler eşleşmiyor');
      return;
    }
    if (passwordForm.newPass.length < 8) {
      setPasswordMsg('❌ Şifre en az 8 karakter olmalı');
      return;
    }

    try {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'change_password',
          currentPassword: passwordForm.current,
          newPassword: passwordForm.newPass,
        }),
      });
      setPasswordMsg('✅ Şifre başarıyla değiştirildi');
      setPasswordForm({ current: '', newPass: '', confirm: '' });
    } catch (e: any) {
      setPasswordMsg(`❌ ${e.message}`);
    }
  }

  async function handleWalletSave() {
    setWalletMsg('');
    try {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'update_wallet', walletAddress }),
      });
      setWalletMsg('✅ Cüzdan adresi kaydedildi');
    } catch (e: any) {
      setWalletMsg(`❌ ${e.message}`);
    }
  }

  const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || '';
  const REDIRECT_URI = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI || '';

  function connectInstagram() {
    if (!META_APP_ID) { alert('Meta App ID yapılandırılmamış'); return; }
    const url = `https://api.instagram.com/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=user_profile,user_media&response_type=code&state=${user?.id}`;
    window.location.href = url;
  }

  if (!user) return null;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <aside className="sidebar">
        <div className="mb-8"><div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden"><img src="/logo.jpg" alt="1923" className="w-10 h-10 object-cover" /></div>
          <div><h2 className="font-bold text-sm">1923</h2></div>
        </div></div>
        <nav className="space-y-1">
          <Link href="/dashboard" className="sidebar-link"><span>📊</span> Ana Panel</Link>
          <Link href="/dashboard/transactions" className="sidebar-link"><span>📋</span> İşlem Geçmişi</Link>
          <Link href="/dashboard/withdraw" className="sidebar-link"><span>💸</span> Çekim Yap</Link>
          <Link href="/dashboard/profile" className="sidebar-link active"><span>👤</span> Profil</Link>
        </nav>
      </aside>

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn flex justify-between items-center">
          <h1 className="text-2xl font-bold"><span className="gradient-text">Profil</span> Ayarları</h1>
          <NotificationBell />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Hesap Bilgileri */}
          <div className="glass-card p-6 animate-fadeIn">
            <h3 className="font-semibold mb-4">👤 Hesap Bilgileri</h3>
            {loading ? <p style={{ color: 'var(--text-muted)' }}>Yükleniyor...</p> : (
              <div className="space-y-3">
                <div><span className="input-label">İsim</span><p className="font-medium">{profile?.fullName}</p></div>
                <div><span className="input-label">E-posta</span><p className="text-sm">{profile?.email}
                  <span className={`badge ${profile?.emailVerified ? 'badge-green' : 'badge-red'} ml-2`}>{profile?.emailVerified ? '✓ Doğrulanmış' : '✕ Doğrulanmamış'}</span>
                </p></div>
                <div><span className="input-label">Telefon</span><p className="text-sm">{profile?.phone}
                  <span className={`badge ${profile?.phoneVerified ? 'badge-green' : 'badge-red'} ml-2`}>{profile?.phoneVerified ? '✓ Doğrulanmış' : '✕ Doğrulanmamış'}</span>
                </p></div>
                <div><span className="input-label">Kayıt Tarihi</span><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString('tr-TR') : '-'}</p></div>
              </div>
            )}
          </div>

          <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.1s' }}>
            <h3 className="font-semibold mb-4">📱 Sosyal Medya Hesapları</h3>

            {/* ★ Zorunlu bağlama uyarısı */}
            {(!profile?.instagramHandle || !profile?.tiktokHandle) && (
              <div className="p-4 rounded-lg mb-4" style={{ background: 'rgba(255,59,48,0.15)', border: '1px solid rgba(255,59,48,0.3)' }}>
                <p className="text-sm font-medium" style={{ color: '#ff3b30' }}>
                  ⚠️ TOKEN kazanmak için hem Instagram hem TikTok hesabınızı bağlamanız zorunludur.
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {!profile?.instagramHandle && !profile?.tiktokHandle
                    ? 'Her iki hesabı da bağlamanız gerekiyor.'
                    : !profile?.instagramHandle
                      ? 'Instagram hesabınızı bağlamanız gerekiyor.'
                      : 'TikTok hesabınızı bağlamanız gerekiyor.'}
                </p>
              </div>
            )}
            
            {/* Instagram */}
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Instagram</h4>
              {profile?.instagramHandle ? (
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm">Hesap</span>
                    <span className="badge badge-green">@{profile.instagramHandle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Bağlanma Tarihi</span>
                    <span className="text-sm">{new Date(profile.instagramConnectedAt).toLocaleDateString('tr-TR')}</span>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: 'rgba(0,210,160,0.1)' }}>
                    <p className="text-sm" style={{ color: 'var(--accent-green)' }}>✅ Instagram bağlı ve aktif</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm('Instagram bağlantınızı kesmek istediğinize emin misiniz?')) return;
                      try {
                        await apiFetch('/api/instagram/disconnect', { method: 'POST' });
                        window.location.reload();
                      } catch (e: any) { alert(e.message); }
                    }}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors mt-2"
                  >
                    Bağlantıyı Kes
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    TOKEN kazanmak için Instagram hesabınızı bağlamanız gerekiyor.
                  </p>
                  <button onClick={connectInstagram} className="btn-primary w-full">
                    🔗 Instagram Hesabını Bağla
                  </button>
                </div>
              )}
            </div>

            <hr className="border-gray-700 my-4" />

            {/* TikTok */}
            <div>
              <TikTokConnect 
                isConnected={!!profile?.tiktokHandle} 
                tiktokHandle={profile?.tiktokHandle} 
              />
            </div>
          </div>

          {/* Cüzdan */}
          <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            <h3 className="font-semibold mb-4">💼 TRC20 Cüzdan</h3>
            <div className="space-y-3">
              <div>
                <label className="input-label">Cüzdan Adresi</label>
                <input type="text" className="input-field" placeholder="T ile başlayan 34 karakter"
                  value={walletAddress} onChange={e => setWalletAddress(e.target.value)} />
              </div>
              {walletMsg && <p className="text-sm">{walletMsg}</p>}
              <button onClick={handleWalletSave} className="btn-primary w-full">Kaydet</button>
            </div>
          </div>

          {/* Şifre Değiştir */}
          <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.3s' }}>
            <h3 className="font-semibold mb-4">🔑 Şifre Değiştir</h3>
            <form onSubmit={handlePasswordChange} className="space-y-3">
              <input type="password" className="input-field" placeholder="Mevcut şifre"
                value={passwordForm.current} onChange={(e) => setPasswordForm(p => ({ ...p, current: e.target.value }))} required />
              <input type="password" className="input-field" placeholder="Yeni şifre (min 8 karakter)"
                value={passwordForm.newPass} onChange={(e) => setPasswordForm(p => ({ ...p, newPass: e.target.value }))} required />
              <input type="password" className="input-field" placeholder="Yeni şifre tekrar"
                value={passwordForm.confirm} onChange={(e) => setPasswordForm(p => ({ ...p, confirm: e.target.value }))} required />
              {passwordMsg && <p className="text-sm">{passwordMsg}</p>}
              <button type="submit" className="btn-primary w-full">Şifreyi Değiştir</button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
