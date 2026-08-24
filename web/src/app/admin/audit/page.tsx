'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

interface AuditEntry {
  id: string; user: string; email: string; action: string;
  details: any; ipAddress: string; createdAt: string;
}

export default function AdminAuditPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [actionTypes, setActionTypes] = useState<Array<{action: string; count: number}>>([]);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (u.role !== 'admin' && u.role !== 'super_admin') { router.push('/dashboard'); return; }
    loadLogs();
  }, [router, page, actionFilter]);

  async function loadLogs() {
    setLoading(true);
    try {
      let url = `/api/admin/audit?page=${page}&limit=30`;
      if (actionFilter) url += `&action=${actionFilter}`;
      const data = await apiFetch(url);
      setLogs(data.logs);
      setTotalPages(data.pagination.totalPages);
      if (data.actionTypes) setActionTypes(data.actionTypes);
    } catch { }
    setLoading(false);
  }

  const actionLabels: Record<string, string> = {
    login_success: '✅ Giriş', login_failed: '❌ Başarısız giriş',
    login_blocked_locked: '🔒 Hesap kilitli', user_registered: '📝 Kayıt',
    instagram_connected: '📱 IG bağlandı', instagram_duplicate_blocked: '🚫 IG çift hesap',
    password_changed: '🔑 Şifre değişti', withdrawal_requested: '💸 Çekim talebi',
    withdrawal_approved: '✅ Çekim onay', withdrawal_rejected: '❌ Çekim ret',
    settings_updated: '⚙️ Ayar güncellendi', pool_deposit: '🏦 Havuz yatırım',
    wallet_updated: '💼 Cüzdan güncellendi',
  };

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return `${Math.floor(diff / 60000)} dk önce`;
    if (h < 24) return `${h} saat önce`;
    return `${Math.floor(h / 24)} gün önce`;
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <AdminSidebar />

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn">
          <h1 className="text-2xl font-bold"><span className="gradient-text">Denetim</span> Kayıtları</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Tüm sistem aksiyonları</p>
        </div>

        {/* Filtre */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={() => { setActionFilter(''); setPage(1); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: !actionFilter ? 'var(--accent-primary)' : 'var(--bg-card)', color: !actionFilter ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Tümü
          </button>
          {actionTypes.map(at => (
            <button key={at.action} onClick={() => { setActionFilter(at.action); setPage(1); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: actionFilter === at.action ? 'var(--accent-primary)' : 'var(--bg-card)', color: actionFilter === at.action ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              {actionLabels[at.action] || at.action} ({at.count})
            </button>
          ))}
        </div>

        <div className="glass-card overflow-hidden animate-fadeIn">
          <table className="data-table">
            <thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>IP</th><th>Detay</th></tr></thead>
            <tbody>
              {loading ? (<tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>) :
              logs.length === 0 ? (<tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Kayıt yok</td></tr>) :
              logs.map(l => (
                <tr key={l.id}>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px', whiteSpace: 'nowrap' }}>{timeAgo(l.createdAt)}</td>
                  <td><p className="font-medium text-sm">{l.user}</p><p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{l.email}</p></td>
                  <td><span className="badge badge-blue text-xs">{actionLabels[l.action] || l.action}</span></td>
                  <td style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.ipAddress}</td>
                  <td style={{ fontSize: '11px', color: 'var(--text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {l.details ? JSON.stringify(l.details).substring(0, 60) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
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
