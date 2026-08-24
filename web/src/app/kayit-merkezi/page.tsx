'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface Employee {
  id: string; fullName: string; email: string; isActive: boolean;
  instagramHandle: string | null; instagramConnectedAt: string | null;
  forcePasswordChange: boolean; createdAt: string;
  balance: { available: number; totalEarned: number } | null;
}

export default function KayitMerkeziPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stats, setStats] = useState({ today: 0, thisWeek: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (!['registrar', 'admin', 'super_admin'].includes(u.role)) {
      router.push('/dashboard');
      return;
    }
    setUser(u);
    loadEmployees();
  }, [router, page]);

  async function loadEmployees() {
    setLoading(true);
    try {
      let url = `/api/registrar/employees?page=${page}&limit=20`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const data = await apiFetch(url);
      setEmployees(data.employees);
      setStats(data.stats);
      setTotalPages(data.pagination.totalPages);
    } catch { }
    setLoading(false);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    loadEmployees();
  }

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return `${Math.floor(diff / 60000)} dk önce`;
    if (h < 24) return `${h} saat önce`;
    return `${Math.floor(h / 24)} gün önce`;
  }

  if (!user) return null;

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
          <Link href="/kayit-merkezi" className="sidebar-link active">
            <span>📊</span> Genel Bakış
          </Link>
          <Link href="/kayit-merkezi/yeni" className="sidebar-link">
            <span>➕</span> Yeni Çalışan Kaydı
          </Link>
        </nav>

        <div className="absolute bottom-6 left-4 right-4">
          <div className="glass-card p-3">
            <p className="font-semibold text-sm truncate">{user.fullName}</p>
            <p className="badge badge-green mt-1" style={{ fontSize: '10px' }}>KAYIT MERKEZİ</p>
          </div>
          <button onClick={() => { localStorage.clear(); router.push('/login'); }}
            className="w-full mt-3 text-sm py-2 rounded-lg"
            style={{ color: 'var(--accent-red)', background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.2)' }}>
            🚪 Çıkış Yap
          </button>
        </div>
      </aside>

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold">Kayıt Merkezi <span className="gradient-text">Paneli</span></h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Çalışan kayıtlarını yönetin</p>
          </div>
          <Link href="/kayit-merkezi/yeni" className="btn-primary">
            ➕ Yeni Çalışan Kaydı
          </Link>
        </div>

        {/* İstatistikler */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.1s' }}>
            <span className="text-xl">📅</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-green)' }}>{stats.today}</div>
            <div className="stat-label">Bugün Oluşturulan</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.15s' }}>
            <span className="text-xl">📊</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-blue)' }}>{stats.thisWeek}</div>
            <div className="stat-label">Bu Hafta</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            <span className="text-xl">👥</span>
            <div className="stat-value mt-2 gradient-text">{stats.total}</div>
            <div className="stat-label">Toplam Kayıt</div>
          </div>
        </div>

        {/* Arama */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <input type="text" className="input-field" placeholder="İsim, e-posta veya IG ara..."
            value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: '300px' }} />
          <button type="submit" className="btn-secondary">Ara</button>
        </form>

        {/* Çalışan Listesi */}
        <div className="glass-card overflow-hidden animate-fadeIn">
          <table className="data-table">
            <thead><tr><th>Çalışan</th><th>Instagram</th><th>Bakiye</th><th>Şifre</th><th>Durum</th><th>Kayıt</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Henüz kayıt yok</td></tr>
              ) : employees.map(e => (
                <tr key={e.id}>
                  <td>
                    <p className="font-medium text-sm">{e.fullName}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{e.email}</p>
                  </td>
                  <td>
                    {e.instagramHandle ? (
                      <span className="badge badge-green">@{e.instagramHandle}</span>
                    ) : (
                      <span className="badge badge-yellow">Bağlanmadı</span>
                    )}
                  </td>
                  <td className="font-semibold text-sm">
                    {e.balance ? e.balance.available.toLocaleString() : '0'} <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '11px' }}>TOKEN</span>
                  </td>
                  <td>
                    {e.forcePasswordChange ? (
                      <span className="badge badge-yellow">Değiştirilmedi</span>
                    ) : (
                      <span className="badge badge-green">Değiştirildi</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${e.isActive ? 'badge-green' : 'badge-red'}`}>
                      {e.isActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{timeAgo(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-secondary text-sm px-4">← Önceki</button>
            <span className="px-4 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn-secondary text-sm px-4">Sonraki →</button>
          </div>
        )}
      </main>
    </div>
  );
}
