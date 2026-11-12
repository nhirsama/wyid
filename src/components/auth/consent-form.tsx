"use client";
/* eslint-disable @next/next/no-img-element -- Use the same native avatar rendering as hueneko-login. */

import { useState } from "react";
import { consentScopes } from "@/lib/consent";
import { decideConsent } from "@/server/actions";
import { Feedback, useAuthAction } from "@/components/ui/form";
import styles from "./consent.module.css";

type Props = {
  authRequestId: string;
  consentToken: string;
  scopes: string[];
  appName: string;
  appHost?: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
};

function avatarSource(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function ConsentAvatar({ displayName, email, avatarUrl }: Pick<Props, "displayName" | "email" | "avatarUrl">) {
  const [failedUrl, setFailedUrl] = useState("");
  const src = avatarSource(avatarUrl);
  const name = displayName || email;
  return <span className={styles.avatar} role="img" aria-label={`${name}的头像`} style={{ width: 31, height: 31, overflow: "hidden", flex: "none" }}>
    {src && src !== failedUrl ? <img src={src} alt="" width={31} height={31} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} /> : Array.from(name)[0]?.toUpperCase() || "?"}
  </span>;
}

export function ConsentForm({ authRequestId, consentToken, scopes, appName, appHost, displayName, email, avatarUrl }: Props) {
  const action = useAuthAction();
  const decision = (allow: boolean) => action.run(() => decideConsent({ authRequestId, consentToken, allow }));

  const disabled = action.pending || !consentToken;
  return <form method="post" className={styles.form} noValidate onSubmit={event => { event.preventDefault(); if (!disabled) decision(true); }}>
    <Feedback result={action.result} />
    <p className={styles.bodyCopy}><strong>{appName}</strong>{appHost && appHost !== appName && <>（{appHost}）</>} 申请访问以下账号信息和权限，是否允许？</p>
    <div className={styles.accountChoice}><ConsentAvatar displayName={displayName} email={email} avatarUrl={avatarUrl} /><div><strong>{displayName}</strong><small>{email}</small></div></div>
    <ul className={styles.scopeList} aria-label="网站请求的账号信息与权限">{consentScopes(scopes).map(item => <li key={item.scope}><strong>{item.name}</strong>：{item.description} <code>{item.scope}</code></li>)}</ul>
    <div className={styles.formActions}><button type="button" className={styles.smallButton} disabled={disabled} onClick={() => decision(false)}>取消</button><button type="submit" className={styles.primaryButton} disabled={disabled} aria-busy={action.pending}>{action.pending ? "正在处理…" : "允许"}</button></div>
  </form>;
}
