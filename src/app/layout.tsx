import type { Metadata } from "next";
import localFont from "next/font/local";
import { getBrand } from "@/server/brand";
import { BrandProvider } from "@/components/auth/brand-provider";
import "lxgw-wenkai-webfont/lxgwwenkai-regular.css";
import "./globals.css";

export const dynamic = "force-dynamic";

const mono = localFont({
  src: "../../public/fonts/jetbrains-mono-latin.woff2",
  variable: "--font-ui-mono",
  weight: "400",
  display: "swap",
  preload: false,
});

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
  return <html lang="zh-CN" className={mono.variable}><body><BrandProvider brand={getBrand()}><a href="#main-content" className="skip-link">跳到主要内容</a>{children}</BrandProvider></body></html>;
}
