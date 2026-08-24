'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ADMIN_NAV = [
  { href: '/admin', icon: '📊', label: 'Genel Bakış' },
  { href: '/admin/users', icon: '👥', label: 'Kullanıcılar' },
  { href: '/admin/pool', icon: '🏦', label: 'Havuz' },
  { href: '/admin/withdrawals', icon: '💸', label: 'Çekimler' },
  { href: '/admin/reels', icon: '📱', label: 'Instagram' },
  { href: '/admin/tiktok', icon: '🎵', label: 'TikTok' },
  { href: '/admin/ml', icon: '🤖', label: 'ML Etiketleme' },
  { href: '/admin/audit', icon: '📜', label: 'Denetim Kaydı' },
  { href: '/admin/settings', icon: '⚙️', label: 'Ayarlar' },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #ff6b6b, #ee5a24)' }}>
            <span className="text-lg">🛡️</span>
          </div>
          <div><h2 className="font-bold text-sm">Yönetim Paneli</h2></div>
        </div>
      </div>
      <nav className="space-y-1">
        {ADMIN_NAV.map(item => (
          <Link key={item.href} href={item.href}
            className={`sidebar-link ${pathname === item.href ? 'active' : ''}`}>
            <span>{item.icon}</span> {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
