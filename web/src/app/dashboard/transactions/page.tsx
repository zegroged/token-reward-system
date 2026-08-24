'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface Transaction {
  id: string; type: string; amount: number; description: string;
  referenceType: string; createdAt: string;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    loadTransactions();
  }, [router, page, typeFilter]);

  async function loadTransactions() {
    setLoading(true);
    try {
      let url = `/api/transactions?page=${page}&limit=20`;
      if (typeFilter) url += `&type=${typeFilter}`;
      const data = await apiFetch(url);
      setTransactions(data.transactions);
      setTotalPages(data.pagination.totalPages);
    } catch { }
    setLoading(false);
  }

  const typeLabels: Record<string, { label: string; icon: string; color: string }> = {
    earning: { label: 'Kazanç', icon: '📈', color: 'var(--accent-green)' },
    withdrawal: { label: 'Çekim', icon: '💸', color: 'var(--accent-red)' },
    bonus: { label: 'Bonus', icon: '🎁', color: 'var(--accent-yellow)' },
    adjustment: { label: 'Düzeltme', icon: '⚙️', color: 'var(--accent-blue)' },
  };

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return `${Math.floor(diff / 60000)} dk önce`;
    if (h < 24) return `${h} saat önce`;
    return `${Math.floor(h / 24)} gün önce`;
  }

  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || '{}') : {};

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <aside className="sidebar">
        <div className="mb-8"><div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden"><img src="/logo.jpg" alt="1923" className="w-10 h-10 object-cover" /></div>
          <div><h2 className="font-bold text-sm">1923</h2></div>
        </div></div>
        <nav className="space-y-1">
          <Link href="/dashboard" className="sidebar-link"><span>📊</span> Ana Panel</Link>
          <Link href="/dashboard/transactions" className="sidebar-link active"><span>📋</span> İşlem Geçmişi</Link>
          <Link href="/dashboard/withdraw" className="sidebar-link"><span>💸</span> Çekim Yap</Link>
          <Link href="/dashboard/profile" className="sidebar-link"><span>👤</span> Profil</Link>
        </nav>
      </aside>

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn">
          <h1 className="text-2xl font-bold"><span className="gradient-text">İşlem</span> Geçmişi</h1>
        </div>

        <div className="flex gap-2 mb-4">
          {['', 'earning', 'withdrawal', 'bonus'].map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setPage(1); }}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: typeFilter === t ? 'var(--accent-primary)' : 'var(--bg-card)', color: typeFilter === t ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              {t === '' ? 'Tümü' : typeLabels[t]?.label || t}
            </button>
          ))}
        </div>

        <div className="glass-card overflow-hidden animate-fadeIn">
          <table className="data-table">
            <thead><tr><th>Tür</th><th>Açıklama</th><th>Miktar</th><th>Tarih</th></tr></thead>
            <tbody>
              {loading ? (<tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>) :
              transactions.length === 0 ? (<tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Henüz işlem yok</td></tr>) :
              transactions.map(tx => {
                const info = typeLabels[tx.type] || { label: tx.type, icon: '📄', color: 'var(--text-secondary)' };
                return (
                  <tr key={tx.id}>
                    <td><span className="badge badge-blue">{info.icon} {info.label}</span></td>
                    <td className="text-sm">{tx.description || '-'}</td>
                    <td className="font-bold" style={{ color: tx.amount > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()} TOKEN
                    </td>
                    <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{timeAgo(tx.createdAt)}</td>
                  </tr>
                );
              })}
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
