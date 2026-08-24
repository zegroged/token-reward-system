'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

interface Withdrawal {
  id: string; userName: string; email: string; amountToken: number;
  amountUsdt: number; walletAddress: string; status: string; txHash?: string;
  createdAt: string;
}

export default function AdminWithdrawalsPage() {
  const router = useRouter();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [txHash, setTxHash] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ pending: 0, pendingAmount: 0, completed: 0, rejected: 0 });

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (u.role !== 'admin' && u.role !== 'super_admin') { router.push('/dashboard'); return; }
    loadWithdrawals();
  }, [router, statusFilter]);

  async function loadWithdrawals() {
    setLoading(true);
    try {
      const url = statusFilter === 'all' ? '/api/admin/withdrawals' : `/api/admin/withdrawals?status=${statusFilter}`;
      const data = await apiFetch(url);
      setWithdrawals(data.withdrawals);
      setStats(data.stats);
    } catch { }
    setLoading(false);
  }

  async function approveWithdrawal(id: string) { setSelectedId(id); }

  async function confirmApproval() {
    if (!selectedId || !txHash) return;
    try {
      await apiFetch(`/api/admin/withdrawals/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve', txHash }),
      });
      setSelectedId(null); setTxHash('');
      loadWithdrawals();
    } catch (e: any) { alert(e.message); }
  }

  async function rejectWithdrawal(id: string) {
    if (!confirm('Çekim talebini reddetmek istediğinize emin misiniz?')) return;
    try {
      await apiFetch(`/api/admin/withdrawals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject', reason: 'Admin tarafından reddedildi' }),
      });
      loadWithdrawals();
    } catch (e: any) { alert(e.message); }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { class: string; label: string }> = {
      pending: { class: 'badge-yellow', label: '⏳ Bekliyor' },
      completed: { class: 'badge-green', label: '✅ Tamamlandı' },
      rejected: { class: 'badge-red', label: '❌ Reddedildi' },
      processing: { class: 'badge-blue', label: '⚙️ İşleniyor' },
    };
    const s = map[status] || { class: 'badge-blue', label: status };
    return <span className={`badge ${s.class}`}>{s.label}</span>;
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
          <h1 className="text-2xl font-bold"><span className="gradient-text">Çekim</span> Talepleri</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            {stats.pending} bekleyen • Toplam {stats.pendingAmount.toLocaleString()} TOKEN
          </p>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>{stats.pending}</div><div className="stat-label">Bekleyen</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value gradient-text">{stats.pendingAmount.toLocaleString()}</div><div className="stat-label">Toplam TOKEN</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-green)' }}>{stats.completed}</div><div className="stat-label">Tamamlanan</div></div>
          <div className="stat-card animate-fadeIn"><div className="stat-value" style={{ color: 'var(--accent-red)' }}>{stats.rejected}</div><div className="stat-label">Reddedilen</div></div>
        </div>

        <div className="flex gap-2 mb-4">
          {['all', 'pending', 'completed', 'rejected'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: statusFilter === s ? 'var(--accent-primary)' : 'var(--bg-card)',
                color: statusFilter === s ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${statusFilter === s ? 'var(--accent-primary)' : 'var(--border)'}`,
              }}>
              {s === 'all' ? 'Tümü' : s === 'pending' ? 'Bekleyen' : s === 'completed' ? 'Tamamlanan' : 'Reddedilen'}
            </button>
          ))}
        </div>

        {selectedId && (
          <div className="glass-card p-6 mb-4 animate-fadeIn" style={{ border: '1px solid var(--accent-primary)' }}>
            <h3 className="font-semibold mb-3">✅ Çekim Onayla — TX Hash Girin</h3>
            <div className="flex gap-3">
              <input type="text" className="input-field flex-1" placeholder="TRON TX Hash"
                value={txHash} onChange={(e) => setTxHash(e.target.value)} />
              <button onClick={confirmApproval} className="btn-primary">Onayla</button>
              <button onClick={() => setSelectedId(null)} className="btn-secondary">İptal</button>
            </div>
          </div>
        )}

        <div className="glass-card overflow-hidden animate-fadeIn">
          <table className="data-table">
            <thead><tr><th>Kullanıcı</th><th>Miktar</th><th>USDT</th><th>Cüzdan</th><th>Durum</th><th>Tarih</th><th>İşlem</th></tr></thead>
            <tbody>
              {loading ? (<tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>) :
              withdrawals.length === 0 ? (<tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Çekim talebi yok</td></tr>) :
              withdrawals.map(w => (
                <tr key={w.id}>
                  <td><p className="font-medium text-sm">{w.userName}</p><p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{w.email}</p></td>
                  <td className="font-semibold">{w.amountToken.toLocaleString()} ₺</td>
                  <td style={{ color: 'var(--accent-green)' }}>~{w.amountUsdt} USDT</td>
                  <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{w.walletAddress}</td>
                  <td>{statusBadge(w.status)}</td>
                  <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{timeAgo(w.createdAt)}</td>
                  <td>
                    {w.status === 'pending' && (
                      <div className="flex gap-2">
                        <button onClick={() => approveWithdrawal(w.id)} className="px-3 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: 'var(--accent-green-glow)', color: 'var(--accent-green)' }}>✓ Onayla</button>
                        <button onClick={() => rejectWithdrawal(w.id)} className="px-3 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: 'rgba(255,107,107,0.15)', color: 'var(--accent-red)' }}>✕ Ret</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
