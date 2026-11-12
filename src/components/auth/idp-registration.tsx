"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { confirmIdentityProviderRegistration } from "@/server/actions";
import { Feedback, Notice, useAuthAction } from "@/components/ui/form";

export function IdentityProviderRegistration({ state, accountLabel, accountExists = false }: { state: string; accountLabel: string; accountExists?: boolean }) {
  const action = useAuthAction();
  return <div className="form">
    <Notice>{accountExists ? "此身份提供方账号已关联，可以继续登录。" : "此身份提供方返回的账号尚未关联。确认后会在此组织创建账号并继续登录。"}</Notice>
    {accountLabel && <p className="body-copy">提供方账号：{accountLabel}</p>}
    <Feedback result={action.result} />
    <button className="button primary-button wide" type="button" disabled={action.pending} onClick={() => action.run(() => confirmIdentityProviderRegistration({ state }))}>
      {action.pending ? "正在处理…" : <>{accountExists ? "继续登录" : "创建账号并继续"}<ArrowRight size={16} /></>}
    </button>
  </div>;
}
