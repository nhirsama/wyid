"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BookOpen, Browser, Gear, List, SignOut } from "@phosphor-icons/react";
import { useBrand } from "@/components/auth/brand-provider";
import { ApiError, clearApiCache, post, readApi } from "@/lib/account/api";
import type { Account, PublicConfig } from "@/lib/account/types";
import { AccountLink as Link, AccountNavigationProvider, useAccountRoute, useAccountRouter } from "./navigation";
import { ApplicationsView } from "./applications-view";
import { Avatar } from "./avatar";
import { HelpView } from "./help-view";
import { SettingsView } from "./settings-view";
import { PageBackdrop } from "@/components/page-backdrop";
import { Modal, Notice, TaskNotice, useTask } from "./ui";
import "./account.css";

const navigation = [
  { href: "/apps", title: "我的应用", icon: Browser },
  { href: "/settings/profile", title: "账号设置", icon: Gear },
  { href: "/help", title: "接入帮助", icon: BookOpen },
];

type PortalProps = { route: string; initialAccount: Account; config: PublicConfig };
export function AccountPortal(props: PortalProps) {
  return <AccountNavigationProvider route={props.route}><Portal initialAccount={props.initialAccount} config={props.config} /></AccountNavigationProvider>;
}

function Portal({ initialAccount, config }: Omit<PortalProps, "route">) {
  const route = useAccountRoute();
  const brand = useBrand();
  const router = useAccountRouter();
  const [account, setAccount] = useState(initialAccount);
  const [error, setError] = useState<{ message: string; loginRequired: boolean } | null>(null);
  const [menu, setMenu] = useState(false);
  const [signout, setSignout] = useState(false);
  const task = useTask();
  useEffect(() => {
    let active = true;
    let pending = false;
    // The initial profile was just validated by the server. Returning from a
    // password manager or switching tabs must not evict all private read data.
    let checkedAt = Date.now();
    const refresh = () => {
      if (document.visibilityState === "hidden" || pending || Date.now() - checkedAt < 60_000) return;
      pending = true;
      checkedAt = Date.now();
      readApi<{ account: Account }>("/me", true)
        .then(value => {
          if (!active) return;
          if (value.account.id !== initialAccount.id) {
            // Another tab changed accounts: discard this principal's shell and
            // private data rather than mixing accounts during local navigation.
            clearApiCache();
            window.location.reload();
            return;
          }
          setAccount(value.account); setError(null);
        })
        .catch(cause => {
          if (!active) return;
          const loginRequired = cause instanceof ApiError && (cause.status === 401 || cause.code === "authentication_incomplete");
          if (loginRequired) clearApiCache();
          setError({ loginRequired, message: loginRequired ? "登录状态发生变化，请重新验证后继续。" : "暂时无法刷新账号资料，请检查网络后稍后重试。" });
        })
        .finally(() => { pending = false; });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); clearApiCache(); };
  }, [initialAccount.id]);
  const selected = (href: string) => href === "/apps" ? route.startsWith("/apps") : href.startsWith("/settings") ? route.startsWith("/settings") : route === href;
  const section = route.startsWith("/settings") ? "账号设置" : route === "/help" ? "接入帮助" : "我的应用";
  const nav = <nav aria-label="主导航">{navigation.map(item => <Link key={item.href} href={item.href} className={selected(item.href) ? "selected" : ""} aria-current={selected(item.href) ? "page" : undefined} onClick={() => setMenu(false)}><item.icon size={19} />{item.title}</Link>)}</nav>;
  return <div className="account-ui"><PageBackdrop variant="portal" /><div className="portal">
    <aside className="sidebar"><Link className="brand" href="/apps">{brand.icon && <Image src={brand.icon} width={32} height={36} unoptimized alt="" />}<strong>{brand.nickname}</strong></Link>{nav}<div className="sidebar-user"><Avatar account={account} /><div><strong>{account.displayName}</strong><small>{account.email}</small></div><button className="icon-button" aria-label="退出登录" onClick={() => { task.clear(); setSignout(true); }}><SignOut size={19} /></button></div></aside>
    <div className="main"><header className="topbar"><div><button className="icon-button mobile-menu" aria-label="打开菜单" aria-expanded={menu} onClick={() => setMenu(true)}><List size={21} /></button><strong>{section}</strong></div><Link href="/help"><BookOpen size={16} />接入帮助</Link></header>
      <main className="content" id="main-content">{error && <Notice kind="error">{error.message}{error.loginRequired && <Link href="/account">继续身份验证</Link>}</Notice>}
        {route.startsWith("/settings") ? <SettingsView key={route} route={route} account={account} onAccount={setAccount} config={config} /> : route === "/help" ? <HelpView issuer={config.issuer} /> : <ApplicationsView key={route} route={route} issuer={config.issuer} />}
      </main>
    </div>
    <Modal open={menu} onClose={() => setMenu(false)} title={brand.nickname || "账号门户"} description={`${account.displayName} · ${account.email}`}><div className="mobile-navigation">{nav}</div><button className="small-button" onClick={() => { setMenu(false); task.clear(); setSignout(true); }}><SignOut size={16} />退出登录</button></Modal>
    <Modal open={signout} onClose={() => setSignout(false)} title="退出登录？" description="结束此浏览器的身份会话并退出账号门户。其他网站的会话按各自有效期处理。" busy={task.busy}><TaskNotice task={task} /><div className="form-actions"><button className="small-button" disabled={task.busy} onClick={() => setSignout(false)}>取消</button><button className="primary-button" disabled={task.busy} onClick={() => task.run(async () => { await post("/logout"); clearApiCache(); router.replace("/login"); })}>{task.busy ? "正在退出…" : "退出登录"}</button></div></Modal>
  </div></div>;
}
