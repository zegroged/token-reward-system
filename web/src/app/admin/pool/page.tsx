'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

interface PoolEntry {
  id: string; action: string; amount: number; runningBalance: number;
  description: string; adminName: string; createdAt: string;
}

export default function AdminPoolPage() {
  const router = useRouter();
  const [depositAmount, setDepositAmount] = useState('');
  const [depositDesc, setDepositDesc] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const [balance, setBalance] = useState(0);
  const [totalDeposit, setTotalDeposit] = useState(0);
  const [totalDistribution, setTotalDistribution] = useState(0);
  const [totalWithdrawal, setTotalWithdrawal] = useState(0);
  const [history, setHistory] = useState<PoolEntry[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (u.role !== 'admin' && u.role !== 'super_admin') { router.push('/dashboard'); }
    loadPool();
  }, [router]);

  async function loadPool() {
    setLoading(true);
    try {
      const data = await apiFetch('/api/admin/pool');
      setBalance(data.currentBalance);
      setTotalDeposit(Number(data.totalDeposit) || 0);
      setTotalDistribution(Number(data.totalDistribution) || 0);
      setTotalWithdrawal(Number(data.totalWithdrawal) || 0);
      setHistory((data.history || []).map((h: any) => ({
        id: h.id,
        action: h.action,
        amount: Number(h.amount),
        runningBalance: Number(h.runningBalance),
        description: h.description || '',
        adminName: h.admin?.fullName || 'Sistem',
        createdAt: h.createdAt,
      })));
    } catch { }
    setLoading(false);
  }

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) return;

    try {
      await apiFetch('/api/admin/pool', {
        method: 'POST',
        body: JSON.stringify({ amount, description: depositDesc || 'Manuel yatırım' }),
      });
      setMsg(`✅ ${amount.toLocaleString()} ₺ havuza eklendi`);
      setDepositAmount('');
      setDepositDesc('');
      loadPool();
      setTimeout(() => setMsg(''), 4000);
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    }
  }

  const actionLabels: Record<string, { icon: string; color: string; label: string }> = {
    deposit: { icon: '💰', color: 'var(--accent-green)', label: 'Yatırım' },
    distribution: { icon: '📊', color: 'var(--accent-blue)', label: 'Dağıtım' },
    withdrawal_out: { icon: '💸', color: 'var(--accent-red)', label: 'Çekim' },
  };

  const totalAmount = totalDeposit + totalDistribution + totalWithdrawal;
  const fillPercent = totalAmount > 0 ? Math.round((balance / totalDeposit) * 100) : 0;
  const dailyAvgDistribution = totalDistribution > 0 ? Math.round(totalDistribution / 30) : 0;
  const estimatedDays = dailyAvgDistribution > 0 ? Math.round(balance / dailyAvgDistribution) : 0;

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
          <h1 className="text-2xl font-bold"><span className="gradient-text">Havuz</span> Yönetimi</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Token havuzu bakiyesi ve işlemleri</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.1s' }}>
            <span className="text-xl">🏦</span>
            <div className="stat-value gradient-text mt-2">{loading ? '...' : balance.toLocaleString()}</div>
            <div className="stat-label">Mevcut Bakiye (₺)</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.15s' }}>
            <span className="text-xl">💰</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-green)' }}>{loading ? '...' : totalDeposit.toLocaleString()}</div>
            <div className="stat-label">Toplam Yatırım</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            <span className="text-xl">📊</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-blue)' }}>{loading ? '...' : totalDistribution.toLocaleString()}</div>
            <div className="stat-label">Toplam Dağıtım</div>
          </div>
          <div className="stat-card animate-fadeIn" style={{ animationDelay: '0.25s' }}>
            <span className="text-xl">💸</span>
            <div className="stat-value mt-2" style={{ color: 'var(--accent-red)' }}>{loading ? '...' : totalWithdrawal.toLocaleString()}</div>
            <div className="stat-label">Toplam Çekim</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {/* Deposit Form */}
          <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.3s' }}>
            <h3 className="font-semibold mb-4 flex items-center gap-2"><span>💰</span> Havuza Para Ekle</h3>
            <form onSubmit={handleDeposit} className="space-y-3">
              <div>
                <label className="input-label">Miktar (₺)</label>
                <input type="number" className="input-field" placeholder="5000"
                  value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} required min="1" />
              </div>
              <div>
                <label className="input-label">Açıklama</label>
                <input type="text" className="input-field" placeholder="Müşteri ödemesi"
                  value={depositDesc} onChange={(e) => setDepositDesc(e.target.value)} />
              </div>
              {msg && <p className="text-sm" style={{ color: msg.startsWith('✅') ? 'var(--accent-green)' : 'var(--accent-red)' }}>{msg}</p>}
              <button type="submit" className="btn-primary w-full">🏦 Havuza Ekle</button>
            </form>
          </div>

          {/* Balance Gauge */}
          <div className="glass-card p-6 md:col-span-2 animate-fadeIn" style={{ animationDelay: '0.35s' }}>
            <h3 className="font-semibold mb-4 flex items-center gap-2"><span>📈</span> Bakiye Durumu</h3>
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: 'var(--text-secondary)' }}>Doluluk</span>
                <span className="font-semibold">%{fillPercent}</span>
              </div>
              <div className="w-full h-4 rounded-full" style={{ background: 'var(--bg-secondary)' }}>
                <div className="h-full rounded-full transition-all" style={{
                  width: `${Math.min(fillPercent, 100)}%`,
                  background: fillPercent > 30 ? 'linear-gradient(90deg, var(--accent-primary), var(--accent-green))' : 'var(--accent-red)',
                }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Alarm Seviyesi</p>
                <p className="font-bold text-sm" style={{ color: 'var(--accent-yellow)' }}>%20 altı</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mevcut Oran</p>
                <p className="font-bold text-sm" style={{ color: fillPercent > 30 ? 'var(--accent-green)' : 'var(--accent-red)' }}>%{fillPercent} {fillPercent > 20 ? '✓' : '⚠️'}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tahmini Süre</p>
                <p className="font-bold text-sm" style={{ color: 'var(--accent-blue)' }}>~{estimatedDays} gün</p>
              </div>
            </div>
          </div>
        </div>

        {/* History */}
        <div className="glass-card overflow-hidden animate-fadeIn" style={{ animationDelay: '0.4s' }}>
          <div className="p-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="font-semibold flex items-center gap-2"><span>📋</span> İşlem Geçmişi</h3>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Tarih</th><th>İşlem</th><th>Miktar</th><th>Bakiye</th><th>Açıklama</th><th>Yapan</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
              ) : history.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Henüz işlem yok</td></tr>
              ) : history.map((h) => {
                const a = actionLabels[h.action] || { icon: '📌', color: 'var(--text-secondary)', label: h.action };
                return (
                  <tr key={h.id}>
                    <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{timeAgo(h.createdAt)}</td>
                    <td><span className="flex items-center gap-2">{a.icon} <span style={{ color: a.color, fontWeight: 600 }}>{a.label}</span></span></td>
                    <td className="font-semibold" style={{ color: h.action === 'deposit' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {h.action === 'deposit' ? '+' : '-'}{h.amount.toLocaleString()} ₺
                    </td>
                    <td className="font-medium">{h.runningBalance.toLocaleString()} ₺</td>
                    <td className="text-sm">{h.description}</td>
                    <td className="text-sm" style={{ color: 'var(--text-secondary)' }}>{h.adminName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
