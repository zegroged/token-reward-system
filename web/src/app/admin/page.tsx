'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

interface UserData { id: string; email: string; fullName: string; role: string; }

interface AdminStats {
  poolBalance: number;
  activeUsers: number;
  pendingWithdrawals: number;
  flaggedReels: number;
  todayEarnings: number;
  pendingList: Array<{
    id: string; userName: string; amountToken: number; amountUsdt: number; createdAt: string;
  }>;
  recentActivity: Array<{
    id: string; user: string; action: string; details: any; createdAt: string;
  }>;
}

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (u.role !== 'admin' && u.role !== 'super_admin') { router.push('/dashboard'); return; }
    setUser(u);

    apiFetch('/api/admin/stats')
      .then(setStats)
      .catch((err) => {
        console.error('[Admin] API hatası:', err);
        setError('Admin verileri yüklenemedi. Sunucu bağlantısını kontrol edin.');
        setStats({
          poolBalance: 0, activeUsers: 0, pendingWithdrawals: 0,
          flaggedReels: 0, todayEarnings: 0, pendingList: [], recentActivity: [],
        });
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (!user) return null;
  const fmt = (n: number) => n.toLocaleString('tr-TR');

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} dk önce`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} saat önce`;
    return `${Math.floor(hours / 24)} gün önce`;
  }

  const actionLabels: Record<string, string> = {
    login_success: 'Giriş yaptı',
    user_registered: 'Kayıt oldu',
    instagram_connected: 'Instagram bağlandı',
    password_changed: 'Şifre değiştirdi',
    withdrawal_requested: 'Çekim talebi',
    withdrawal_approved: 'Çekim onaylandı',
    settings_updated: 'Ayarlar güncellendi',
    pool_deposit: 'Havuza para eklendi',
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <AdminSidebar />
      {/* API Hata Banner */}
      {error && (
        <div style={{ marginLeft: '260px', background: '#dc262620', border: '1px solid #dc2626', color: '#fca5a5', padding: '12px 24px', textAlign: 'center', fontSize: '14px' }}>
          ⚠️ {error} <button onClick={() => window.location.reload()} style={{ marginLeft: 12, textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 'none', color: '#fca5a5' }}>Tekrar Dene</button>
        </div>
      )}

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-8 animate-fadeIn">
          <h1 className="text-2xl font-bold">Admin <span className="gradient-text">Genel Bakış</span></h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Sistem durumu ve hızlı işlemler</p>
        </div>

        {/* Stat Cards — gerçek veri */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.1s' }}>
            <span className="text-xl">🏦</span>
            <div className="stat-value gradient-text mt-2">
              {loading ? '...' : fmt(stats?.poolBalance || 0)}
            </div>
            <div className="stat-label">Havuz Bakiyesi (₺)</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.15s' }}>
            <span className="text-xl">👥</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-blue)' }}>
              {loading ? '...' : stats?.activeUsers || 0}
            </div>
            <div className="stat-label">Aktif Çalışan</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            <span className="text-xl">⏳</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-yellow)' }}>
              {loading ? '...' : stats?.pendingWithdrawals || 0}
            </div>
            <div className="stat-label">Bekleyen Çekim</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.25s' }}>
            <span className="text-xl">⚠️</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-red)' }}>
              {loading ? '...' : stats?.flaggedReels || 0}
            </div>
            <div className="stat-label">Şüpheli Reel</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.3s' }}>
            <span className="text-xl">📈</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-green)' }}>
              {loading ? '...' : fmt(stats?.todayEarnings || 0)}
            </div>
            <div className="stat-label">Bugün Dağıtılan</div>
          </div>
        </div>

        {/* Bekleyen Çekimler + Hızlı İşlemler */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.4s' }}>
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <span>💸</span> Bekleyen Çekimler
              <span className="badge badge-yellow ml-auto">{stats?.pendingWithdrawals || 0} bekliyor</span>
            </h3>
            <div className="space-y-3">
              {(stats?.pendingList || []).length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Bekleyen çekim yok</p>
              ) : (
                (stats?.pendingList || []).map((w) => (
                  <div key={w.id} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <p className="text-sm font-medium">{w.userName}</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{fmt(w.amountToken)} TOKEN (~{w.amountUsdt} USDT)</p>
                    </div>
                    <Link href={`/admin/withdrawals`} className="px-3 py-1 rounded-lg text-xs font-semibold"
                      style={{ background: 'var(--accent-green-glow)', color: 'var(--accent-green)' }}>
                      İncele
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-4 animate-fadeIn" style={{ animationDelay: '0.5s' }}>
            <div className="glass-card p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2"><span>⚡</span> Hızlı İşlemler</h3>
              <div className="space-y-2">
                <Link href="/admin/pool" className="btn-primary w-full text-center block">🏦 Havuza Para Ekle</Link>
                <Link href="/admin/users" className="btn-secondary w-full text-center block">👥 Kullanıcı Yönetimi</Link>
                <Link href="/admin/settings" className="btn-secondary w-full text-center block">⚙️ Ayarlar</Link>
              </div>
            </div>
          </div>
        </div>

        {/* Son Aktiviteler — gerçek veri */}
        <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.6s' }}>
          <h3 className="font-semibold mb-4 flex items-center gap-2"><span>📜</span> Son Aktiviteler</h3>
          <table className="data-table">
            <thead>
              <tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Detay</th></tr>
            </thead>
            <tbody>
              {(stats?.recentActivity || []).length === 0 ? (
                <tr><td colSpan={4} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Henüz aktivite yok</td></tr>
              ) : (
                (stats?.recentActivity || []).map((log) => (
                  <tr key={log.id}>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{timeAgo(log.createdAt)}</td>
                    <td className="font-medium text-sm">{log.user}</td>
                    <td className="text-sm">{actionLabels[log.action] || log.action}</td>
                    <td><span className="badge badge-blue">{typeof log.details === 'object' ? JSON.stringify(log.details).substring(0,40) : ''}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
