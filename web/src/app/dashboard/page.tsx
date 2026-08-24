'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface UserData {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

interface DashboardData {
  balance: { available: number; pending: number; totalEarned: number; totalWithdrawn: number };
  weeklyEarnings: number;
  totalViews: number;
  engagementRate: string;
  recentTransactions: Array<{
    id: string; type: string; amount: number; description: string; createdAt: string;
  }>;
  instagram: { handle: string | null; connected: boolean; analyzedReels: number };
  tiktok: { handle: string | null; connected: boolean; analyzedVideos: number };
}

/* Mini sparkline SVG — dekoratif */
function Sparkline({ color = '#38BDF8', trend = 'up' }: { color?: string; trend?: string }) {
  const d = trend === 'up'
    ? 'M0 28 Q10 24 20 20 T40 16 T60 10 T80 8 T100 4'
    : 'M0 8 Q10 12 20 14 T40 18 T60 16 T80 20 T100 24';
  return (
    <svg width="100" height="32" viewBox="0 0 100 32" fill="none" style={{ opacity: 0.4 }}>
      <path d={d} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d={`${d} L100 32 L0 32 Z`} fill={`url(#g-${color.replace('#', '')})`} opacity="0.15" />
      <defs>
        <linearGradient id={`g-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor="transparent" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    setUser(JSON.parse(stored));

    apiFetch('/api/dashboard')
      .then(setData)
      .catch((err) => {
        console.error('[Dashboard] API hatası:', err);
        setError('Veriler yüklenemedi. Sunucu bağlantısını kontrol edin.');
        setData({
          balance: { available: 0, pending: 0, totalEarned: 0, totalWithdrawn: 0 },
          weeklyEarnings: 0, totalViews: 0, engagementRate: '0%',
          recentTransactions: [],
          instagram: { handle: null, connected: false, analyzedReels: 0 },
          tiktok: { handle: null, connected: false, analyzedVideos: 0 },
        });
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (!user) return null;

  const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = (n: number) => n.toLocaleString('tr-TR');
  const fmtViews = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  };

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} dk önce`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} saat önce`;
    const days = Math.floor(hours / 24);
    return `${days} gün önce`;
  }

  const navItems = [
    { href: '/dashboard', icon: '📊', label: 'Ana Panel', active: true },
    { href: '/dashboard/transactions', icon: '📋', label: 'İşlemler', active: false },
    { href: '/dashboard/withdraw', icon: '💸', label: 'Çekim Yap', active: false },
    { href: '/dashboard/profile', icon: '👤', label: 'Profil', active: false },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)' }}>

      {/* ═══ SIDEBAR ═══ */}
      <aside className="sidebar">
        {/* Logo */}
        <div style={{ padding: '4px 8px', marginBottom: '36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '12px',
              overflow: 'hidden', flexShrink: 0,
            }}>
              <img src="/logo.jpg" alt="1923" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div>
              <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--text-bright)' }}>
                1923<span style={{ color: 'var(--accent-primary)', fontSize: '16px' }}>☪</span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link${item.active ? ' active' : ''}`}
            >
              <span style={{ fontSize: '18px' }}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Sign Out — bottom */}
        <div style={{ marginTop: 'auto' }}>
          <button
            onClick={() => { localStorage.clear(); router.push('/login'); }}
            className="sidebar-link"
            style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <span style={{ fontSize: '16px' }}>↩</span>
            <span>Çıkış Yap</span>
          </button>
        </div>
      </aside>

      {/* ═══ MAIN CONTENT ═══ */}
      <main style={{ marginLeft: '240px', padding: '32px', flex: 1, minWidth: 0 }}>
        {/* API Hata Banner */}
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5', padding: '12px 20px', textAlign: 'center', fontSize: '14px',
            borderRadius: '12px', marginBottom: '24px',
          }}>
            ⚠️ {error}
            <button onClick={() => window.location.reload()} style={{
              marginLeft: 12, textDecoration: 'underline', cursor: 'pointer',
              background: 'none', border: 'none', color: '#fca5a5',
            }}>Tekrar Dene</button>
          </div>
        )}

        {/* ═══ STAT CARDS — 2x2 Grid ═══ */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '20px', marginBottom: '24px',
        }}>
          {/* Balance */}
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.1s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', opacity: 0.7 }}>💰</span>
                <span className="stat-label" style={{ margin: 0 }}>Bakiye</span>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>↗ +3.2%</span>
            </div>
            <div className="stat-value gradient-text" style={{ marginBottom: '4px' }}>
              {loading ? '...' : fmt(data?.balance.available || 0)}
            </div>
            <div className="stat-label">TKN</div>
            <div style={{ position: 'absolute', bottom: '0', right: '0', opacity: 0.3 }}>
              <Sparkline color="#38BDF8" trend="up" />
            </div>
          </div>

          {/* Weekly */}
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', opacity: 0.7 }}>📈</span>
                <span className="stat-label" style={{ margin: 0 }}>Haftalık</span>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>↗ +15.1%</span>
            </div>
            <div className="stat-value" style={{ color: 'var(--green)', marginBottom: '4px' }}>
              {loading ? '...' : fmtInt(data?.weeklyEarnings || 0)}
            </div>
            <div className="stat-label">TKN</div>
            <div style={{ position: 'absolute', bottom: '0', right: '0', opacity: 0.3 }}>
              <Sparkline color="#22C55E" trend="up" />
            </div>
          </div>

          {/* Total Views */}
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', opacity: 0.7 }}>👁️</span>
                <span className="stat-label" style={{ margin: 0 }}>Toplam İzlenme</span>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>↗ +8.7%</span>
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-primary)', marginBottom: '4px' }}>
              {loading ? '...' : fmtViews(data?.totalViews || 0)}
            </div>
            <div className="stat-label">Görüntüleme</div>
          </div>

          {/* Engagement */}
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.4s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', opacity: 0.7 }}>❤️</span>
                <span className="stat-label" style={{ margin: 0 }}>Etkileşim</span>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>↗ +11.4%</span>
            </div>
            <div className="stat-value" style={{ color: 'var(--yellow)', marginBottom: '4px' }}>
              {loading ? '...' : `%${data?.engagementRate || '0'}`}
            </div>
            <div className="stat-label">Ortalama Oran</div>
          </div>
        </div>

        {/* ═══ BOTTOM ROW — Transactions + Platform Status ═══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

          {/* Recent Transactions */}
          <div className="glass-card animate-fadeIn" style={{ padding: '24px', animationDelay: '0.5s' }}>
            <h3 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '20px', color: 'var(--text-bright)' }}>
              Son İşlemler
            </h3>

            {loading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Yükleniyor...</p>
            ) : (data?.recentTransactions || []).length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Henüz işlem yok</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Tür</th>
                    <th>Miktar (TKN)</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recentTransactions || []).slice(0, 5).map((tx) => (
                    <tr key={tx.id}>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {new Date(tx.createdAt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}
                      </td>
                      <td style={{ textTransform: 'capitalize', fontSize: '13px' }}>
                        {tx.type === 'earning' ? 'Kazanç' : tx.type === 'withdrawal' ? 'Çekim' : tx.type === 'adjustment' ? 'Düzeltme' : tx.type}
                      </td>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                        {fmt(Math.abs(tx.amount))}
                      </td>
                      <td>
                        <span className={`badge ${tx.amount > 0 ? 'badge-green' : 'badge-yellow'}`}>
                          {tx.amount > 0 ? 'Tamamlandı' : 'Beklemede'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Platform Status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Instagram Status */}
            <div className="glass-card animate-fadeIn" style={{ padding: '24px', animationDelay: '0.6s' }}>
              <h3 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '16px', color: 'var(--text-bright)' }}>
                📸 Instagram Durumu
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #E1306C, #F56040, #FCAF45)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '18px', color: 'white', fontWeight: 700,
                }}>
                  {user.fullName.charAt(0)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {data?.instagram.connected ? `@${data.instagram.handle}` : 'Bağlı Değil'}
                  </div>
                  {data?.instagram.connected && (
                    <span className="badge badge-green" style={{ fontSize: '10px', padding: '2px 8px' }}>✓ Doğrulanmış</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '24px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <div><strong style={{ color: 'var(--text-bright)', fontSize: '16px' }}>{data?.instagram.analyzedReels || 0}</strong><br />Reel</div>
              </div>
            </div>

            {/* TikTok Status */}
            <div className="glass-card animate-fadeIn" style={{ padding: '24px', animationDelay: '0.7s' }}>
              <h3 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '16px', color: 'var(--text-bright)' }}>
                🎵 TikTok Durumu
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #00f2ea, #ff0050)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '18px', color: 'white', fontWeight: 700,
                }}>
                  {user.fullName.charAt(0)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {data?.tiktok?.connected ? `@${data.tiktok.handle}` : 'Bağlı Değil'}
                  </div>
                  {data?.tiktok?.connected && (
                    <span className="badge badge-green" style={{ fontSize: '10px', padding: '2px 8px' }}>✓ Bağlı</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '24px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <div><strong style={{ color: 'var(--text-bright)', fontSize: '16px' }}>{data?.tiktok?.analyzedVideos || 0}</strong><br />Video</div>
              </div>
            </div>

            {/* Wallet Summary */}
            <div className="glass-card animate-fadeIn" style={{ padding: '24px', animationDelay: '0.8s' }}>
              <h3 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '16px', color: 'var(--text-bright)' }}>
                💼 Cüzdan
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Toplam Kazanılan</span>
                  <span style={{ fontWeight: 600, color: 'var(--green)' }}>{fmtInt(data?.balance.totalEarned || 0)} TKN</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Çekilen</span>
                  <span style={{ fontWeight: 600 }}>{fmtInt(data?.balance.totalWithdrawn || 0)} TKN</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Beklemede</span>
                  <span style={{ fontWeight: 600, color: 'var(--yellow)' }}>{fmtInt(data?.balance.pending || 0)} TKN</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
