'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

interface ReelItem {
  id: string; userName: string; instagramHandle: string | null;
  reelUrl: string; viewCount: number; likeCount: number;
  commentCount: number; saveCount: number; engagementRate: number;
  authenticityScore: number; flagReasons: string[];
  isLabeled: boolean; labeledAuthentic: boolean | null;
}

const FLAG_TR: Record<string, string> = {
  'suspicious_high_engagement': 'Şüpheli yüksek etkileşim',
  'engagement_spike': 'Etkileşim ani artış',
  'low_engagement': 'Düşük etkileşim',
  'no_saves_or_shares': 'Kaydetme/paylaşım yok',
  'suspicious_high_like_ratio': 'Şüpheli beğeni oranı',
  'comment_spam': 'Yorum spam şüphesi',
  'view_velocity_spike': 'Ani izlenme artışı',
  'bot_pattern': 'Bot davranış kalıbı',
};

function translateFlag(flag: string): string {
  const [key, value] = flag.split(':');
  const tr = FLAG_TR[key] || key;
  return value ? `${tr}: ${value}` : tr;
}

export default function MLLabelingPage() {
  const router = useRouter();
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [viewMode, setViewMode] = useState<'unlabeled' | 'all'>('unlabeled');
  const [stats, setStats] = useState({ total: 0, labeled: 0, authentic: 0, fake: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (u.role !== 'admin' && u.role !== 'super_admin') { router.push('/dashboard'); }
    loadReels();
  }, [router, viewMode, page]);

  async function loadReels() {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/admin/ml?view=${viewMode}&page=${page}&limit=20`);
      setReels(data.reels);
      setStats(data.stats);
      setTotalPages(data.pagination.totalPages);
    } catch { }
    setLoading(false);
  }

  async function labelReel(id: string, isAuthentic: boolean) {
    try {
      await apiFetch('/api/admin/ml', {
        method: 'PATCH',
        body: JSON.stringify({ reelId: id, isAuthentic }),
      });
      loadReels();
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <AdminSidebar />

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn">
          <h1 className="text-2xl font-bold"><span className="gradient-text">ML</span> Etiketleme</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Şüpheli reelleri incele, gerçek/sahte olarak etiketle</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="stat-card animate-fadeIn"><div className="stat-value gradient-text">{stats.total}</div><div className="stat-label">Toplam Flagged</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-blue)' }}>{stats.labeled}</div><div className="stat-label">Etiketlenen</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-green)' }}>{stats.authentic}</div><div className="stat-label">Gerçek</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-red)' }}>{stats.fake}</div><div className="stat-label">Sahte</div></div>
        </div>

        {/* Filtre */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => { setViewMode('unlabeled'); setPage(1); }}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: viewMode === 'unlabeled' ? 'var(--accent-primary)' : 'var(--bg-card)', color: viewMode === 'unlabeled' ? 'white' : 'var(--text-secondary)', border: `1px solid ${viewMode === 'unlabeled' ? 'var(--accent-primary)' : 'var(--border)'}` }}>
            ⏳ Etiketlenmemiş ({stats.total - stats.labeled})
          </button>
          <button onClick={() => { setViewMode('all'); setPage(1); }}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: viewMode === 'all' ? 'var(--accent-primary)' : 'var(--bg-card)', color: viewMode === 'all' ? 'white' : 'var(--text-secondary)', border: `1px solid ${viewMode === 'all' ? 'var(--accent-primary)' : 'var(--border)'}` }}>
            📋 Tümü ({stats.total})
          </button>
        </div>

        {/* Tablo */}
        <div className="glass-card overflow-hidden animate-fadeIn">
          <table className="data-table">
            <thead><tr><th>Kullanıcı</th><th>İzlenme</th><th>Beğeni</th><th>Yorum</th><th>Etk %</th><th>Skor</th><th>Bayraklar</th><th>Etiket</th><th>İşlem</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
              ) : reels.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {viewMode === 'unlabeled' ? '🎉 Tüm reeller etiketlendi!' : 'Veri bulunamadı'}
                </td></tr>
              ) : reels.map(r => (
                <tr key={r.id}>
                  <td>
                    <p className="font-medium text-sm">{r.userName}</p>
                    {r.instagramHandle && <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>@{r.instagramHandle}</p>}
                  </td>
                  <td>{r.viewCount.toLocaleString()}</td>
                  <td>{r.likeCount.toLocaleString()}</td>
                  <td>{r.commentCount}</td>
                  <td style={{ color: r.engagementRate > 10 ? 'var(--accent-red)' : 'var(--accent-yellow)' }}>
                    {r.engagementRate.toFixed(1)}%
                  </td>
                  <td><span className={`badge ${r.authenticityScore >= 50 ? 'badge-yellow' : 'badge-red'}`}>{r.authenticityScore}</span></td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {r.flagReasons.slice(0, 2).map((f, i) => (
                        <span key={i} className="badge badge-red" style={{ fontSize: '9px' }}>{translateFlag(f)}</span>
                      ))}
                      {r.flagReasons.length > 2 && <span className="badge badge-yellow" style={{ fontSize: '9px' }}>+{r.flagReasons.length - 2}</span>}
                    </div>
                  </td>
                  <td>
                    {r.isLabeled ? (
                      <span className={`badge ${r.labeledAuthentic ? 'badge-green' : 'badge-red'}`}>
                        {r.labeledAuthentic ? '✓ Gerçek' : '✕ Sahte'}
                      </span>
                    ) : (
                      <span className="badge badge-yellow">Bekliyor</span>
                    )}
                  </td>
                  <td>
                    {!r.isLabeled && (
                      <div className="flex gap-1">
                        <button onClick={() => labelReel(r.id, true)}
                          className="px-2 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: 'rgba(0,210,160,0.15)', color: 'var(--accent-green)' }}>✓ Gerçek</button>
                        <button onClick={() => labelReel(r.id, false)}
                          className="px-2 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: 'rgba(255,107,107,0.15)', color: 'var(--accent-red)' }}>✕ Sahte</button>
                      </div>
                    )}
                  </td>
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
