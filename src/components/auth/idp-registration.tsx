"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { confirmIdentityProviderRegistration } from "@/server/actions";
import { Feedback, Notice, useAuthAction } from "@/components/ui/form";

export function IdentityProviderRegistration({ state, accountLabel }: { state: string; accountLabel: string }) {
  const action = useAuthAction();
  return <div className="form">
    <Notice>此身份提供方返回的账号尚未关联。确认后会在此组织创建账号并继续登录。</Notice>
    {accountLabel && <p className="body-copy">提供方账号：{accountLabel}</p>}
    <Feedback result={action.result} />
    <button className="button primary-button wide" type="button" disabled={action.pending} onClick={() => action.run(() => confirmIdentityProviderRegistration({ state }))}>
      {action.pending ? "正在创建账号…" : <>创建账号并继续<ArrowRight size={16} /></>}
    </button>
  </div>;
}
