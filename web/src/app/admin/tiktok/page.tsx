'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

interface TikTokVideo {
  id: string; userName: string; tiktokHandle: string | null;
  viewCount: number; likeCount: number; commentCount: number;
  shareCount: number; engagementRate: number; authenticityScore: number;
  analysisLevel: string; flagged: boolean; collectedAt: string;
}

export default function AdminTikTokPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<TikTokVideo[]>([]);
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
    loadVideos();
  }, [router, filter, page]);

  async function loadVideos() {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/admin/tiktok?page=${page}&limit=20&filter=${filter}`);
      setVideos(data.videos);
      setStats(data.stats);
      setTotalPages(data.pagination.totalPages);
    } catch {
      setVideos([]);
      setStats({ total: 0, flagged: 0, authentic: 0, avgScore: 0 });
    }
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
          <h1 className="text-2xl font-bold">
            <span style={{ color: '#ee1d52' }}>TikTok</span> Verileri
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            {stats.total} toplam video • {stats.flagged} flagged
          </p>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="stat-card animate-fadeIn">
            <div className="stat-value" style={{ color: '#ee1d52' }}>{stats.total}</div>
            <div className="stat-label">Toplam Video</div>
          </div>
          <div className="stat-card animate-fadeIn">
            <div className="stat-value" style={{ color: 'var(--accent-green)' }}>{stats.authentic}</div>
            <div className="stat-label">Gerçek</div>
          </div>
          <div className="stat-card animate-fadeIn">
            <div className="stat-value" style={{ color: 'var(--accent-red)' }}>{stats.flagged}</div>
            <div className="stat-label">Flagged</div>
          </div>
          <div className="stat-card animate-fadeIn">
            <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>{stats.avgScore}</div>
            <div className="stat-label">Ort. Skor</div>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {['all', 'flagged', 'authentic'].map(f => (
            <button key={f} onClick={() => { setFilter(f); setPage(1); }}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: filter === f ? '#ee1d52' : 'var(--bg-card)', color: filter === f ? 'white' : 'var(--text-secondary)', border: `1px solid ${filter === f ? '#ee1d52' : 'var(--border)'}` }}>
              {f === 'all' ? 'Tümü' : f === 'flagged' ? '⚠️ Flagged' : '✅ Gerçek'}
            </button>
          ))}
        </div>

        <div className="glass-card overflow-hidden animate-fadeIn">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kullanıcı</th><th>İzlenme</th><th>Beğeni</th><th>Yorum</th>
                <th>Paylaşım</th><th>Etk %</th><th>Skor</th><th>Seviye</th><th>Durum</th><th>Tarih</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
              ) : videos.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Henüz veri yok</td></tr>
              ) : videos.map(v => (
                <tr key={v.id}>
                  <td>
                    <p className="font-medium text-sm">{v.userName}</p>
                    {v.tiktokHandle && <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>@{v.tiktokHandle}</p>}
                  </td>
                  <td>{v.viewCount.toLocaleString()}</td>
                  <td>{v.likeCount.toLocaleString()}</td>
                  <td>{v.commentCount}</td>
                  <td>{v.shareCount}</td>
                  <td style={{ color: v.engagementRate > 10 ? 'var(--accent-red)' : v.engagementRate > 3 ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>
                    {v.engagementRate.toFixed(1)}%
                  </td>
                  <td><span className={`badge ${v.authenticityScore >= 70 ? 'badge-green' : v.authenticityScore >= 40 ? 'badge-yellow' : 'badge-red'}`}>{v.authenticityScore}</span></td>
                  <td><span className="badge badge-blue" style={{ fontSize: '10px' }}>{v.analysisLevel}</span></td>
                  <td>{v.flagged ? <span className="badge badge-red">⚠️ Flag</span> : <span className="badge badge-green">✓</span>}</td>
                  <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{timeAgo(v.collectedAt)}</td>
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
