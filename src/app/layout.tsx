import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import "./globals.css";

const studioSans = Noto_Sans_SC({
  variable: "--font-studio-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const studioSerif = Noto_Serif_SC({
  variable: "--font-studio-serif",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const studioMono = IBM_Plex_Mono({
  variable: "--font-studio-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "屿录 · 高画质提词录制器",
  description:
    "在浏览器本地完成屏幕、摄像头、麦克风与自适应提词器的高画质合成录制。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${studioSans.variable} ${studioSerif.variable} ${studioMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
