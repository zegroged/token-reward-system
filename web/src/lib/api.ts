/**
 * API çağrıları için ortak yardımcı
 * JWT token yönetimi + otomatik refresh + hata yakalama
 */

export async function apiFetch(url: string, options: RequestInit = {}): Promise<any> {
  const token = localStorage.getItem('accessToken');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(url, { ...options, headers });

  // Token expired — refresh dene
  if (res.status === 401) {
    const hasRefreshToken = !!localStorage.getItem('refreshToken');
    if (hasRefreshToken) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${localStorage.getItem('accessToken')}`;
        res = await fetch(url, { ...options, headers });
      } else {
        // Refresh de başarısız — login'e yönlendir
        localStorage.clear();
        window.location.href = '/login';
        throw new Error('Oturum sona erdi');
      }
    } else {
      // Dev mode / DB yok — sessizce başarısız ol
      throw new Error('API kullanılamıyor');
    }
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `API hatası: ${res.status}`);
  }

  return data;
}

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return false;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) return false;

    const data = await res.json();
    localStorage.setItem('accessToken', data.accessToken);
    return true;
  } catch {
    return false;
  }
}
