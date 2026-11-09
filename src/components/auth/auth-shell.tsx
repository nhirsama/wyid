"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useBrand } from "./brand-provider";

export function AuthShell({ children }: { children: ReactNode }) {
  const brand = useBrand();
  return (
    <main className="auth-page" id="main-content">
      <div className="auth-container">
        <div className="auth-brand">
          {brand.icon && <Image src={brand.icon} alt="" width={36} height={40} priority unoptimized />}
          <span>{brand.nickname}</span>
        </div>
        {children}
        <footer className="auth-footer">
          <span>{brand.nickname}</span><span aria-hidden="true">·</span><span>账号与单点登录</span>
        </footer>
      </div>
    </main>
  );
}

export function AuthPanel({ title, description, children, back }: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  back?: string;
}) {
  return <section className="auth-card" aria-labelledby="auth-title">
    {back && <Link href={back} className="back-link"><span aria-hidden="true">←</span> 返回登录</Link>}
    <header className="auth-heading"><h1 id="auth-title">{title}</h1><p>{description}</p></header>
    {children}
  </section>;
}
