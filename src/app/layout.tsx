import type { Metadata } from "next";
import { getBrand } from "@/server/brand";
import { BrandProvider } from "@/components/auth/brand-provider";
import { runtimeBasePath } from "@/lib/paths";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const brand = getBrand();
  return {
  title: { default: brand.nickname, template: `%s · ${brand.nickname}` },
  description: brand.nickname,
  robots: { index: false, follow: false },
  icons: brand.icon ? { icon: brand.icon, apple: brand.icon } : undefined,
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const basePath = runtimeBasePath();
  return <html lang="zh-CN">
    <head>
      <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css" />
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.2.8/latin-400.css" />
    </head>
    <body><BrandProvider brand={getBrand()} basePath={basePath}><a href="#main-content" className="skip-link">跳到主要内容</a>{children}</BrandProvider></body>
  </html>;
}
