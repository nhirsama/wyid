"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import { consentScopes } from "@/lib/consent";
import { decideConsent } from "@/server/actions";
import { Feedback, useAuthAction } from "@/components/ui/form";

type Props = {
  authRequestId: string;
  consentToken: string;
  scopes: string[];
  displayName: string;
  email: string;
};

export function ConsentForm({ authRequestId, consentToken, scopes, displayName, email }: Props) {
  const action = useAuthAction();
  const decision = (allow: boolean) => action.run(() => decideConsent({ authRequestId, consentToken, allow }));

  return <form className="form consent-form" noValidate onSubmit={event => { event.preventDefault(); decision(true); }}>
    <Feedback result={action.result} />
    <p className="body-copy">该网站申请访问以下账号信息与权限。请确认这是你要登录的网站。</p>
    <div className="account-choice consent-account">
      <span className="consent-avatar" aria-hidden="true"><ShieldCheck size={20} /></span>
      <span><strong>{displayName}</strong><small>{email || "已验证的 ZITADEL 账号"}</small></span>
    </div>
    <ul className="scope-list" aria-label="网站请求的账号信息与权限">
      {scopes.length ? consentScopes(scopes).map(item => <li key={item.scope}>
        <strong>{item.name}</strong>：{item.description} <code>{item.scope}</code>
      </li>) : <li>此请求未申请额外的账号资料范围。</li>}
    </ul>
    <div className="form-actions consent-actions">
      <button type="button" className="button secondary-button" disabled={action.pending} onClick={() => decision(false)}>拒绝</button>
      <button type="submit" className="button primary-button" disabled={action.pending} aria-busy={action.pending}>{action.pending ? "正在处理…" : "允许并继续"}</button>
    </div>
  </form>;
}
