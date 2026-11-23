import { AuthPanel } from "@/components/auth/auth-shell";
import { IdentityProviderRegistration } from "@/components/auth/idp-registration";
import { AppLink } from "@/components/ui/app-link";
import { Notice } from "@/components/ui/form";
import { authLink } from "@/lib/auth";
import { readPendingSession } from "@/server/session";
import { inspectIdentityProvider } from "@/server/identity-provider";
import { actionError } from "@/server/errors";

export const metadata = { title: "确认创建账号" };

export default async function IdentityProviderConfirmation({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "";
  const pending = await readPendingSession();
  const loginHref = authLink("/login", { authRequestId: pending?.authRequestId });
  let view: { accountLabel: string; accountExists: boolean } | undefined;
  let failure: ReturnType<typeof actionError> | undefined;
  if (pending?.idpState === state && pending.idpIntentId && pending.idpIntentToken) {
    try {
      const { provider, result } = await inspectIdentityProvider(pending, { idpIntentId: pending.idpIntentId, idpIntentToken: pending.idpIntentToken });
      if (result.userId || provider.creationAllowed && result.addHumanUser) {
        view = {
          accountExists: Boolean(result.userId),
          accountLabel: [result.addHumanUser?.profile?.displayName, result.addHumanUser?.email?.email].filter(Boolean).join(" · "),
        };
      }
    } catch (error) { failure = actionError(error); }
  }
  const title = view?.accountExists ? "继续登录" : "确认创建账号";
  const description = view
    ? view.accountExists ? "此身份提供方账号已关联，确认后继续登录。" : "此身份提供方账号尚未关联，确认后将创建账号并继续登录。"
    : undefined;
  return <AuthPanel title={title} description={description}>
    {view ? <IdentityProviderRegistration state={state} loginHref={loginHref} {...view} /> : <div className="result-stack">
      <Notice kind="error">{failure?.message || "账号创建请求已失效或当前不允许创建账号，请重新从应用发起登录。"}{failure?.requestId && <small className="request-id">请求编号：{failure.requestId}</small>}</Notice>
      <AppLink className="button secondary-button wide" href={loginHref}>返回登录</AppLink>
    </div>}
  </AuthPanel>;
}
