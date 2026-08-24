'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

export default function WithdrawPage() {
  const router = useRouter();
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [rate, setRate] = useState(0.0305);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }

    // Bakiye ve cüzdan bilgisini çek
    apiFetch('/api/dashboard').then(data => {
      setBalance(data.balance.available);
    }).catch(() => {});

    apiFetch('/api/profile').then(data => {
      if (data.walletAddress) setWalletAddress(data.walletAddress);
    }).catch(() => {});
  }, [router]);

  const usdtAmount = (Number(amount) * rate).toFixed(2);
  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || '{}') : {};

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');

    const amt = Number(amount);
    if (amt < 100) { setError('Minimum çekim 100 TOKEN'); return; }
    if (amt > balance) { setError('Yetersiz bakiye'); return; }
    if (!walletAddress || !walletAddress.startsWith('T') || walletAddress.length !== 34) {
      setError('Geçerli bir TRC20 cüzdan adresi girin'); return;
    }

    setLoading(true);
    try {
      await apiFetch('/api/withdrawals', {
        method: 'POST',
        body: JSON.stringify({ amountToken: amt, walletAddress }),
      });
      setSuccess(`${amt} TOKEN çekim talebi oluşturuldu. Onay bekleniyor.`);
      setAmount('');
      setBalance(prev => prev - amt);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <aside className="sidebar">
        <div className="mb-8"><div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden"><img src="/logo.jpg" alt="1923" className="w-10 h-10 object-cover" /></div>
          <div><h2 className="font-bold text-sm">1923</h2></div>
        </div></div>
        <nav className="space-y-1">
          <Link href="/dashboard" className="sidebar-link"><span>📊</span> Ana Panel</Link>
          <Link href="/dashboard/transactions" className="sidebar-link"><span>📋</span> İşlem Geçmişi</Link>
          <Link href="/dashboard/withdraw" className="sidebar-link active"><span>💸</span> Çekim Yap</Link>
          <Link href="/dashboard/profile" className="sidebar-link"><span>👤</span> Profil</Link>
        </nav>
      </aside>

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn">
          <h1 className="text-2xl font-bold"><span className="gradient-text">Çekim</span> Yap</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>TOKEN bakiyenizi USDT olarak çekin</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card p-6 animate-fadeIn">
            <form onSubmit={handleWithdraw} className="space-y-4">
              <div>
                <label className="input-label">Kullanılabilir Bakiye</label>
                <div className="stat-value gradient-text text-lg">{balance.toLocaleString()} TOKEN</div>
              </div>

              <div>
                <label className="input-label">Çekim Miktarı (TOKEN)</label>
                <input type="number" className="input-field" placeholder="Minimum 100"
                  value={amount} onChange={e => setAmount(e.target.value)} min={100} max={balance} required />
              </div>

              <div>
                <label className="input-label">TRC20 Cüzdan Adresi</label>
                <input type="text" className="input-field" placeholder="T ile başlayan 34 karakter"
                  value={walletAddress} onChange={e => setWalletAddress(e.target.value)} required />
              </div>

              {amount && Number(amount) > 0 && (
                <div className="p-4 rounded-lg" style={{ background: 'rgba(0,210,160,0.1)', border: '1px solid rgba(0,210,160,0.3)' }}>
                  <p className="text-sm">Alacağınız: <span className="font-bold" style={{ color: 'var(--accent-green)' }}>~{usdtAmount} USDT</span></p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Kur: 1 TOKEN = {rate} USDT</p>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-lg" style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)' }}>
                  <p className="text-sm" style={{ color: 'var(--accent-red)' }}>⚠️ {error}</p>
                </div>
              )}
              {success && (
                <div className="p-3 rounded-lg" style={{ background: 'rgba(0,210,160,0.1)', border: '1px solid rgba(0,210,160,0.3)' }}>
                  <p className="text-sm" style={{ color: 'var(--accent-green)' }}>✅ {success}</p>
                </div>
              )}

              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'İşleniyor...' : '💸 Çekim Talebi Oluştur'}
              </button>
            </form>
          </div>

          <div className="space-y-4 animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            <div className="glass-card p-6">
              <h3 className="font-semibold mb-3">📋 Çekim Kuralları</h3>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li>• Minimum çekim: <strong>100 TOKEN</strong></li>
                <li>• Günlük limit: <strong>5.000 TOKEN</strong></li>
                <li>• İşlem süresi: <strong>1-24 saat</strong></li>
                <li>• Ağ: <strong>TRON (TRC20)</strong></li>
                <li>• Admin onayı gereklidir</li>
              </ul>
            </div>
            <div className="glass-card p-6">
              <h3 className="font-semibold mb-3">⚠️ Dikkat</h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Cüzdan adresinizi doğru girdiğinizden emin olun. Yanlış adrese gönderilen tokenler geri alınamaz.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
