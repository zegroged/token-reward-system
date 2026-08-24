'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

interface Reel {
  id: string; userName: string; instagramHandle: string | null;
  viewCount: number; likeCount: number; commentCount: number;
  saveCount: number; engagementRate: number; authenticityScore: number;
  analysisLevel: string; flagged: boolean; collectedAt: string;
}

export default function AdminReelsPage() {
  const router = useRouter();
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState({ total: 0, flagged: 0, authentic: 0, avgScore: 0 });

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (u.role !== 'admin' && u.role !== 'super_admin') { router.push('/dashboard'); }
    loadReels();
  }, [router, filter, page]);

  async function loadReels() {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/admin/reels?page=${page}&limit=20&filter=${filter}`);
      setReels(data.reels);
      setStats(data.stats);
      setTotalPages(data.pagination.totalPages);
    } catch { }
    setLoading(false);
  }

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 24) return `${h} saat önce`;
    return `${Math.floor(h / 24)} gün önce`;
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <AdminSidebar />

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn">
          <h1 className="text-2xl font-bold"><span className="gradient-text">Instagram</span> Verileri</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            {stats.total} toplam reel • {stats.flagged} flagged
          </p>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="stat-card animate-fadeIn"><div className="stat-value gradient-text">{stats.total}</div><div className="stat-label">Toplam Reel</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-green)' }}>{stats.authentic}</div><div className="stat-label">Gerçek</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-red)' }}>{stats.flagged}</div><div className="stat-label">Flagged</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-blue)' }}>{stats.avgScore}</div><div className="stat-label">Ort. Skor</div></div>
        </div>

        <div className="flex gap-2 mb-4">
          {['all', 'flagged', 'authentic'].map(f => (
            <button key={f} onClick={() => { setFilter(f); setPage(1); }}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: filter === f ? 'var(--accent-primary)' : 'var(--bg-card)', color: filter === f ? 'white' : 'var(--text-secondary)', border: `1px solid ${filter === f ? 'var(--accent-primary)' : 'var(--border)'}` }}>
              {f === 'all' ? 'Tümü' : f === 'flagged' ? '⚠️ Flagged' : '✅ Gerçek'}
            </button>
          ))}
        </div>

        <div className="glass-card overflow-hidden animate-fadeIn">
          <table className="data-table">
            <thead>
              <tr><th>Kullanıcı</th><th>İzlenme</th><th>Beğeni</th><th>Yorum</th><th>Etk %</th><th>Skor</th><th>Seviye</th><th>Durum</th><th>Tarih</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
              ) : reels.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Henüz veri yok</td></tr>
              ) : reels.map(r => (
                <tr key={r.id}>
                  <td>
                    <p className="font-medium text-sm">{r.userName}</p>
                    {r.instagramHandle && <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>@{r.instagramHandle}</p>}
                  </td>
                  <td>{r.viewCount.toLocaleString()}</td>
                  <td>{r.likeCount.toLocaleString()}</td>
                  <td>{r.commentCount}</td>
                  <td style={{ color: r.engagementRate > 10 ? 'var(--accent-red)' : r.engagementRate > 3 ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>
                    {r.engagementRate.toFixed(1)}%
                  </td>
                  <td><span className={`badge ${r.authenticityScore >= 70 ? 'badge-green' : r.authenticityScore >= 40 ? 'badge-yellow' : 'badge-red'}`}>{r.authenticityScore}</span></td>
                  <td><span className="badge badge-blue" style={{ fontSize: '10px' }}>{r.analysisLevel}</span></td>
                  <td>{r.flagged ? <span className="badge badge-red">⚠️ Flag</span> : <span className="badge badge-green">✓</span>}</td>
                  <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{timeAgo(r.collectedAt)}</td>
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
