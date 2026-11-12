"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BookOpen, Browser, CaretRight, Gear, List, SignOut } from "@phosphor-icons/react";
import { useBrand } from "@/components/auth/brand-provider";
import { api, clearApiCache, post } from "@/lib/account/api";
import type { Account, PublicConfig } from "@/lib/account/types";
import { AccountLink as Link, useAccountRouter } from "./navigation";
import { ApplicationsView } from "./applications-view";
import { Avatar } from "./avatar";
import { HelpView } from "./help-view";
import { SettingsView } from "./settings-view";
import { Modal, Notice, TaskNotice, useTask } from "./ui";
import "./account.css";

const navigation = [
  { href: "/apps", title: "我的应用", icon: Browser },
  { href: "/settings/profile", title: "账号设置", icon: Gear },
  { href: "/help", title: "接入帮助", icon: BookOpen },
];

export function AccountPortal({ route, initialAccount, config }: { route: string; initialAccount: Account; config: PublicConfig }) {
  const brand = useBrand();
  const router = useAccountRouter();
  const [account, setAccount] = useState(initialAccount);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [signout, setSignout] = useState(false);
  const task = useTask();
  useEffect(() => {
    clearApiCache();
    let active = true;
    const refresh = () => {
      clearApiCache();
      api<{ account: Account }>("/me").then(value => { if (active) { setAccount(value.account); setError(""); } }).catch(() => { if (active) setError("登录状态发生变化，请重新验证后继续。"); });
    };
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); clearApiCache(); };
  }, []);
  const selected = (href: string) => href === "/apps" ? route.startsWith("/apps") : href.startsWith("/settings") ? route.startsWith("/settings") : route === href;
  const section = route.startsWith("/settings") ? "账号设置" : route === "/help" ? "接入帮助" : "我的应用";
  const nav = <nav aria-label="主导航"><h2>账号门户</h2>{navigation.map(item => <Link key={item.href} href={item.href} className={selected(item.href) ? "selected" : ""} aria-current={selected(item.href) ? "page" : undefined} onClick={() => setMenu(false)}><item.icon size={19} />{item.title}</Link>)}</nav>;
  return <div className="account-ui"><div className="portal">
    <aside className="sidebar"><Link className="brand" href="/apps">{brand.icon && <Image src={brand.icon} width={32} height={36} unoptimized alt="" />}<div><strong>{brand.nickname}</strong><small>ACCOUNT PORTAL</small></div></Link>{nav}<div className="sidebar-user"><Avatar account={account} /><div><strong>{account.displayName}</strong><small>{account.email}</small></div><button className="icon-button" aria-label="退出登录" onClick={() => { task.clear(); setSignout(true); }}><SignOut size={19} /></button></div></aside>
    <div className="main"><header className="topbar"><div><button className="icon-button mobile-menu" aria-label="打开菜单" aria-expanded={menu} onClick={() => setMenu(true)}><List size={21} /></button><span>账号门户</span><CaretRight size={12} /><strong>{section}</strong></div><Link href="/help"><BookOpen size={16} />接入帮助</Link></header>
      <main className="content" id="main-content">{error && <Notice kind="error">{error}<Link href="/account">继续身份验证</Link></Notice>}
        {route.startsWith("/settings") ? <SettingsView key={route} route={route} account={account} onAccount={setAccount} config={config} /> : route === "/help" ? <HelpView issuer={config.issuer} /> : <ApplicationsView key={route} route={route} issuer={config.issuer} />}
        <footer className="portal-footer"><span>{brand.nickname}</span><span>账号与单点登录</span></footer>
      </main>
    </div>
    <Modal open={menu} onClose={() => setMenu(false)} title={brand.nickname || "账号门户"} description={`${account.displayName} · ${account.email}`}><div className="mobile-navigation">{nav}</div><button className="small-button" onClick={() => { setMenu(false); task.clear(); setSignout(true); }}><SignOut size={16} />退出登录</button></Modal>
    <Modal open={signout} onClose={() => setSignout(false)} title="退出登录？" description="结束此浏览器的身份会话并退出账号门户。其他网站的会话按各自有效期处理。" busy={task.busy}><TaskNotice task={task} /><div className="form-actions"><button className="small-button" disabled={task.busy} onClick={() => setSignout(false)}>取消</button><button className="primary-button" disabled={task.busy} onClick={() => task.run(async () => { await post("/logout"); clearApiCache(); router.replace("/login"); })}>{task.busy ? "正在退出…" : "退出登录"}</button></div></Modal>
  </div></div>;
}
