'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

export default function AdminSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [settings, setSettings] = useState({
    tokenPerView: 0.03,
    minWithdrawal: 100,
    maxDailyWithdrawal: 5000,
    tokenToUsdt: 0.0305,
    botRunHour: 4,
    botRunMinute: 0,
    maintenanceMode: false,
    registrationOpen: true,
    maxSessionsPerUser: 3,
    autoApproveWithdrawals: false,
  });

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (u.role !== 'admin' && u.role !== 'super_admin') { router.push('/dashboard'); return; }

    apiFetch('/api/admin/settings')
      .then(data => setSettings(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  function updateSetting(key: string, value: any) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function saveSettings() {
    setSaving(true); setMsg('');
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
      setMsg('✅ Ayarlar kaydedildi');
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    }
    setSaving(false);
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <AdminSidebar />

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn">
          <h1 className="text-2xl font-bold"><span className="gradient-text">Sistem</span> Ayarları</h1>
        </div>

        {loading ? <p style={{ color: 'var(--text-muted)' }}>Yükleniyor...</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Token Ayarları */}
            <div className="glass-card p-6 animate-fadeIn">
              <h3 className="font-semibold mb-4">💰 Token Ayarları</h3>
              <div className="space-y-4">
                <div>
                  <label className="input-label">Görüntüleme Başına Token</label>
                  <input type="number" step="0.001" className="input-field"
                    value={settings.tokenPerView} onChange={e => updateSetting('tokenPerView', Number(e.target.value))} />
                </div>
                <div>
                  <label className="input-label">TOKEN → USDT Kuru</label>
                  <input type="number" step="0.0001" className="input-field"
                    value={settings.tokenToUsdt} onChange={e => updateSetting('tokenToUsdt', Number(e.target.value))} />
                </div>
              </div>
            </div>

            {/* Çekim Ayarları */}
            <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.1s' }}>
              <h3 className="font-semibold mb-4">💸 Çekim Ayarları</h3>
              <div className="space-y-4">
                <div>
                  <label className="input-label">Minimum Çekim (TOKEN)</label>
                  <input type="number" className="input-field"
                    value={settings.minWithdrawal} onChange={e => updateSetting('minWithdrawal', Number(e.target.value))} />
                </div>
                <div>
                  <label className="input-label">Günlük Maksimum (TOKEN)</label>
                  <input type="number" className="input-field"
                    value={settings.maxDailyWithdrawal} onChange={e => updateSetting('maxDailyWithdrawal', Number(e.target.value))} />
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="checkbox-custom"
                    checked={settings.autoApproveWithdrawals} onChange={e => updateSetting('autoApproveWithdrawals', e.target.checked)} />
                  <span className="text-sm">Otomatik çekim onayı</span>
                </label>
              </div>
            </div>

            {/* Bot Ayarları */}
            <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.2s' }}>
              <h3 className="font-semibold mb-4">🤖 Bot Zamanlama</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="input-label">Saat</label>
                    <input type="number" min={0} max={23} className="input-field"
                      value={settings.botRunHour} onChange={e => updateSetting('botRunHour', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="input-label">Dakika</label>
                    <input type="number" min={0} max={59} className="input-field"
                      value={settings.botRunMinute} onChange={e => updateSetting('botRunMinute', Number(e.target.value))} />
                  </div>
                </div>
              </div>
            </div>

            {/* Sistem Durumu */}
            <div className="glass-card p-6 animate-fadeIn" style={{ animationDelay: '0.3s' }}>
              <h3 className="font-semibold mb-4">⚙️ Sistem Durumu</h3>
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="checkbox-custom"
                    checked={settings.maintenanceMode} onChange={e => updateSetting('maintenanceMode', e.target.checked)} />
                  <span className="text-sm">Bakım Modu (site kapalı)</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="checkbox-custom"
                    checked={settings.registrationOpen} onChange={e => updateSetting('registrationOpen', e.target.checked)} />
                  <span className="text-sm">Kayıt açık</span>
                </label>
                <div>
                  <label className="input-label">Maks. Oturum / Kullanıcı</label>
                  <input type="number" min={1} max={10} className="input-field"
                    value={settings.maxSessionsPerUser} onChange={e => updateSetting('maxSessionsPerUser', Number(e.target.value))} />
                </div>
              </div>
            </div>
          </div>
        )}

        {msg && <p className="mt-4 text-sm">{msg}</p>}

        <div className="mt-6">
          <button onClick={saveSettings} className="btn-primary px-8" disabled={saving}>
            {saving ? 'Kaydediliyor...' : '💾 Ayarları Kaydet'}
          </button>
        </div>
      </main>
    </div>
  );
}
