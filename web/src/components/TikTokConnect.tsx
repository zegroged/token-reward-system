"use client";

import { useState } from "react";

interface TikTokConnectProps {
  isConnected: boolean;
  tiktokHandle?: string;
}

export default function TikTokConnect({
  isConnected,
  tiktokHandle,
}: TikTokConnectProps) {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    // CSRF token gen, API call to get auth url, redirect
    try {
      const res = await fetch("/api/tiktok/auth-url");
      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      } else {
        alert("Bağlantı URL'si alınamadı.");
      }
    } catch (error) {
      console.error(error);
      alert("Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("TikTok bağlantınızı kesmek istediğinize emin misiniz?")) return;
    
    setLoading(true);
    try {
      const res = await fetch("/api/tiktok/disconnect", { method: "POST" });
      if (res.ok) {
        window.location.reload();
      } else {
        alert("Bağlantı kesilemedi.");
      }
    } catch (error) {
      console.error(error);
      alert("Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1.04-.1z" />
            </svg>
            TikTok Bağlantısı
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            Reels izlenmelerinizden token kazanmak için TikTok hesabınızı bağlayın.
          </p>
        </div>

        <div>
          {isConnected ? (
            <div className="flex flex-col items-end gap-2">
              <span className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                Bağlı: @{tiktokHandle}
              </span>
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {loading ? "İşleniyor..." : "Bağlantıyı Kes"}
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnect}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {loading ? "Yönlendiriliyor..." : "TikTok'u Bağla"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
