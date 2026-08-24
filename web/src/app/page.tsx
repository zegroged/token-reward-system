'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

function Particles() {
  const [particles, setParticles] = useState<Array<{id: number; x: number; y: number; size: number; delay: number; duration: number}>>([]);
  useEffect(() => {
    setParticles(Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      delay: Math.random() * 8,
      duration: Math.random() * 10 + 10,
    })));
  }, []);
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      {particles.map(p => (
        <div key={p.id} className="particle" style={{
          left: `${p.x}%`, top: `${p.y}%`,
          width: p.size, height: p.size,
          animationDelay: `${p.delay}s`,
          animationDuration: `${p.duration}s`,
        }} />
      ))}
    </div>
  );
}

function AnimatedCounter({ end, suffix = '', duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), 500);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!started) return;
    let start = 0;
    const step = end / (duration / 16);
    const interval = setInterval(() => {
      start += step;
      if (start >= end) { setCount(end); clearInterval(interval); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(interval);
  }, [started, end, duration]);
  return <>{count.toLocaleString()}{suffix}</>;
}

export default function HomePage() {
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Particles />

      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="orb orb-1" style={{ background: 'radial-gradient(circle, rgba(56, 189, 248, 0.15), transparent 70%)' }} />
        <div className="orb orb-2" style={{ background: 'radial-gradient(circle, rgba(129, 140, 248, 0.1), transparent 70%)' }} />
        <div className="orb orb-3" style={{ background: 'radial-gradient(circle, rgba(56, 189, 248, 0.08), transparent 70%)' }} />
      </div>

      {/* ── Navbar ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 transition-all" style={{
        background: scrollY > 50 ? 'rgba(15, 17, 23, 0.85)' : 'transparent',
        backdropFilter: scrollY > 50 ? 'blur(20px) saturate(180%)' : 'none',
        borderBottom: scrollY > 50 ? '1px solid rgba(37, 40, 50, 0.5)' : '1px solid transparent',
      }}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden">
              <img src="/logo.jpg" alt="1923" className="w-9 h-9 object-cover" />
            </div>
            <span className="font-bold text-sm" style={{ color: 'var(--text-bright)' }}>1923</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="px-5 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-bright)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}>
              Giriş Yap
            </Link>
            <Link href="/kayit" className="btn-primary text-sm" style={{ padding: '8px 20px' }}>
              Kayıt Ol
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ── */}
      <section className="relative z-10 min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-4xl mx-auto">
          {/* Floating badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 animate-fadeIn"
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              animationDelay: '0.2s', animationFillMode: 'both',
            }}>
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-primary)', animation: 'pulse-dot 2s infinite' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>Sistem Aktif • 7/24 Çalışıyor</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold mb-6 animate-fadeIn leading-tight"
            style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>
            <span style={{ color: 'var(--text-bright)' }}>Performansın </span>
            <span className="gradient-text">Ödüllendirilir</span>
          </h1>

          <p className="text-lg md:text-xl max-w-2xl mx-auto mb-10 animate-fadeIn"
            style={{ color: 'var(--text-secondary)', animationDelay: '0.6s', animationFillMode: 'both', lineHeight: '1.7' }}>
            Instagram Reels performansını yapay zeka ile analiz ediyor,<br className="hidden md:block" />
            hak ettiğin tokenleri otomatik olarak cüzdanına gönderiyoruz.
          </p>

          {/* CTA */}
          <div className="flex gap-4 justify-center animate-fadeIn" style={{ animationDelay: '0.8s', animationFillMode: 'both' }}>
            <Link href="/kayit" className="hero-btn-primary">
              <span>Kayıt Ol</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <Link href="/login" className="px-8 py-3.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                e.currentTarget.style.color = 'var(--text-bright)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}>
              Giriş Yap
            </Link>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-6 mt-20 max-w-2xl mx-auto animate-fadeIn"
            style={{ animationDelay: '1s', animationFillMode: 'both' }}>
            <div className="hero-stat">
              <div className="hero-stat-value gradient-text"><AnimatedCounter end={40} suffix="+" /></div>
              <div className="hero-stat-label">Aktif Kullanıcı</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value" style={{ color: 'var(--green)' }}>₺<AnimatedCounter end={1} suffix="M+" /></div>
              <div className="hero-stat-label">Dağıtılan Ödül</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value" style={{ color: 'var(--accent-secondary)' }}><AnimatedCounter end={99} suffix="%" /></div>
              <div className="hero-stat-label">Uptime</div>
            </div>
          </div>
        </div>


      </section>

      {/* ── How It Works ── */}
      <section className="relative z-10 py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--text-bright)' }}>
              Nasıl <span className="gradient-text">Çalışır</span>?
            </h2>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto' }}>
              3 basit adımda token kazanmaya başla
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', icon: '📱', title: 'Instagram Bağla', desc: 'Hesabını bağla, Reels paylaşmaya devam et. Geri kalan her şey otomatik.', color: 'var(--accent-primary)' },
              { step: '02', icon: '🤖', title: 'AI Analiz', desc: 'Yapay zeka etkileşimlerini analiz eder, sahte görüntülemeleri filtreler.', color: 'var(--accent-secondary)' },
              { step: '03', icon: '💰', title: 'Token Kazan', desc: 'Gerçek performansına göre token kazanırsın. USDT olarak anında çek.', color: 'var(--text-bright)' },
            ].map((item, i) => (
              <div key={i} className="how-card" style={{ animationDelay: `${i * 0.15}s` }}>
                <div className="how-card-step" style={{ color: item.color }}>{item.step}</div>
                <div className="how-card-icon">{item.icon}</div>
                <h3 className="font-semibold text-lg mb-2" style={{ color: 'var(--text-bright)' }}>{item.title}</h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="relative z-10 py-24 px-6" style={{ background: 'rgba(22, 25, 32, 0.5)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--text-bright)' }}>
              Neden <span className="gradient-text-warm">Biz</span>?
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              { icon: '🔒', title: 'Askeri Düzeyde Güvenlik', desc: 'AES-256 şifreleme, JWT oturumlar, immutable denetim kayıtları', glow: 'var(--accent-primary)' },
              { icon: '⚡', title: 'Gerçek Zamanlı', desc: 'Performans anında hesaplanır, dağıtım otomatik yapılır', glow: 'var(--yellow)' },
              { icon: '🛡️', title: 'Anti-Sybil Koruma', desc: '5 katmanlı sahte hesap önleme: fingerprint, IP, telefon, e-posta', glow: 'var(--red)' },
              { icon: '📊', title: 'ML Analiz Motoru', desc: 'İstatistiksel + kural bazlı hibrit model ile sahte etkileşim tespiti', glow: 'var(--accent-secondary)' },
            ].map((f, i) => (
              <div key={i} className="feature-card" style={{ '--feature-glow': f.glow } as any}>
                <div className="feature-icon">{f.icon}</div>
                <div>
                  <h3 className="font-semibold mb-1" style={{ color: 'var(--text-bright)' }}>{f.title}</h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Section ── */}
      <section className="relative z-10 py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="cta-card">
            <h2 className="text-3xl font-bold mb-4" style={{ color: 'var(--text-bright)' }}>
              Hazır mısın?
            </h2>
            <p className="mb-8" style={{ color: 'var(--text-secondary)' }}>
              Hemen kayıt ol, performansınla token kazanmaya başla.
            </p>
            <div className="flex gap-4 justify-center">
              <Link href="/kayit" className="hero-btn-primary inline-flex">
                <span>Hemen Kayıt Ol</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </Link>
              <Link href="/login" className="px-6 py-3 rounded-xl text-sm font-medium inline-flex items-center transition-all"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Giriş Yap
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 py-8 px-6" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.jpg" alt="1923" className="w-6 h-6 rounded-md object-cover" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>1923</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>🔒 256-bit SSL ile korunmaktadır</p>
        </div>
      </footer>
    </div>
  );
}
