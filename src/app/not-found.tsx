import Image from "next/image";
import { AppLink } from "@/components/ui/app-link";
import { getBrand } from "@/server/brand";

export default function NotFound() {
  const brand = getBrand();
  return (
    <main className="auth-page not-found-page" id="main-content">
      <AppLink className="auth-brand" href="/">
        {brand.icon && <Image src={brand.icon} alt="" width={36} height={40} priority unoptimized />}
        <strong>{brand.nickname}</strong>
      </AppLink>
      <section className="not-found" aria-labelledby="not-found-title">
        <div className="not-found-illustration" aria-hidden="true">
          <svg className="not-found-orbit" viewBox="0 0 360 190" fill="none">
            <ellipse cx="180" cy="99" rx="148" ry="76" fill="#f4f7fc" />
            <path d="M30 137c-16-27 14-67 66-84s92-6 108 13c24 29 60 82 99 71 24-7 31-27 23-43" stroke="#cddbec" strokeWidth="1.5" strokeDasharray="4 6" strokeLinecap="round" />
            <circle cx="301" cy="40" r="7" fill="#fbeaf2" stroke="#ebc2d6" />
            <circle cx="44" cy="142" r="3" fill="#b8cce5" />
            <path d="M55 43v12m-6-6h12" stroke="#c3d2e7" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M309 151v8m-4-4h8" stroke="#e4b3cb" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div className="not-found-code">
            <span>4</span>
            <span className="not-found-zero">
              <svg className="not-found-needle" viewBox="0 0 44 68" fill="none">
                <path d="m22 4 12 30H10L22 4Z" fill="currentColor" />
                <path d="m22 64 12-30H10l12 30Z" fill="#cedcee" />
                <circle cx="22" cy="34" r="3" fill="white" />
              </svg>
            </span>
            <span>4</span>
          </div>
        </div>
        <p className="not-found-eyebrow">404 / PAGE NOT FOUND</p>
        <h1 id="not-found-title">好像走错地方了</h1>
        <p className="not-found-description">这个页面不存在，或已经搬到了别处。</p>
        <div className="not-found-actions">
          <AppLink className="button primary-button" href="/login">回到登录页</AppLink>
        </div>
      </section>
      <footer className="auth-footer"><span>{brand.nickname}</span><span aria-hidden="true">·</span><span>账号与单点登录</span></footer>
    </main>
  );
}
