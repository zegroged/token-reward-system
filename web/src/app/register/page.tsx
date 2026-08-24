'use client';

import Link from 'next/link';

/**
 * Herkese açık kayıt kapatıldı.
 * Çalışan kaydı artık sadece Kayıt Merkezi üzerinden yapılmaktadır.
 */
export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div style={{ position: 'fixed', top: '10%', left: '20%', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(108,92,231,0.15), transparent)', filter: 'blur(80px)', pointerEvents: 'none' }} />

      <div className="w-full max-w-md px-4 animate-fadeIn">
        <div className="glass-card p-8 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-2">
            <span className="gradient-text">Kayıt Kapatıldı</span>
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            Sisteme kayıt olabilmek için önce <strong>yöneticinizle görüntülü görüşme</strong> yapmanız 
            gerekmektedir. Onay sonrası Kayıt Merkezi çalışanı hesabınızı oluşturup size 
            giriş bilgilerinizi iletecektir.
          </p>

          <div className="p-4 rounded-lg mb-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <h3 className="font-semibold text-sm mb-2">📋 Kayıt Süreci</h3>
            <ol className="text-left text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <li className="flex gap-2"><span>1️⃣</span> Yöneticiyle görüntülü görüşme yapın</li>
              <li className="flex gap-2"><span>2️⃣</span> Onay aldıktan sonra Kayıt Merkezi sizi kaydeder</li>
              <li className="flex gap-2"><span>3️⃣</span> E-posta ve telefonunuz doğrulanır</li>
              <li className="flex gap-2"><span>4️⃣</span> Giriş bilgileriniz size iletilir</li>
              <li className="flex gap-2"><span>5️⃣</span> İlk girişte şifrenizi değiştirirsiniz</li>
            </ol>
          </div>

          <Link href="/login" className="btn-primary w-full text-center block">
            🔑 Zaten Hesabınız Var mı? Giriş Yapın
          </Link>
        </div>
      </div>
    </div>
  );
}
