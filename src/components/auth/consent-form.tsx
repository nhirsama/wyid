"use client";

import { consentScopes } from "@/lib/consent";
import { decideConsent } from "@/server/actions";
import { Feedback, useAuthAction } from "@/components/ui/form";

type Props = {
  authRequestId: string;
  consentToken: string;
  scopes: string[];
  appName: string;
  displayName: string;
  email: string;
};

export function ConsentForm({ authRequestId, consentToken, scopes, appName, displayName, email }: Props) {
  const action = useAuthAction();
  const decision = (allow: boolean) => action.run(() => decideConsent({ authRequestId, consentToken, allow }));

  const disabled = action.pending || !consentToken;
  return <form method="post" className="form" noValidate onSubmit={event => { event.preventDefault(); if (!disabled) decision(true); }}>
    <Feedback result={action.result} />
    <p className="body-copy"><strong>{appName}</strong> 申请访问以下账号信息和权限，是否允许？</p>
    <div className="account-choice">
      <span className="avatar" role="img" aria-label={`${displayName || email}的头像`} style={{ width: 31, height: 31, overflow: "hidden", flex: "none" }}>{Array.from(displayName || email)[0]?.toUpperCase() || "?"}</span>
      <div><strong>{displayName}</strong><small>{email}</small></div>
    </div>
    <ul className="scope-list" aria-label="网站请求的账号信息与权限">
      {consentScopes(scopes).map(item => <li key={item.scope}>
        <strong>{item.name}</strong>：{item.description} <code>{item.scope}</code>
      </li>)}
    </ul>
    <div className="form-actions">
      <button type="button" className="small-button" disabled={disabled} onClick={() => decision(false)}>取消</button>
      <button type="submit" className="primary-button" disabled={disabled} aria-busy={action.pending}>{action.pending ? "正在处理…" : "允许"}</button>
    </div>
  </form>;
}
