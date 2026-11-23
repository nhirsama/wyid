"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { confirmIdentityProviderRegistration } from "@/server/actions";
import { AppLink } from "@/components/ui/app-link";
import { Feedback, useAuthAction } from "@/components/ui/form";

export function IdentityProviderRegistration({ state, accountLabel, accountExists = false, loginHref = "/login" }: { state: string; accountLabel: string; accountExists?: boolean; loginHref?: string }) {
  const action = useAuthAction();
  return <div className="form">
    {accountLabel && <p className="body-copy">提供方账号：{accountLabel}</p>}
    <Feedback result={action.result} />
    <button className="button primary-button wide" type="button" disabled={action.pending} onClick={() => action.run(() => confirmIdentityProviderRegistration({ state }))}>
      {action.pending ? "正在处理…" : <>{accountExists ? "继续登录" : "创建账号并继续"}<ArrowRight size={16} /></>}
    </button>
    <AppLink className="text-link centered" href={loginHref}>返回登录</AppLink>
  </div>;
}
