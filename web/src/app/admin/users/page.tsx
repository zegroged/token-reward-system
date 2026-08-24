'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import AdminSidebar from '@/components/AdminSidebar';

interface UserEntry {
  id: string; fullName: string; email: string; phone: string; role: string;
  isActive: boolean; instagramHandle: string | null; instagramConnectedAt: string | null;
  emailVerified: boolean; phoneVerified: boolean; createdAt: string;
  balance: { available: number; totalEarned: number; totalWithdrawn: number } | null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) { router.push('/login'); return; }
    const u = JSON.parse(stored);
    if (u.role !== 'admin' && u.role !== 'super_admin') { router.push('/dashboard'); return; }
    loadUsers();
  }, [router, page]);

  async function loadUsers() {
    setLoading(true);
    try {
      let url = `/api/admin/users?page=${page}&limit=20`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const data = await apiFetch(url);
      setUsers(data.users);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch { }
    setLoading(false);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    loadUsers();
  }

  async function toggleActive(userId: string, currentActive: boolean) {
    try {
      await apiFetch('/api/admin/users/bulk', {
        method: 'POST',
        body: JSON.stringify({
          action: currentActive ? 'deactivate' : 'activate',
          userIds: [userId],
        }),
      });
      loadUsers();
    } catch (e: any) { alert(e.message); }
  }

  async function changeRole(userId: string, newRole: string) {
    if (!confirm(`Bu kullanıcıyı "${newRole === 'registrar' ? 'Kayıt Merkezi' : newRole}" olarak atamak istediğinize emin misiniz?`)) return;
    try {
      await apiFetch('/api/admin/users/bulk', {
        method: 'POST',
        body: JSON.stringify({ action: 'change_role', userIds: [userId], newRole }),
      });
      loadUsers();
    } catch (e: any) { alert(e.message); }
  }

  const roleBadge = (role: string) => {
    const map: Record<string, { class: string; label: string }> = {
      employee: { class: 'badge-blue', label: 'Çalışan' },
      registrar: { class: 'badge-green', label: 'Kayıt Merkezi' },
      admin: { class: 'badge-yellow', label: 'Admin' },
      super_admin: { class: 'badge-red', label: 'Süper Admin' },
    };
    const r = map[role] || { class: 'badge-blue', label: role };
    return <span className={`badge ${r.class}`}>{r.label}</span>;
  };

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Bugün';
    if (days === 1) return 'Dün';
    return `${days} gün önce`;
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <AdminSidebar />

      <main style={{ marginLeft: '260px', padding: '32px' }}>
        <div className="mb-6 animate-fadeIn flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold"><span className="gradient-text">Kullanıcı</span> Yönetimi</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Toplam {total} kullanıcı</p>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input type="text" className="input-field" placeholder="İsim, e-posta veya IG ara..."
              value={search} onChange={e => setSearch(e.target.value)} style={{ width: '250px' }} />
            <button type="submit" className="btn-primary">Ara</button>
          </form>
        </div>

        <div className="glass-card overflow-hidden animate-fadeIn">
          <table className="data-table">
            <thead><tr><th>Kullanıcı</th><th>Rol</th><th>Doğrulama</th><th>Instagram</th><th>Bakiye</th><th>Durum</th><th>Kayıt</th><th>İşlem</th></tr></thead>
            <tbody>
              {loading ? (<tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>) :
              users.length === 0 ? (<tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Kullanıcı bulunamadı</td></tr>) :
              users.map(u => (
                <tr key={u.id}>
                  <td>
                    <p className="font-medium text-sm">{u.fullName}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{u.email}</p>
                    <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{u.phone}</p>
                  </td>
                  <td>{roleBadge(u.role)}</td>
                  <td>
                    <span className={`badge ${u.emailVerified ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '10px' }}>
                      📧 {u.emailVerified ? '✓' : '✕'}
                    </span>
                    <span className={`badge ${u.phoneVerified ? 'badge-green' : 'badge-red'} ml-1`} style={{ fontSize: '10px' }}>
                      📱 {u.phoneVerified ? '✓' : '✕'}
                    </span>
                  </td>
                  <td>
                    {u.instagramHandle ? (
                      <span className="badge badge-green">@{u.instagramHandle}</span>
                    ) : (
                      <span className="badge badge-yellow">Bağlı değil</span>
                    )}
                  </td>
                  <td className="font-semibold text-sm">{u.balance ? u.balance.available.toLocaleString() : '0'}</td>
                  <td>
                    <span className={`badge ${u.isActive ? 'badge-green' : 'badge-red'}`}>
                      {u.isActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{timeAgo(u.createdAt)}</td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => toggleActive(u.id, u.isActive)}
                        className="px-2 py-1 rounded-lg text-xs font-semibold"
                        style={{
                          background: u.isActive ? 'rgba(255,107,107,0.15)' : 'var(--accent-green-glow)',
                          color: u.isActive ? 'var(--accent-red)' : 'var(--accent-green)',
                        }}>
                        {u.isActive ? 'Pasif' : 'Aktif'}
                      </button>
                      {u.role === 'employee' && (
                        <button onClick={() => changeRole(u.id, 'registrar')}
                          className="px-2 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: 'rgba(0,210,160,0.15)', color: 'var(--accent-green)' }}>
                          📝 Kayıt M.
                        </button>
                      )}
                      {u.role === 'registrar' && (
                        <button onClick={() => changeRole(u.id, 'employee')}
                          className="px-2 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: 'rgba(108,92,231,0.15)', color: 'var(--accent-primary)' }}>
                          Çalışan Yap
                        </button>
                      )}
                    </div>
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
