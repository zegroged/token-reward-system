import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0a0a0f",
};

export const metadata: Metadata = {
  title: {
    default: "1923",
    template: "%s | 1923",
  },
  description: "Instagram Reels performansına dayalı otomatik token ödül ve USDT çekim platformu. 40+ çalışan için gerçek zamanlı analiz.",
  keywords: ["token", "ödül", "instagram", "reels", "performans", "USDT", "çekim"],
  robots: { index: false, follow: false }, // İç sistem — arama motorlarına kapalı
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: "1923",
    description: "Performansını izle, token kazan, anında çek.",
    type: "website",
    locale: "tr_TR",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
